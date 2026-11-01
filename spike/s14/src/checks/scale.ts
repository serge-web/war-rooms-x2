// S14-5 (one collection subscription over 600 and 1,200 leaves), the same scale with plain leaves
// whose access the admin sets on each one (the node-per-asset layout without collections), and
// S14-10 (the fallback: one node per force holding one item per asset).
import { describe, expect, it } from 'vitest'
import { sleep } from '../../../../packages/contract-suite/src/harness.ts'
import { DB, SCALES } from '../config.ts'
import type { S14Ctx } from '../context.ts'
import { saveStanzas } from '../context.ts'
import { memoryMiB } from '../docker.ts'
import {
  assetPayload,
  esc,
  itemIds,
  p95,
  recordNotifications,
  rsmOf,
  Transcript,
  type IqReply,
  type Notification,
  type Pubsub,
} from '../pubsub.ts'

/** Runs `op` over `inputs` with at most `window` in flight; returns replies in input order. */
async function pipelined<T>(inputs: readonly T[], window: number, op: (x: T) => Promise<IqReply>): Promise<IqReply[]> {
  const out: IqReply[] = new Array<IqReply>(inputs.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < inputs.length) {
      const i = next++
      out[i] = await op(inputs[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(window, inputs.length) }, () => worker()))
  return out
}

/** About 12 fields, as AD2 sizes an asset. */
const ASSET_FIELDS = ` name='Asset' kind='aircraft' force='blue' lat='51.5072' lon='-0.1276' heading='270' speed='420' altitude='9000' status='active' fuel='0.82' crew='4' updated='2026-11-01T12:00:00Z'`

interface Delivery {
  expected: number
  received: number
  unique: number
  duplicates: number
  p95LatencyMs: number
  maxLatencyMs: number
}

function delivery(events: readonly Notification[], expected: readonly string[]): Delivery {
  const items = events.filter((e) => e.kind === 'items')
  const keys = items.map((e) => `${e.node}/${e.item}`)
  const want = new Set(expected)
  const got = keys.filter((k) => want.has(k))
  const lat = items.filter((e) => e.sentAt !== undefined).map((e) => e.receivedAt - (e.sentAt ?? 0))
  return {
    expected: expected.length,
    received: got.length,
    unique: new Set(got).size,
    duplicates: got.length - new Set(got).size,
    p95LatencyMs: p95(lat),
    maxLatencyMs: lat.length === 0 ? Number.NaN : Math.max(...lat),
  }
}

/** Waits until `count()` stops growing for `quietMs` or reaches `target`. */
async function settle(count: () => number, target: number, quietMs = 2_000, maxMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxMs
  let last = -1
  let since = Date.now()
  while (Date.now() < deadline && count() < target) {
    const c = count()
    if (c !== last) {
      last = c
      since = Date.now()
    } else if (Date.now() - since > quietMs) return
    await sleep(100)
  }
}

const failures = (rs: readonly IqReply[]) => {
  const bad = rs.filter((r) => !r.ok)
  return { failed: bad.length, ...(bad[0] === undefined ? {} : { firstError: `${bad[0].condition ?? '?'}: ${bad[0].text ?? ''}` }) }
}

export function scale(ctx: S14Ctx, opts: { readonly expectCollections: boolean }): void {
  describe('S14 scale', () => {
    for (const n of SCALES) {
      it(`S14-5 one collection subscription over ${n} leaves`, async () => {
        const admin = ctx.ps()
        const t = new Transcript()
        const c = ctx.node(`scale-c-${n}`)
        const mem0 = await memoryMiB(DB)
        expect((await admin.create(c, { 'pubsub#node_type': 'collection', 'pubsub#access_model': 'whitelist' })).ok).toBe(true)
        await admin.setAffiliations(c, { [ctx.jid('blue')]: 'member' })
        const blue = ctx.ps(await ctx.login('blue'), t, 'blue')
        const notes = recordNotifications(ctx.raw, blue.session)
        const sub = await blue.subscribe(c, ctx.jid('blue'), {
          'pubsub#subscription_type': 'items',
          'pubsub#subscription_depth': 'all',
        })
        const leaves = Array.from({ length: n }, (_, i) => ctx.node(`scale-l${n}-${i}`))
        const t0 = performance.now()
        const created = await pipelined(leaves, 16, (l) => admin.create(l, { 'pubsub#collection': c }))
        const createMs = performance.now() - t0
        const t1 = performance.now()
        const published = await pipelined(leaves, 32, (l) => admin.publish(l, 'item-1', assetPayload(l, ASSET_FIELDS)))
        const publishMs = performance.now() - t1
        await settle(() => notes.events.length, n, 3_000)
        notes.stop()
        const d = delivery(notes.events, leaves.map((l) => `${l}/item-1`))
        const mem1 = await memoryMiB(DB)
        const pass = d.received === n && d.duplicates === 0 && d.p95LatencyMs <= 1_000
        ctx.observe('S14-5', `collection subscription, ${n} leaves`, {
          pass,
          leaves: n,
          subscribe: sub.ok ? { ok: true } : { ok: false, condition: sub.condition },
          create: { ms: Math.round(createMs), perNodeMs: +(createMs / n).toFixed(2), ...failures(created) },
          publish: { ms: Math.round(publishMs), ...failures(published) },
          delivery: d,
          memoryMiB: { before: +mem0.toFixed(1), after: +mem1.toFixed(1) },
        })
        saveStanzas(`s14-5-subscribe-collection-${n}`, t)
        const t0d = performance.now()
        await pipelined([...leaves, c], 16, (l) => admin.deleteNode(l))
        ctx.observe('S14-5', `cleanup, ${n} leaves`, { deleteMs: Math.round(performance.now() - t0d) })
        if (opts.expectCollections) expect(pass).toBe(true)
        else expect(d.received).toBe(0)
      })

      it(`S14-5 without collections: ${n} plain leaves, access and subscription set on each`, async () => {
        const admin = ctx.ps()
        const blueJid = ctx.jid('blue')
        const mem0 = await memoryMiB(DB)
        const leaves = Array.from({ length: n }, (_, i) => ctx.node(`flat-l${n}-${i}`))
        const t0 = performance.now()
        const created = await pipelined(leaves, 16, (l) => admin.create(l, { 'pubsub#access_model': 'whitelist', 'pubsub#max_items': '10' }))
        const createMs = performance.now() - t0
        const t1 = performance.now()
        const affs = await pipelined(leaves, 16, (l) => admin.setAffiliations(l, { [blueJid]: 'member' }))
        const affMs = performance.now() - t1
        const t2 = performance.now()
        const subs = await pipelined(leaves, 16, (l) => admin.setSubscriptions(l, { [blueJid]: 'subscribed' }))
        const subMs = performance.now() - t2
        const blue = ctx.ps(await ctx.login('blue'))
        const notes = recordNotifications(ctx.raw, blue.session)
        // Logging in with send_last_published_item=on_sub_and_presence delivers nothing yet (no items).
        await sleep(500)
        const atLogin = notes.events.length
        const t3 = performance.now()
        const published = await pipelined(leaves, 32, (l) => admin.publish(l, 'item-1', assetPayload(l, ASSET_FIELDS)))
        const publishMs = performance.now() - t3
        await settle(() => notes.events.length - atLogin, n, 3_000)
        notes.stop()
        const d = delivery(notes.events, leaves.map((l) => `${l}/item-1`))
        const mem1 = await memoryMiB(DB)
        // A second login: with items present, on_sub_and_presence sends the last item of every
        // subscribed node to the new session.
        const blueAgain = ctx.ps(await ctx.login('blue'))
        const replay = recordNotifications(ctx.raw, blueAgain.session)
        await settle(() => replay.events.length, n, 3_000, 30_000)
        replay.stop()
        const pass = d.received === n && d.duplicates === 0 && d.p95LatencyMs <= 1_000
        ctx.observe('S14-5', `plain leaves (no collection), ${n} leaves`, {
          pass,
          leaves: n,
          create: { ms: Math.round(createMs), perNodeMs: +(createMs / n).toFixed(2), ...failures(created) },
          affiliate: { ms: Math.round(affMs), ...failures(affs) },
          subscribeByOwner: { ms: Math.round(subMs), ...failures(subs) },
          publish: { ms: Math.round(publishMs), ...failures(published) },
          delivery: d,
          lastItemsSentToNextLogin: replay.events.filter((e) => e.kind === 'items').length,
          memoryMiB: { before: +mem0.toFixed(1), after: +mem1.toFixed(1) },
        })
        await pipelined(leaves, 16, (l) => admin.deleteNode(l))
        expect(failures(created).failed + failures(affs).failed + failures(subs).failed).toBe(0)
        expect(d.received).toBe(n)
        expect(d.duplicates).toBe(0)
      })
    }

    it('S14-10 fallback: one node per force with one item per asset', async () => {
      const t = new Transcript()
      const admin = ctx.ps()
      const adminT = ctx.ps(undefined, t, 'admin')
      const node = ctx.node('force-assets-blue')
      const blueJid = ctx.jid('blue')
      const out: Record<string, unknown> = {}
      expect((await adminT.create(node, { 'pubsub#access_model': 'whitelist', 'pubsub#max_items': '600' })).ok).toBe(true)
      await adminT.setAffiliations(node, { [blueJid]: 'member', [ctx.jid('blue2')]: 'publisher' })
      await adminT.setSubscriptions(node, { [blueJid]: 'subscribed' })
      const blue = ctx.ps(await ctx.login('blue'))
      const notes = recordNotifications(ctx.raw, blue.session)
      const mem0 = await memoryMiB(DB)
      const ids = Array.from({ length: 600 }, (_, i) => `asset-${String(i).padStart(4, '0')}`)
      // The admin publishing every asset, 32 in flight.
      const t0 = performance.now()
      const pubs = await pipelined(ids, 32, (id) => admin.publish(node, id, assetPayload(id, ASSET_FIELDS)))
      const adminMs = performance.now() - t0
      await settle(() => notes.events.length, 600, 3_000)
      out.adminPublish = { items: 600, ms: Math.round(adminMs), perSecond: Math.round(600 / (adminMs / 1000)), ...failures(pubs) }
      out.deliveryAdminPublish = delivery(notes.events, ids.map((id) => `${node}/${id}`))
      out.itemBytes = assetPayload('asset-0000', ASSET_FIELDS).length
      // A player (publisher affiliation) updating 600 of its own items one at a time, through the
      // player shaper (50 kB/s, 300 kB burst).
      const blue2 = ctx.ps(await ctx.login('blue2'))
      const before = notes.events.length
      const ids2 = ids.map((id) => `${id}-b2`)
      await adminT.configure(node, { 'pubsub#max_items': '1200' }).then((r) => (out.raiseMaxItemsTo1200 = r.ok ? 'ok' : `${r.condition ?? '?'}: ${r.text ?? ''}`))
      const t1 = performance.now()
      const pubs2: IqReply[] = []
      for (const id of ids2) pubs2.push(await blue2.publish(node, id, assetPayload(id, ASSET_FIELDS)))
      const playerMs = performance.now() - t1
      await settle(() => notes.events.length - before, 600, 3_000)
      out.playerPublishSequential = { items: 600, ms: Math.round(playerMs), perSecond: Math.round(600 / (playerMs / 1000)), ...failures(pubs2) }
      out.deliveryPlayerPublish = delivery(notes.events.slice(before), ids2.map((id) => `${node}/${id}`))
      notes.stop()
      // Retrieval: everything at once, then RSM pages of 50 (XEP-0059).
      const t2 = performance.now()
      const all = await blue.items(node)
      out.retrieveAll = { ok: all.ok, items: itemIds(all.xml).length, bytes: all.xml.length, ms: Math.round(performance.now() - t2), rsm: rsmOf(all.xml) }
      const t3 = performance.now()
      const seen: string[] = []
      let after: string | undefined
      let pages = 0
      let pageError: string | undefined
      for (;;) {
        const page = await (pages === 0 ? blue.recording(t, 'blue') : blue).items(node, { rsm: { max: 50, ...(after === undefined ? {} : { after }) } })
        pages++
        if (!page.ok) {
          pageError = `${page.condition ?? '?'}: ${page.text ?? ''}`
          break
        }
        const got = itemIds(page.xml)
        seen.push(...got)
        const r = rsmOf(page.xml)
        if (got.length === 0 || r.last === undefined || pages > 60) break
        after = r.last
      }
      out.retrieveRsm50 = {
        pages,
        items: seen.length,
        unique: new Set(seen).size,
        ms: Math.round(performance.now() - t3),
        ...(pageError === undefined ? {} : { error: pageError }),
      }
      const t4 = performance.now()
      const one = await blue.iq('get', `<pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='${esc(node)}'><item id='asset-0042'/></items></pubsub>`)
      out.retrieveOneById = { ok: one.ok, items: itemIds(one.xml).length, ms: Math.round(performance.now() - t4) }
      // The server's per-node cap (max_items_node, stock 1000).
      const over = await adminT.configure(node, { 'pubsub#max_items': '1500' })
      out.setMaxItems1500 = over.ok ? 'ok' : `${over.condition ?? '?'}: ${over.text ?? ''}`
      const ids3 = Array.from({ length: 400 }, (_, i) => `extra-${i}`)
      await pipelined(ids3, 32, (id) => admin.publish(node, id, assetPayload(id)))
      const count = await admin.items(node)
      // max_items 600 is still set. Count what survives, by who published it.
      const kept = itemIds(count.xml)
      out.itemsKeptAfter1600Publishes = {
        total: kept.length,
        byAdmin: kept.filter((id) => !id.endsWith('-b2')).length,
        byAdminOriginal: kept.filter((id) => id.startsWith('asset-') && !id.endsWith('-b2')).length,
        byAdminExtra: kept.filter((id) => id.startsWith('extra-')).length,
        byBlue2: kept.filter((id) => id.endsWith('-b2')).length,
      }
      out.memoryMiB = { before: +mem0.toFixed(1), after: +(await memoryMiB(DB)).toFixed(1) }
      ctx.observe('S14-10', 'one node per force, 600 assets', out)
      saveStanzas('s14-10-fallback', t)
      await admin.deleteNode(node)
      expect(out.retrieveRsm50).toMatchObject({ items: 1200, unique: 1200 })
    })
  })
}
