// S15 PubSub item order (WP 5.8, §3 rule 14). Port of the follow-up spike checks S15-2, S15-7
// and S15-8 (spike/s15-s16/src/checks/s15-timestamps.ts, decision plan/decisions/S15.md) from
// raw stanzas to the transport interface, so both backends must pass them (ARC-11). ejabberd
// 26.09 carries no time on a fetched item and orders items by their first publish; objectives
// readers rely on exactly that, with a new item id per edit on a node keeping one item per
// publisher, so these checks guard it across server upgrades (NFR-22).
import type { ItemsEvent, NodeConfig, Session } from '@wrx/transport'
import { afterAll, describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { json, must, record, sleep, uniq } from '../harness.ts'

const QUIET_MS = 1_000

const ids = async (session: Session, node: string, max?: number): Promise<string[]> =>
  must(
    await session.pubsub.getItems(node, max === undefined ? undefined : { max }),
    `read ${node}`,
  ).map((i) => i.id)

export function s15(ctx: Ctx): void {
  describe('S15 PubSub item order (§3 rule 14)', () => {
    const created: string[] = []
    afterAll(async () => {
      for (const node of created) await ctx.admin().pubsub.deleteNode(node)
    })

    /**
     * A node as the admin tooling makes an objectives node (whitelist, publishers), with the
     * admin (owner) and the umpire (publisher) writing and blue-co (member) reading.
     */
    async function freshNode(maxItems: number): Promise<string> {
      const fx = ctx.fx()
      const node = `${fx.tag}:${uniq('s15')}`
      const config: NodeConfig = {
        accessModel: 'whitelist',
        publishModel: 'publishers',
        maxItems,
        notifyRetract: true,
      }
      must(await ctx.admin().pubsub.createNode(node, config), 'create node')
      created.push(node)
      must(
        await ctx.admin().pubsub.setAffiliations(node, [
          { jid: ctx.jid(fx.users.umpire), affiliation: 'publisher' },
          { jid: ctx.jid(fx.users.blueCo), affiliation: 'member' },
        ]),
        'affiliations',
      )
      return node
    }

    // S15-2: a full fetch lists items oldest created first, and re-publishing an item changes
    // its payload but not its place, so a fixed id per author would make the newest edit
    // unfindable. `max` through the transport is an RSM page from the start of that order (the
    // spike's bare `max_items` gave the newest; StanzaJS also sends an RSM set, which ejabberd
    // honours), so it gives the oldest: readers that want the newest must fetch every item.
    it('S15-2 items are in creation order, and a re-published item does not move', async () => {
      const fx = ctx.fx()
      const node = await freshNode(10)
      const admin = ctx.admin()
      const umpire = await ctx.login(fx.users.umpire)
      const reader = await ctx.login(fx.users.blueCo)
      must(await admin.pubsub.publish(node, 'admin', json({ v: 'admin v1' })), 'step 1')
      must(await umpire.pubsub.publish(node, 'umpire', json({ v: 'umpire v1' })), 'step 2')
      must(await admin.pubsub.publish(node, 'admin-2', json({ v: 'admin-2 v1' })), 'step 3')
      must(await umpire.pubsub.publish(node, 'umpire', json({ v: 'umpire v2' })), 'step 4')
      expect(await ids(reader, node)).toEqual(['admin', 'umpire', 'admin-2'])
      expect(await ids(reader, node, 1)).toEqual(['admin'])
      expect(await ids(reader, node, 2)).toEqual(['admin', 'umpire'])
      must(await admin.pubsub.publish(node, 'admin', json({ v: 'admin v2' })), 'step 5')
      const items = must(await reader.pubsub.getItems(node), 'read after step 5')
      expect(items.map((i) => `${i.id}:${(JSON.parse(i.payload) as { v: string }).v}`)).toEqual([
        'admin:admin v2',
        'umpire:umpire v2',
        'admin-2:admin-2 v1',
      ])
      const adminJid = admin.jid.split('/')[0]
      expect(items.map((i) => i.publisher)).toEqual([adminJid, ctx.jid(fx.users.umpire), adminJid])
    })

    // S15-7: `max_items` 1 keeps one item per publisher, not one per node.
    it('S15-7 max_items 1 with two publishers keeps one item each', async () => {
      const fx = ctx.fx()
      const node = await freshNode(1)
      const admin = ctx.admin()
      const umpire = await ctx.login(fx.users.umpire)
      const reader = await ctx.login(fx.users.blueCo)
      must(await admin.pubsub.publish(node, 'admin', json({ v: 'a1' })), 'admin a1')
      must(await umpire.pubsub.publish(node, 'umpire', json({ v: 'u1' })), 'umpire u1')
      expect(await ids(reader, node)).toEqual(['admin', 'umpire'])
      must(await admin.pubsub.publish(node, 'admin-2', json({ v: 'a2' })), 'admin a2')
      expect(await ids(reader, node)).toEqual(['umpire', 'admin-2'])
      must(await umpire.pubsub.publish(node, 'umpire', json({ v: 'u2' })), 'umpire u2')
      const items = must(await reader.pubsub.getItems(node), 'read')
      expect(items.map((i) => `${i.id}:${(JSON.parse(i.payload) as { v: string }).v}`)).toEqual([
        'umpire:u2',
        'admin-2:a2',
      ])
    })

    // S15-8, the rule §3 rule 14 adopts: each edit a new id, `max_items` 1. Each author keeps its
    // newest edit, the fetch's last item is the newest edit, a subscriber hears each
    // item and then a retract for the author's trimmed item, and the owner retracts an author's
    // item found by its publisher (clean-up when a role leaves the White Force).
    it('S15-8 a new item id per edit: one item per author, in edit order', async () => {
      const fx = ctx.fx()
      const node = await freshNode(1)
      const admin = ctx.admin()
      const umpire = await ctx.login(fx.users.umpire)
      const reader = await ctx.login(fx.users.blueCo)
      must(await reader.pubsub.subscribe(node), 'subscribe')
      const events = record<ItemsEvent>((l) => reader.pubsub.onItems(node, l))
      const edits: [Session, string][] = [
        [admin, 'admin-e1'],
        [umpire, 'umpire-e1'],
        [admin, 'admin-e2'],
        [umpire, 'umpire-e2'],
        [umpire, 'umpire-e3'],
      ]
      const full: string[][] = []
      for (const [session, id] of edits) {
        must(await session.pubsub.publish(node, id, json({ v: id })), id)
        full.push(await ids(reader, node))
      }
      expect(full).toEqual([
        ['admin-e1'],
        ['admin-e1', 'umpire-e1'],
        ['umpire-e1', 'admin-e2'],
        ['admin-e2', 'umpire-e2'],
        ['admin-e2', 'umpire-e3'],
      ])
      expect(full.map((f) => f[f.length - 1])).toEqual(edits.map(([, id]) => id))

      const byUmpire = must(await admin.pubsub.getItems(node), 'owner reads').filter(
        (i) => i.publisher === ctx.jid(fx.users.umpire),
      )
      expect(byUmpire.map((i) => i.id)).toEqual(['umpire-e3'])
      for (const item of byUmpire) must(await admin.pubsub.retract(node, item.id), 'owner retracts')
      expect(await ids(reader, node)).toEqual(['admin-e2'])

      await events.next((e) => e.retracted.includes('umpire-e3'))
      await sleep(QUIET_MS)
      const seen = events.events.flatMap((e) => [
        ...e.items.map((i) => i.id),
        ...e.retracted.map((id) => `-${id}`),
      ])
      expect(seen).toEqual([
        'admin-e1',
        'umpire-e1',
        'admin-e2',
        '-admin-e1',
        'umpire-e2',
        '-umpire-e1',
        'umpire-e3',
        '-umpire-e2',
        '-umpire-e3',
      ])
    })
  })
}
