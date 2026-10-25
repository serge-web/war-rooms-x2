// S06 publisher notifications: who is told of a publish, with what, in what order. Port of spike
// S06-publisher-notifications.test.ts (which recorded; these assert what the interface promises).
import type { ItemsEvent } from '@wrx/transport'
import { afterAll, describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { WHITELIST_NODE } from '../fixture.ts'
import { json, must, record, sleep, uniq } from '../harness.ts'

const QUIET_MS = 1_500

export function s06(ctx: Ctx): void {
  describe('S06 publisher notifications', () => {
    const created: string[] = []
    afterAll(async () => {
      for (const node of created) await ctx.admin().pubsub.deleteNode(node)
    })

    /** A fresh whitelist node with the umpire as publisher and blue-co as reader. */
    async function freshNode(): Promise<string> {
      const fx = ctx.fx()
      const node = `${fx.tag}:${uniq('s06')}`
      must(await ctx.admin().pubsub.createNode(node, WHITELIST_NODE), 'create node')
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

    const published = (events: readonly ItemsEvent[], id: string): ItemsEvent[] =>
      events.filter((e) => e.items.some((i) => i.id === id))

    // XEP-0060 §7.1.2.1: subscribers are notified with the payload (deliver_payloads). Whether
    // the publisher is told of its own publish is the service's choice; the interface promises
    // it is (S6), so every session sees one stream.
    it('subscribers, the publisher included, get one event each, with payload and publisher', async () => {
      const fx = ctx.fx()
      const node = await freshNode()
      const umpire = await ctx.login(fx.users.umpire)
      const blue = await ctx.login(fx.users.blueCo)
      must(await umpire.pubsub.subscribe(node), 'umpire subscribes')
      must(await blue.pubsub.subscribe(node), 'blue subscribes')
      const toUmpire = record<ItemsEvent>((l) => umpire.pubsub.onItems(node, l))
      const toBlue = record<ItemsEvent>((l) => blue.pubsub.onItems(node, l))
      const payload = json({ text: 'orders', n: 1 })
      must(await umpire.pubsub.publish(node, 'current', payload), 'publish')
      await toBlue.next((e) => e.items.some((i) => i.id === 'current'))
      await toUmpire.next((e) => e.items.some((i) => i.id === 'current'))
      await sleep(QUIET_MS)
      for (const r of [toBlue, toUmpire]) {
        const events = published(r.events, 'current')
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ node, retracted: [], deleted: false })
        const item = events[0]?.items[0]
        expect(item === undefined ? undefined : JSON.parse(item.payload)).toEqual(
          JSON.parse(payload),
        )
        expect(item?.publisher).toBe(ctx.jid(fx.users.umpire))
      }
      const items = must(await blue.pubsub.getItems(node), 'read')
      expect(items.map((i) => i.publisher)).toEqual([ctx.jid(fx.users.umpire)])
    })

    // §7.1.2.1 delivery order is the publish order (spike S6: 1 then 2).
    it('back-to-back publishes arrive in publish order', async () => {
      const fx = ctx.fx()
      const node = await freshNode()
      const umpire = await ctx.login(fx.users.umpire)
      const blue = await ctx.login(fx.users.blueCo)
      must(await blue.pubsub.subscribe(node), 'subscribe')
      const events = record<ItemsEvent>((l) => blue.pubsub.onItems(node, l))
      const sends = [1, 2, 3].map((n) => umpire.pubsub.publish(node, `i${n}`, json({ n })))
      for (const r of await Promise.all(sends)) must(r, 'publish')
      await events.next((e) => e.items.some((i) => i.id === 'i3'))
      expect(events.events.flatMap((e) => e.items.map((i) => i.id))).toEqual(['i1', 'i2', 'i3'])
    })

    // §7.2.2.1 retract notifications (notify_retract) and §8.4.2 delete notifications.
    it('retracts and node deletion are notified', async () => {
      const fx = ctx.fx()
      const node = await freshNode()
      const umpire = await ctx.login(fx.users.umpire)
      const blue = await ctx.login(fx.users.blueCo)
      must(await blue.pubsub.subscribe(node), 'subscribe')
      must(await umpire.pubsub.publish(node, 'gone', json({ n: 1 })), 'publish')
      const events = record<ItemsEvent>((l) => blue.pubsub.onItems(node, l))
      must(await umpire.pubsub.retract(node, 'gone'), 'retract')
      const retract = await events.next((e) => e.retracted.length > 0)
      expect(retract).toMatchObject({ node, items: [], retracted: ['gone'], deleted: false })
      expect(must(await blue.pubsub.getItems(node), 'read').map((i) => i.id)).toEqual([])
      must(await ctx.admin().pubsub.deleteNode(node), 'delete node')
      const deleted = await events.next((e) => e.deleted)
      expect(deleted).toMatchObject({ node, items: [], retracted: [], deleted: true })
    })

    // §6.1 subscriptions by full JID (WP 1.6): two sessions of one role subscribe; one
    // unsubscribes (§6.2) and the other still gets the events (D22).
    it('one session unsubscribing leaves another session of the same account subscribed', async () => {
      const fx = ctx.fx()
      const node = await freshNode()
      const umpire = await ctx.login(fx.users.umpire)
      const tab1 = await ctx.login(fx.users.blueCo)
      const tab2 = await ctx.login(fx.users.blueCo)
      must(await tab1.pubsub.subscribe(node), 'tab 1 subscribes')
      must(await tab2.pubsub.subscribe(node), 'tab 2 subscribes')
      const one = record<ItemsEvent>((l) => tab1.pubsub.onItems(node, l))
      const two = record<ItemsEvent>((l) => tab2.pubsub.onItems(node, l))
      must(await umpire.pubsub.publish(node, 'a', json({ n: 1 })), 'publish a')
      await one.next((e) => e.items.some((i) => i.id === 'a'))
      await two.next((e) => e.items.some((i) => i.id === 'a'))
      must(await tab1.pubsub.unsubscribe(node), 'tab 1 unsubscribes')
      must(await umpire.pubsub.publish(node, 'b', json({ n: 2 })), 'publish b')
      await two.next((e) => e.items.some((i) => i.id === 'b'))
      await sleep(QUIET_MS)
      expect(published(one.events, 'b')).toEqual([])
      expect(published(one.events, 'a')).toHaveLength(1)
      expect(published(two.events, 'a')).toHaveLength(1)
    })

    // Events report publishes only: a session that is not subscribed hears nothing, and logging
    // in replays nothing (no send_last_published_item).
    it('no events without a subscription, and none replayed on login', async () => {
      const fx = ctx.fx()
      const node = await freshNode()
      const umpire = await ctx.login(fx.users.umpire)
      const subscriber = await ctx.login(fx.users.blueCo)
      must(await subscriber.pubsub.subscribe(node), 'subscribe')
      must(await umpire.pubsub.publish(node, 'current', json({ n: 1 })), 'publish')
      const bystander = await ctx.login(fx.users.blueCo)
      const heard = record<ItemsEvent>((l) => bystander.pubsub.onItems(node, l))
      must(await bystander.pubsub.subscribe(node), 'subscribe late')
      await sleep(QUIET_MS)
      expect(heard.events).toEqual([])
      const other = await ctx.login(fx.users.redCo)
      const quiet = record<ItemsEvent>((l) => other.pubsub.onItems(node, l))
      must(await umpire.pubsub.publish(node, 'current', json({ n: 2 })), 'publish again')
      await heard.next((e) => e.items.length > 0)
      expect(quiet.events).toEqual([])
    })
  })
}
