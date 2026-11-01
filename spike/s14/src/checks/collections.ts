// S14-1 to S14-4, S14-6 and S14-7: XEP-0248 collection nodes and whether a leaf follows its
// collection's access. Each check sends the standard stanzas, records what the server answered
// (results/observations.jsonl, stanzas/<config>-s14-N-*.xml), and asserts the S14 pass criterion
// only where `expectCollections` says this server is meant to have collections.
import { describe, expect, it } from 'vitest'
import type { S14Ctx } from '../context.ts'
import { saveStanzas } from '../context.ts'
import { assetPayload, features, itemIds, itemNodes, NS, recordNotifications, Transcript, type IqReply } from '../pubsub.ts'
import { sleep } from '../../../../packages/contract-suite/src/harness.ts'

/** XEP-0248 §2 / XEP-0060 §10: the disco#info features S14-1 looks for. */
export const WANTED_FEATURES = [
  `${NS.pubsub}#collections`,
  `${NS.pubsub}#retrieve-items`,
  `${NS.pubsub}#subscribe`,
] as const

const brief = (r: IqReply) =>
  r.ok
    ? { ok: true }
    : { ok: false, condition: r.condition, type: r.errorType, app: r.appCondition, text: r.text }

/** Collection config (XEP-0248 §5.1): a whitelist collection. */
const COLLECTION = {
  'pubsub#node_type': 'collection',
  'pubsub#access_model': 'whitelist',
}

export function collections(ctx: S14Ctx, opts: { readonly expectCollections: boolean }): void {
  describe('S14 collections (XEP-0248)', () => {
    it('S14-1 feature discovery', async () => {
      const t = new Transcript()
      const admin = ctx.ps(undefined, t, 'admin')
      const info = await admin.discoInfo()
      const got = features(info.xml).filter((f) => f.startsWith(NS.pubsub))
      const missing = WANTED_FEATURES.filter((f) => !got.includes(f))
      ctx.observe('S14-1', 'disco#info on the PubSub service', {
        pass: missing.length === 0,
        missing,
        pubsubFeatures: got,
      })
      saveStanzas('s14-1-disco-info', t)
      expect(info.ok).toBe(true)
      // Recorded: the reference config advertises #collections although it has no collection
      // behaviour (S14-2 to S14-7), so the feature cannot be used to detect support.
      expect(missing).toEqual([])
    })

    it('S14-2 to S14-4, S14-6, S14-7: create, nest, access, late leaves, revocation', async () => {
      const t = new Transcript()
      const admin = ctx.ps(undefined, t, 'admin')
      const c1 = ctx.node('c1')
      const c2 = ctx.node('c2')
      const l0 = ctx.node('l0')
      const l1 = ctx.node('l1')
      const l2 = ctx.node('l2')
      const lw = ctx.node('lw')
      const steps: Record<string, unknown> = {}

      // S14-2: create the collection with the standard field (XEP-0248 §5.1).
      t.note('S14-2: create collection c1 (pubsub#node_type=collection, whitelist)')
      const createC1 = await admin.create(c1, COLLECTION)
      steps.createCollection = brief(createC1)
      // ejabberd's own extension: the plugin as an attribute of <create/> (not in XEP-0060).
      let createC1Typed: IqReply | undefined
      if (!createC1.ok) {
        t.note('S14-2: retry with ejabberd\'s non-standard type attribute on <create/>')
        createC1Typed = await admin.create(c1, COLLECTION, 'dag')
        steps.createCollectionTypeDag = brief(createC1Typed)
      }
      // Whatever c1 is, try the rest so the record shows each answer.
      if (!createC1.ok && !(createC1Typed?.ok ?? false)) {
        t.note('S14-2: c1 created as a plain node so the parent field can still be tried')
        steps.createC1Plain = brief(await admin.create(c1, { 'pubsub#access_model': 'whitelist' }))
      }
      const c1Config = await admin.getConfig(c1)
      steps.c1NodeType = /pubsub#node_type['"][^>]*>(?:[\s\S]*?)<value>([^<]*)<\/value>/.exec(c1Config.xml)?.[1] ?? 'absent'
      steps.c1HasCollectionField = c1Config.xml.includes("var='pubsub#collection'") || c1Config.xml.includes('var="pubsub#collection"')

      t.note('S14-2: leaf l1 in c1 (pubsub#collection=c1), no access config')
      steps.createLeaf = brief(await admin.create(l1, { 'pubsub#collection': c1 }))
      t.note('S14-2: nested collection c2 in c1, leaf l2 in c2')
      steps.createNested = brief(await admin.create(c2, { ...COLLECTION, 'pubsub#collection': c1 }))
      steps.createNestedLeaf = brief(await admin.create(l2, { 'pubsub#collection': c2 }))
      t.note('S14-2: move existing leaf l0 into c1 by configuration')
      steps.createL0 = brief(await admin.create(l0))
      steps.moveLeaf = brief(await admin.configure(l0, { 'pubsub#collection': c1 }))
      t.note('S14-3: leaf lw in c1 with whitelist and no affiliations')
      steps.createWhitelistLeaf = brief(
        await admin.create(lw, { 'pubsub#collection': c1, 'pubsub#access_model': 'whitelist' }),
      )
      const children = itemNodes((await admin.discoItems(c1)).xml)
      steps.c1Children = children.map((n) => n.replace(/^.*:/, ''))
      const l1Config = await admin.getConfig(l1)
      steps.l1AccessModel = /pubsub#access_model['"][^>]*>(?:[\s\S]*?)<value>([^<]*)<\/value>/.exec(l1Config.xml)?.[1]
      steps.l1HasCollectionField = l1Config.xml.includes("var='pubsub#collection'")
      // XEP-0248 §4: a collection holds no items, so a publish to it must be refused.
      t.note('S14-2: publish an item to the collection itself (XEP-0248: must be refused)')
      steps.publishToCollection = brief(await admin.publish(c1, 'x1', assetPayload('x1')))
      const nested = itemNodes((await admin.discoItems(c2)).xml)
      const s142 =
        (createC1.ok || (createC1Typed?.ok ?? false)) &&
        [l1, c2, l0].every((n) => children.includes(n)) &&
        nested.includes(l2)
      ctx.observe('S14-2', 'create and nest collections', { pass: s142, ...steps })
      saveStanzas('s14-2-create-nest', t)

      // S14-3: c1 whitelists blue; who can read each leaf?
      const t3 = new Transcript()
      const admin3 = ctx.ps(undefined, t3, 'admin')
      t3.note('S14-3: blue affiliated member on c1 only')
      const aff = await admin3.setAffiliations(c1, { [ctx.jid('blue')]: 'member' })
      for (const [node, id] of [
        [l1, 'a1'],
        [lw, 'w1'],
        [l2, 'n1'],
      ] as const)
        await admin3.publish(node, id, assetPayload(id))
      const blue = ctx.ps(await ctx.login('blue'), t3, 'blue')
      const red = ctx.ps(await ctx.login('red'), t3, 'red')
      const anon = ctx.ps(await ctx.anonymous(), t3, 'anonymous')
      const reads: Record<string, Record<string, unknown>> = {}
      for (const [label, node] of [
        ['c1 (collection)', c1],
        ['l1 (no access config)', l1],
        ['lw (whitelist, no affiliations)', lw],
        ['l2 (in nested c2)', l2],
      ] as const) {
        const row: Record<string, unknown> = {}
        for (const [who, ps] of [
          ['blue', blue],
          ['red', red],
          ['anonymous', anon],
        ] as const) {
          const r = await ps.items(node)
          row[who] = r.ok ? `read ${itemIds(r.xml).length} item(s)` : `${r.condition ?? '?'}${r.appCondition === undefined ? '' : `/${r.appCondition}`}`
        }
        reads[label] = row
      }
      const follows = (label: string) => {
        const row = reads[label] ?? {}
        return String(row.blue).startsWith('read') && !String(row.red).startsWith('read') && !String(row.anonymous).startsWith('read')
      }
      const s143 = follows('l1 (no access config)') || follows('lw (whitelist, no affiliations)')
      ctx.observe('S14-3', 'access inheritance', {
        pass: s143,
        setAffiliationOnC1: brief(aff),
        reads,
        leafFollowsCollection: {
          noAccessConfig: follows('l1 (no access config)'),
          emptyWhitelist: follows('lw (whitelist, no affiliations)'),
        },
      })
      saveStanzas('s14-3-access', t3)

      // S14-4: red reads l1 directly, subscribes to it, and lists c1's children.
      const t4 = new Transcript()
      const red4 = red.recording(t4, 'red')
      const directRead = await red4.items(l1)
      const directSub = await red4.subscribe(l1, ctx.jid('red'))
      const names = await red4.discoItems(c1)
      const lwRead = await red4.items(lw)
      const s144 = !directRead.ok && !directSub.ok
      ctx.observe('S14-4', 'direct read and subscribe by an outsider', {
        pass: s144,
        readL1: brief(directRead),
        subscribeL1: brief(directSub),
        readLw: brief(lwRead),
        discoItemsC1: names.ok ? { ok: true, names: itemNodes(names.xml).map((n) => n.replace(/^.*:/, '')) } : brief(names),
      })
      saveStanzas('s14-4-direct', t4)
      if (directSub.ok) await red.unsubscribe(l1, ctx.jid('red'))

      // S14-6: blue subscribes to the collection (XEP-0248 §6.1, depth all), then a leaf is added.
      const t6 = new Transcript()
      const blue6 = blue.recording(t6, 'blue')
      const admin6 = ctx.ps(undefined, t6, 'admin')
      const notes = recordNotifications(ctx.raw, blue.session)
      const sub = await blue6.subscribe(c1, ctx.jid('blue'), {
        'pubsub#subscription_type': 'items',
        'pubsub#subscription_depth': 'all',
      })
      const subPlain = sub.ok ? undefined : await blue6.subscribe(c1, ctx.jid('blue'))
      const late = ctx.node('late')
      const createLate = await admin6.create(late, { 'pubsub#collection': c1 })
      const pubExisting = await admin6.publish(l1, 'a2', assetPayload('a2'))
      const pubLate = await admin6.publish(late, 'late1', assetPayload('late1'))
      await sleep(1_500)
      const got6 = notes.events.filter((e) => e.kind === 'items').map((e) => `${e.node.replace(/^.*:/, '')}/${e.item}`)
      const s146 = got6.includes('late/late1')
      ctx.observe('S14-6', 'leaf added after the collection subscription', {
        pass: s146,
        subscribeCollectionWithOptions: brief(sub),
        ...(subPlain === undefined ? {} : { subscribeCollectionPlain: brief(subPlain) }),
        createLateLeaf: brief(createLate),
        publishExisting: brief(pubExisting),
        publishLate: brief(pubLate),
        notificationsToBlue: got6,
      })
      saveStanzas('s14-6-late-leaf', t6)

      // S14-7: revoke blue on c1 (affiliation none, and the subscription, as ADM-36 does).
      const t7 = new Transcript()
      const admin7 = ctx.ps(undefined, t7, 'admin')
      const blue7 = blue.recording(t7, 'blue')
      const before = notes.events.length
      const revokeAff = await admin7.setAffiliations(c1, { [ctx.jid('blue')]: 'none' })
      const revokeSub = await admin7.setSubscriptions(c1, { [ctx.jid('blue')]: 'none' })
      await admin7.publish(l1, 'a3', assetPayload('a3'))
      await sleep(1_500)
      const after = notes.events.slice(before).filter((e) => e.kind === 'items')
      const readAfter = await blue7.items(l1)
      const readLwAfter = await blue7.items(lw)
      notes.stop()
      const s147 = !readAfter.ok && !readLwAfter.ok && after.length === 0
      ctx.observe('S14-7', 'revocation', {
        pass: s147,
        revokeAffiliation: brief(revokeAff),
        revokeSubscription: brief(revokeSub),
        notificationsAfter: after.length,
        readL1After: brief(readAfter),
        readLwAfter: brief(readLwAfter),
      })
      saveStanzas('s14-7-revocation', t7)

      for (const n of [late, l2, c2, lw, l1, l0, c1]) await ctx.ps().deleteNode(n)

      const passes = { s142, s143, s144, s146, s147 }
      if (opts.expectCollections) {
        expect(passes).toEqual({ s142: true, s143: true, s144: true, s146: true, s147: true })
      } else {
        // Recorded ejabberd 26.09 behaviour with the reference config (flat nodes, default tree):
        // the collection fields are accepted and ignored. If this ever changes, re-run S14.
        expect(passes).toEqual({ s142: false, s143: false, s144: false, s146: false, s147: false })
        expect(steps).toMatchObject({ createCollection: { ok: true }, createLeaf: { ok: true }, moveLeaf: { ok: true }, c1Children: [] })
        expect(reads['l1 (no access config)']).toEqual({ blue: 'read 1 item(s)', red: 'read 1 item(s)', anonymous: 'read 1 item(s)' })
        // The only notification is c1's own last item, sent on subscribing: c1 is a plain leaf
        // that accepted a publish (S14-2), not a collection. Nothing arrives from its "leaves".
        expect(got6).toEqual(['c1/x1'])
      }
    })
  })
}
