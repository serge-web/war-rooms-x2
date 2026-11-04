// S15: do PubSub items fetched with an items request (XEP-0060 §6.5) carry a server timestamp a
// reader can order by, and is the order of the items reliable? Two publishers on one node, set
// up as the transport sets up an objectives node (§3 rule 14): the admin (owner) and a White
// Force editor with the `publisher` affiliation, each publishing items with ids of its own.
//
// The publish sequence tells the four possible orders apart (creation or last edit, oldest or
// newest first), so a single fetch shows which one the server uses.
import { describe, expect, it } from 'vitest'
import { must } from '../../../../packages/contract-suite/src/harness.ts'
import { esc, features, NS, recordNotifications, rsmOf, Transcript, type Pubsub } from '../../../s14/src/pubsub.ts'
import { CONFIG } from '../config.ts'
import { saveStanzas, type Ctx } from '../context.ts'
import { storedTimes } from '../docker.ts'

/** The node config the transport writes (packages/transport-xmpp/src/ejabberd.ts nodeConfigFields). */
export const objectivesConfig = (maxItems: number, sendLast = 'never') => ({
  'pubsub#access_model': 'whitelist',
  'pubsub#publish_model': 'publishers',
  'pubsub#max_items': String(maxItems),
  'pubsub#notify_retract': 'true',
  'pubsub#persist_items': 'true',
  'pubsub#deliver_payloads': 'true',
  'pubsub#notify_delete': 'true',
  'pubsub#send_last_published_item': sendLast,
  'pubsub#itemreply': 'publisher',
})

/** An objectives document (§3 rule 14) as an XEP-0335 JSON payload. */
export const objectivesPayload = (text: string, updatedAt = new Date().toISOString()) =>
  `<json xmlns='urn:xmpp:json:0'>${esc(JSON.stringify({ schemaVersion: 1, text, updatedAt }))}</json>`

export interface ItemView {
  readonly id: string
  /** Attribute names on <item/>, e.g. ["id", "publisher"]. */
  readonly attributes: readonly string[]
  readonly publisher?: string
  /** Text of the payload's `text` field, to tell versions apart. */
  readonly text?: string
  /** A <delay/> stamp inside the item, if any. */
  readonly delay?: string
}

const attrValue = (attrs: string, name: string) => new RegExp(`\\s${name}=['"]([^'"]*)['"]`).exec(attrs)?.[1]

/** The <item/> elements of an items reply or event, in document order. */
export function itemViews(xml: string): ItemView[] {
  return [...xml.matchAll(/<item\b([^>]*?)(?:\/>|>([\s\S]*?)<\/item>)/g)].map((m) => {
    const attrs = m[1] ?? ''
    const body = m[2] ?? ''
    const id = attrValue(attrs, 'id') ?? ''
    const publisher = attrValue(attrs, 'publisher')
    const text = /&quot;text&quot;:&quot;([^&]*)&quot;|"text":"([^"]*)"/.exec(body)
    const delay = /<delay\b[^>]*stamp=['"]([^'"]+)['"]/.exec(body)?.[1]
    return {
      id,
      attributes: [...attrs.matchAll(/\s([a-zA-Z:_-]+)=/g)].map((a) => a[1] ?? ''),
      ...(publisher === undefined ? {} : { publisher }),
      ...(text === null ? {} : { text: text[1] ?? text[2] ?? '' }),
      ...(delay === undefined ? {} : { delay }),
    }
  })
}

/**
 * What a reply holds besides payloads: the element names outside each item's payload, and
 * whether anything looks like a time (a delay stamp, a `stamp`, `time`, `date` or `modified`
 * attribute). The payload is removed first: it carries the author's own `updatedAt`.
 */
export function envelope(xml: string): { elements: string[]; timeLike: string[] } {
  const stripped = xml.replace(/<json\b[^>]*>[\s\S]*?<\/json>/g, '<json/>')
  const elements = [...new Set([...stripped.matchAll(/<([a-zA-Z][\w:-]*)\b/g)].map((m) => m[1] ?? ''))]
  const timeLike = [
    ...stripped.matchAll(/<delay\b[^>]*>|\s(?:stamp|time|date|modified|created|timestamp)=['"][^'"]*['"]/gi),
  ].map((m) => m[0].trim())
  return { elements, timeLike }
}

/** The RSM <first/> and <last/> of a reply, if it has an RSM set. */
export function rsmCursors(xml: string): { first?: string; last?: string } {
  const first = /<first\b[^>]*>([^<]*)<\/first>/.exec(xml)?.[1]
  const last = /<last>([^<]*)<\/last>/.exec(xml)?.[1]
  return { ...(first === undefined ? {} : { first }), ...(last === undefined ? {} : { last }) }
}

/** ejabberd's stored time `MMMMMM:SSSSSS:UUUUUU` (an Erlang timestamp) as ISO 8601 with microseconds. */
export function dbTime(stored: string): string {
  const [mega = '0', sec = '0', micro = '0'] = stored.split(':')
  const seconds = Number(mega) * 1_000_000 + Number(sec)
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, `.${micro.padStart(6, '0')}Z`)
}

/** Which of the four candidate orders an observed id list matches. */
export function classify(
  observed: readonly string[],
  candidates: Record<string, readonly string[]>,
): string[] {
  return Object.entries(candidates)
    .filter(([, order]) => order.length === observed.length && order.every((id, i) => observed[i] === id))
    .map(([name]) => name)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One item by id (§6.5.8). */
export const itemById = (p: Pubsub, node: string, id: string) =>
  p.iq('get', `<pubsub xmlns='${NS.pubsub}'><items node='${esc(node)}'><item id='${esc(id)}'/></items></pubsub>`)

/** Every RSM page of `size` items, in the order the server gives them. */
export async function rsmPages(p: Pubsub, node: string, size: number): Promise<string[][]> {
  const pages: string[][] = []
  let after: string | undefined
  for (let i = 0; i < 50; i++) {
    const r = await p.items(node, { rsm: { max: size, ...(after === undefined ? {} : { after }) } })
    const ids = itemViews(r.xml).map((v) => v.id)
    if (ids.length === 0) break
    pages.push(ids)
    const last = rsmOf(r.xml).last
    if (last === undefined || last === after) break
    after = last
  }
  return pages
}

/**
 * Sets up a node with the S15 sequence, a pause between steps so that the steps differ even at
 * one-second resolution:
 *   1. admin publishes `admin`         (objectives v1)
 *   2. umpire publishes `umpire`       (v1)
 *   3. admin publishes `admin-2`       (v1)
 *   4. umpire re-publishes `umpire`    (v2)            <- snapshot A
 *   5. admin re-publishes `admin`      (v2)            <- snapshot B
 * After step 4 the four candidate orders all differ:
 *   creation, oldest first   admin, umpire, admin-2
 *   creation, newest first   admin-2, umpire, admin
 *   last edit, oldest first  admin, admin-2, umpire
 *   last edit, newest first  umpire, admin-2, admin
 */
export const SEQUENCE_A: Record<string, readonly string[]> = {
  'creation, oldest first': ['admin', 'umpire', 'admin-2'],
  'creation, newest first': ['admin-2', 'umpire', 'admin'],
  'last edit, oldest first': ['admin', 'admin-2', 'umpire'],
  'last edit, newest first': ['umpire', 'admin-2', 'admin'],
}
export const SEQUENCE_B: Record<string, readonly string[]> = {
  'creation, oldest first': ['admin', 'umpire', 'admin-2'],
  'creation, newest first': ['admin-2', 'umpire', 'admin'],
  'last edit, oldest first': ['admin-2', 'umpire', 'admin'],
  'last edit, newest first': ['admin', 'umpire', 'admin-2'],
}

export interface Sequence {
  readonly node: string
  readonly admin: Pubsub
  readonly umpire: Pubsub
  /** Runs step 5 (snapshot B). */
  stepFive(): Promise<void>
}

export async function sequence(ctx: Ctx, t: Transcript, node: string, gapMs = 1_100): Promise<Sequence> {
  const admin = ctx.ps(undefined, t, 'admin')
  expect((await admin.create(node, objectivesConfig(10))).ok).toBe(true)
  expect(
    (await admin.setAffiliations(node, { [ctx.jid('umpire')]: 'publisher', [ctx.jid('reader')]: 'member' })).ok,
  ).toBe(true)
  const umpire = ctx.ps(await ctx.login('umpire'), t, 'umpire')
  t.note('step 1: admin publishes admin')
  must2(await admin.publish(node, 'admin', objectivesPayload('admin v1')))
  await sleep(gapMs)
  t.note('step 2: umpire publishes umpire')
  must2(await umpire.publish(node, 'umpire', objectivesPayload('umpire v1')))
  await sleep(gapMs)
  t.note('step 3: admin publishes admin-2')
  must2(await admin.publish(node, 'admin-2', objectivesPayload('admin-2 v1')))
  await sleep(gapMs)
  t.note('step 4: umpire re-publishes umpire')
  must2(await umpire.publish(node, 'umpire', objectivesPayload('umpire v2')))
  return {
    node,
    admin,
    umpire,
    stepFive: async () => {
      await sleep(gapMs)
      t.note('step 5: admin re-publishes admin')
      must2(await admin.publish(node, 'admin', objectivesPayload('admin v2')))
    },
  }
}

function must2(r: { ok: boolean; xml: string }): void {
  if (!r.ok) throw new Error(`publish refused: ${r.xml}`)
}

/** Every read a client could order by, from the reader's session. */
export async function reads(reader: Pubsub, node: string) {
  const full = await reader.items(node)
  const max1 = await reader.items(node, { max: 1 })
  const max2 = await reader.items(node, { max: 2 })
  const pages = await rsmPages(reader, node, 1)
  const one = await itemById(reader, node, 'umpire')
  return {
    replies: { full, max1, max2, one },
    full: itemViews(full.xml),
    max1: itemViews(max1.xml).map((v) => v.id),
    max2: itemViews(max2.xml).map((v) => v.id),
    rsmPagesOfOne: pages,
    byId: itemViews(one.xml),
    envelope: envelope(full.xml),
    envelopeById: envelope(one.xml),
    /** The RSM <first/> and <last/> of each reply (XEP-0059 cursors, opaque to clients by the XEP). */
    cursors: { full: rsmCursors(full.xml), max1: rsmCursors(max1.xml), max2: rsmCursors(max2.xml) },
  }
}

export function s15(ctx: Ctx): void {
  describe('S15 item timestamps and order', () => {
    it('S15-1, S15-2 what a fetched item holds, and the order of every kind of items request', async () => {
      const t = new Transcript()
      const seq = await sequence(ctx, t, ctx.name('objectives'))
      const reader = ctx.ps(await ctx.login('reader'), t, 'reader')
      t.note('snapshot A: reads after step 4')
      const a = await reads(reader, seq.node)
      const storedA = await storedTimes(CONFIG, seq.node)
      await seq.stepFive()
      t.note('snapshot B: reads after step 5')
      const b = await reads(reader, seq.node)
      const storedB = await storedTimes(CONFIG, seq.node)
      saveStanzas('s15-1-items', t)
      ctx.observe('S15-2', 'stored creation and modification times (server database, not visible to clients)', {
        afterStep4: storedA,
        afterStep5: storedB,
      })

      const ids = (r: typeof a) => r.full.map((v) => v.id)
      ctx.observe('S15-1', 'what a fetched item holds', {
        pass: a.full.some((v) => v.delay !== undefined) || a.envelope.timeLike.length > 0,
        items: a.full,
        elementsInReply: a.envelope.elements,
        timeLikeInReply: a.envelope.timeLike,
        itemById: a.byId,
        timeLikeInItemById: a.envelopeById.timeLike,
        rsmCursors: a.cursors,
        storedCreationAsIso: storedA.map((r) => `${r.itemid}: creation ${dbTime(r.creation)}, modification ${dbTime(r.modification)}`),
      })
      for (const [label, r, cands] of [
        ['A (after step 4)', a, SEQUENCE_A],
        ['B (after step 5)', b, SEQUENCE_B],
      ] as const) {
        ctx.observe('S15-2', `order, snapshot ${label}`, {
          full: ids(r),
          fullMatches: classify(ids(r), cands),
          max1: r.max1,
          max2: r.max2,
          max2Matches: Object.entries(cands)
            .filter(([, o]) => r.max2.every((id) => o.slice(0, 2).includes(id)) && r.max2.length === 2)
            .map(([n]) => `${n} (first two)`)
            .concat(
              Object.entries(cands)
                .filter(([, o]) => r.max2.every((id) => o.slice(1).includes(id)) && r.max2.length === 2)
                .map(([n]) => `${n} (last two)`),
            ),
          rsmPagesOfOne: r.rsmPagesOfOne,
          publishers: r.full.map((v) => `${v.id}:${v.publisher ?? '-'}`),
          texts: r.full.map((v) => `${v.id}:${v.text ?? '-'}`),
        })
      }
      await seq.admin.deleteNode(seq.node)

      // Recorded ejabberd 26.09 behaviour: no time in an item, and items in creation order.
      expect(a.full.every((v) => v.delay === undefined)).toBe(true)
      expect(a.envelope.timeLike).toEqual([])
      expect(ids(a)).toEqual(SEQUENCE_A['creation, oldest first'])
      expect(ids(b)).toEqual(SEQUENCE_B['creation, oldest first'])
      // max_items keeps the newest by creation, newest first: not the newest edit.
      expect(a.max1).toEqual(['admin-2'])
      expect(b.max1).toEqual(['admin-2'])
      expect(a.rsmPagesOfOne.flat()).toEqual(ids(a))
      // The only server time in a reply: the RSM cursor of a max_items reply is the creation time
      // of the item at the page edge (admin-2, the newest created), not its last edit.
      expect(a.cursors.full).toEqual({})
      const created = storedA.find((r) => r.itemid === 'admin-2')
      expect(a.cursors.max1.first).toBe(dbTime(created?.creation ?? ''))
    })

    it('S15-3 many back-to-back and concurrent publishes: fetched order against publish and event order', async () => {
      const t = new Transcript()
      const admin = ctx.ps(undefined, t, 'admin')
      const node = ctx.name('burst')
      expect((await admin.create(node, objectivesConfig(200))).ok).toBe(true)
      await admin.setAffiliations(node, { [ctx.jid('umpire')]: 'publisher', [ctx.jid('reader')]: 'member' })
      const umpire = ctx.ps(await ctx.login('umpire'))
      const readerSession = await ctx.login('reader')
      const reader = ctx.ps(readerSession)
      expect((await reader.subscribe(node, ctx.jid('reader'))).ok).toBe(true)
      const live = recordNotifications(ctx.raw, readerSession)

      // 1. Back to back, alternating, each awaited: the publish order is known exactly.
      const serial: string[] = []
      for (let i = 0; i < 20; i++) {
        must2(await admin.publish(node, `s-a${i}`, objectivesPayload(`a${i}`)))
        serial.push(`s-a${i}`)
        must2(await umpire.publish(node, `s-u${i}`, objectivesPayload(`u${i}`)))
        serial.push(`s-u${i}`)
      }
      // 2. Re-publish every third item, back to back.
      const republished = serial.filter((_, i) => i % 3 === 0)
      for (const id of republished) {
        const p = id.startsWith('s-a') ? admin : umpire
        must2(await p.publish(node, id, objectivesPayload(`${id} v2`)))
      }
      // 3. Concurrent: 20 from each publisher in flight at once; only the server knows the order.
      const concurrent = await Promise.all(
        Array.from({ length: 20 }, (_, i) => [
          admin.publish(node, `c-a${i}`, objectivesPayload(`ca${i}`)),
          umpire.publish(node, `c-u${i}`, objectivesPayload(`cu${i}`)),
        ]).flat(),
      )
      concurrent.forEach(must2)
      await sleep(1_000)
      live.stop()

      const fetched = itemViews((await reader.items(node)).xml).map((v) => v.id)
      const eventOrder = live.events.filter((e) => e.kind === 'items').map((e) => e.item)
      const firstEvent = eventOrder.filter((id, i) => eventOrder.indexOf(id) === i)
      const lastEvent = eventOrder.filter((id, i) => eventOrder.lastIndexOf(id) === i)
      const fetchedSerial = fetched.filter((id) => id.startsWith('s-'))
      const fetchedConcurrent = fetched.filter((id) => id.startsWith('c-'))
      const max1 = itemViews((await reader.items(node, { max: 1 })).xml).map((v) => v.id)
      const max5 = itemViews((await reader.items(node, { max: 5 })).xml).map((v) => v.id)
      const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((v, i) => y[i] === v)
      ctx.observe('S15-3', 'back-to-back and concurrent publishes', {
        items: fetched.length,
        serialFetchedInCreationOrder: same(fetchedSerial, serial),
        serialFetchedReversed: same(fetchedSerial, [...serial].reverse()),
        republishedMovedInFetch: !same(fetchedSerial, serial),
        concurrentFetchedEqualsFirstEventOrder: same(fetchedConcurrent, firstEvent.filter((id) => id.startsWith('c-'))),
        eventsReceived: eventOrder.length,
        eventsExpected: serial.length + republished.length + concurrent.length,
        serialEventsInPublishOrder: same(
          eventOrder.filter((id) => id.startsWith('s-')),
          [...serial, ...republished],
        ),
        lastEventOrderEqualsEditOrder: same(
          lastEvent.filter((id) => id.startsWith('s-')),
          [...serial.filter((id) => !republished.includes(id)), ...republished],
        ),
        max1,
        max5,
        fetchedHead: fetched.slice(0, 6),
        fetchedTail: fetched.slice(-6),
        concurrentFetched: fetchedConcurrent.slice(0, 10),
        concurrentFirstEvents: firstEvent.filter((id) => id.startsWith('c-')).slice(0, 10),
      })
      await admin.deleteNode(node)
      expect(same(fetchedSerial, serial)).toBe(true)
    })

    it('S15-4 live events and the last-item replay: what time they carry', async () => {
      const t = new Transcript()
      const admin = ctx.ps(undefined, t, 'admin')
      const node = ctx.name('live')
      const replayNode = ctx.name('replay')
      expect((await admin.create(node, objectivesConfig(10))).ok).toBe(true)
      expect((await admin.create(replayNode, objectivesConfig(10, 'on_sub'))).ok).toBe(true)
      for (const n of [node, replayNode])
        await admin.setAffiliations(n, { [ctx.jid('umpire')]: 'publisher', [ctx.jid('reader')]: 'member' })
      const readerSession = await ctx.login('reader')
      const reader = ctx.ps(readerSession, t, 'reader')
      const umpire = ctx.ps(await ctx.login('umpire'), t, 'umpire')
      expect((await reader.subscribe(node, ctx.jid('reader'))).ok).toBe(true)
      const live = recordNotifications(ctx.raw, readerSession)
      t.note('umpire publishes to a node the reader subscribes to')
      must2(await umpire.publish(node, 'umpire', objectivesPayload('live')))
      t.note('replay node: umpire publishes umpire, admin publishes admin, umpire re-publishes umpire')
      const at: Record<string, string> = {}
      must2(await umpire.publish(replayNode, 'umpire', objectivesPayload('umpire v1')))
      at['umpire v1'] = new Date().toISOString()
      await sleep(1_100)
      must2(await admin.publish(replayNode, 'admin', objectivesPayload('admin v1')))
      at['admin v1'] = new Date().toISOString()
      await sleep(1_100)
      must2(await umpire.publish(replayNode, 'umpire', objectivesPayload('umpire v2')))
      at['umpire v2'] = new Date().toISOString()
      await sleep(1_500)
      t.note('reader subscribes to a node with send_last_published_item on_sub')
      expect((await reader.subscribe(replayNode, ctx.jid('reader'))).ok).toBe(true)
      await sleep(1_500)
      live.stop()
      const liveEvent = live.events.find((e) => e.node === node)?.xml ?? ''
      const replayEvent = live.events.find((e) => e.node === replayNode)?.xml ?? ''
      t.note('live event as received')
      t.lines.push(liveEvent)
      t.note('last-item replay on subscribe as received')
      t.lines.push(replayEvent)
      saveStanzas('s15-4-live-and-replay', t)
      ctx.observe('S15-4', 'live event and last-item replay', {
        liveEventEnvelope: envelope(liveEvent),
        liveEventItem: itemViews(liveEvent),
        replayEventEnvelope: envelope(replayEvent),
        replayEventItem: itemViews(replayEvent),
        replayDelay: /<delay\b[^>]*>/.exec(replayEvent)?.[0],
        replayEvents: live.events.filter((e) => e.node === replayNode).length,
        publishAcknowledgedAt: at,
      })
      await admin.deleteNode(node)
      await admin.deleteNode(replayNode)
      expect(liveEvent).not.toBe('')
      expect(envelope(liveEvent).timeLike).toEqual([])
      // The replay is the node's newest edit (not its newest creation), with a delay stamp.
      expect(itemViews(replayEvent).map((v) => v.text)).toEqual(['umpire v2'])
      expect(replayEvent).toMatch(/<delay\b[^>]*stamp=/)
    })

    it('S15-5 other server time sources: MAM on the PubSub service, entity time, node metadata', async () => {
      const t = new Transcript()
      const admin = ctx.ps(undefined, t, 'admin')
      const node = ctx.name('meta')
      await admin.create(node, objectivesConfig(10))
      await admin.setAffiliations(node, { [ctx.jid('reader')]: 'member' })
      must2(await admin.publish(node, 'admin', objectivesPayload('meta')))
      const reader = ctx.ps(await ctx.login('reader'), t, 'reader')
      const serviceInfo = await reader.discoInfo()
      const nodeInfo = await reader.discoInfo(node)
      const mam = await reader.iq('set', `<query xmlns='urn:xmpp:mam:2' node='${esc(node)}' queryid='q1'/>`)
      const time = await reader.iq('get', `<time xmlns='urn:xmpp:time'/>`, ctx.backend.domain)
      const serverInfo = await reader.discoInfo(undefined, ctx.backend.domain)
      saveStanzas('s15-5-time-sources', t)
      const brief = (r: { ok: boolean; condition?: string; text?: string }) =>
        r.ok ? 'ok' : `${r.condition ?? '?'}${r.text === undefined ? '' : `: ${r.text}`}`
      ctx.observe('S15-5', 'other time sources', {
        pubsubServiceFeaturesWithMam: features(serviceInfo.xml).filter((f) => /mam/.test(f)),
        nodeInfoTimeLike: envelope(nodeInfo.xml).timeLike,
        nodeInfoFields: [...nodeInfo.xml.matchAll(/<field\b[^>]*var=['"]([^'"]+)['"]/g)].map((m) => m[1]),
        mamOnPubsubNode: brief(mam),
        entityTime: brief(time),
        entityTimeFeature: features(serverInfo.xml).includes('urn:xmpp:time'),
      })
      await admin.deleteNode(node)
    })

    it('S15-7 max_items with two publishers', async () => {
      const t = new Transcript()
      const admin = ctx.ps(undefined, t, 'admin')
      const node = ctx.name('max1')
      expect((await admin.create(node, objectivesConfig(1))).ok).toBe(true)
      await admin.setAffiliations(node, { [ctx.jid('umpire')]: 'publisher', [ctx.jid('reader')]: 'member' })
      const umpire = ctx.ps(await ctx.login('umpire'), t, 'umpire')
      const reader = ctx.ps(await ctx.login('reader'))
      must2(await admin.publish(node, 'admin', objectivesPayload('a1')))
      must2(await umpire.publish(node, 'umpire', objectivesPayload('u1')))
      const afterTwo = itemViews((await reader.items(node)).xml).map((v) => v.id)
      must2(await admin.publish(node, 'admin-2', objectivesPayload('a2')))
      const afterThree = itemViews((await reader.items(node)).xml).map((v) => v.id)
      must2(await umpire.publish(node, 'umpire', objectivesPayload('u2')))
      const afterRepublish = itemViews((await reader.items(node)).xml)
      saveStanzas('s15-7-max-items', t)
      ctx.observe('S15-7', 'max_items 1, two publishers', {
        afterAdminAndUmpire: afterTwo,
        afterAdminPublishesASecondId: afterThree,
        afterUmpireRepublishes: afterRepublish.map((v) => `${v.id}:${v.text ?? '-'}`),
      })
      await admin.deleteNode(node)
      expect(afterTwo).toHaveLength(2)
    })

    // The rule S15 recommends for §3 rule 14: every edit is a new item with a fresh id, on a node
    // with max_items 1. ejabberd trims per publisher (S14, S15-7), so each author keeps exactly
    // its newest edit, and creation order is then edit order.
    it('S15-8 a new item id per edit, max_items 1: one item per author, in edit order', async () => {
      const t = new Transcript()
      const admin = ctx.ps(undefined, t, 'admin')
      const node = ctx.name('per-edit')
      expect((await admin.create(node, objectivesConfig(1))).ok).toBe(true)
      await admin.setAffiliations(node, { [ctx.jid('umpire')]: 'publisher', [ctx.jid('reader')]: 'member' })
      const umpire = ctx.ps(await ctx.login('umpire'), t, 'umpire')
      const readerSession = await ctx.login('reader')
      const reader = ctx.ps(readerSession, t, 'reader')
      expect((await reader.subscribe(node, ctx.jid('reader'))).ok).toBe(true)
      const live = recordNotifications(ctx.raw, readerSession)
      const edits: [Pubsub, string][] = [
        [admin, 'admin-e1'],
        [umpire, 'umpire-e1'],
        [admin, 'admin-e2'],
        [umpire, 'umpire-e2'],
        [umpire, 'umpire-e3'],
      ]
      const snapshots: { after: string; full: string[]; max1: string[]; max1Cursor?: string }[] = []
      for (const [p, id] of edits) {
        t.note(`${id} published`)
        must2(await p.publish(node, id, objectivesPayload(id)))
        snapshots.push({
          after: id,
          full: itemViews((await reader.items(node)).xml).map((v) => v.id),
          ...(await (async () => {
            const r = await reader.items(node, { max: 1 })
            const c = rsmCursors(r.xml).first
            return { max1: itemViews(r.xml).map((v) => v.id), ...(c === undefined ? {} : { max1Cursor: c }) }
          })()),
        })
      }
      // Clean-up when a role leaves the White Force (§3 rule 14): the owner retracts that
      // publisher's item, found by its `publisher` attribute.
      t.note('the owner retracts the umpire’s item')
      const ofUmpire = itemViews((await admin.items(node)).xml).filter((v) =>
        v.publisher?.startsWith(`${ctx.jid('umpire')}/`),
      )
      const retract = await admin.iq(
        'set',
        `<pubsub xmlns='${NS.pubsub}'><retract node='${esc(node)}' notify='true'>${ofUmpire.map((v) => `<item id='${esc(v.id)}'/>`).join('')}</retract></pubsub>`,
      )
      const afterRetract = itemViews((await reader.items(node)).xml).map((v) => v.id)
      await sleep(1_000)
      live.stop()
      saveStanzas('s15-8-new-id-per-edit', t)
      ctx.observe('S15-8', 'a new item id per edit, max_items 1', {
        ownerRetractsUmpireItems: { ids: ofUmpire.map((v) => v.id), reply: retract.ok ? 'ok' : retract.condition },
        afterRetract,
        snapshots,
        liveEvents: live.events.map((e) => `${e.kind}:${e.item}`),
        retractsForTrimmedItems: live.events.filter((e) => e.kind === 'retract').map((e) => e.item),
      })
      await admin.deleteNode(node)
      expect(snapshots.map((s) => s.full)).toEqual([
        ['admin-e1'],
        ['admin-e1', 'umpire-e1'],
        ['umpire-e1', 'admin-e2'],
        ['admin-e2', 'umpire-e2'],
        ['admin-e2', 'umpire-e3'],
      ])
      expect(snapshots.map((s) => s.max1[0])).toEqual(edits.map(([, id]) => id))
      // With a new id per edit, the cursor of max_items 1 is the newest edit's server time.
      const cursors = snapshots.map((s) => s.max1Cursor ?? '')
      expect(cursors.every((c, i) => i === 0 || c > (cursors[i - 1] ?? ''))).toBe(true)
      expect(retract.ok).toBe(true)
      expect(afterRetract).toEqual(['admin-e2'])
    })
  })
}
