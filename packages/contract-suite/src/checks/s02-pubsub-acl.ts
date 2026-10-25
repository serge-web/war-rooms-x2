// S02 PubSub access control (R3, R10): whitelist nodes are read by their readers only, and
// written by publishers only. Port of spike S02-pubsub-acl.test.ts.
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { errorOf, json, must } from '../harness.ts'

export function s02(ctx: Ctx): void {
  describe('S02 PubSub access control', () => {
    // XEP-0060 §6.5.9.5 / §4.6 whitelist: a non-member's retrieve is <not-allowed/>
    // (pubsub#closed-node), type cancel.
    it('red-co can neither read nor subscribe to objectives:blue', async () => {
      const fx = ctx.fx()
      const red = await ctx.login(fx.users.redCo)
      expect(errorOf(await red.pubsub.getItems(fx.nodes.objectivesBlue))).toMatchObject({
        condition: 'not-allowed',
        type: 'cancel',
      })
      // §6.1.3.4: subscribing to a whitelist node without being on it.
      expect(errorOf(await red.pubsub.subscribe(fx.nodes.objectivesBlue))?.condition).toBe(
        'not-allowed',
      )
      expect(
        errorOf(await red.pubsub.getItems(fx.nodes.objectivesBlue, { max: 1 }))?.condition,
      ).toBe('not-allowed')
    })

    // §7.1.3.1: publishing without publish rights is <forbidden/>, type auth.
    it('blue-co reads objectives:blue but cannot publish to it, nor read objectives:red', async () => {
      const fx = ctx.fx()
      const blue = await ctx.login(fx.users.blueCo)
      const items = must(await blue.pubsub.getItems(fx.nodes.objectivesBlue), 'read')
      expect(items.map((i) => i.id)).toContain('current')
      expect(
        errorOf(await blue.pubsub.publish(fx.nodes.objectivesBlue, 'current', json({ x: 1 }))),
      ).toMatchObject({ condition: 'forbidden', type: 'auth' })
      expect(errorOf(await blue.pubsub.getItems(fx.nodes.objectivesRed))?.condition).toBe(
        'not-allowed',
      )
    })

    // §3 rule 14: White Force roles that are not observers read and publish every force's
    // objectives.
    it('the umpire reads and publishes both forces’ objectives', async () => {
      const fx = ctx.fx()
      const umpire = await ctx.login(fx.users.umpire)
      for (const node of [fx.nodes.objectivesBlue, fx.nodes.objectivesRed]) {
        must(await umpire.pubsub.getItems(node), `read ${node}`)
        must(
          await umpire.pubsub.publish(node, 'umpire', json({ text: 'umpire' })),
          `publish ${node}`,
        )
        must(await umpire.pubsub.publish(node, 'umpire', json({ text: 'again' })), 'overwrite own')
      }
    })

    // §3 rule 14, review F5: a White Force observer is a member, not a publisher, of every
    // force's objectives node: it reads them and its publish is refused.
    it('a White Force observer reads both forces’ objectives but cannot publish them', async () => {
      const fx = ctx.fx()
      const observer = await ctx.login(fx.users.whiteObs)
      for (const node of [fx.nodes.objectivesBlue, fx.nodes.objectivesRed]) {
        must(await observer.pubsub.getItems(node), `read ${node}`)
        expect(
          errorOf(await observer.pubsub.publish(node, 'white-obs', json({ text: 'no' }))),
        ).toMatchObject({ condition: 'forbidden', type: 'auth' })
      }
    })

    // XEP-0060 §7.1 leaves overwriting another entity's item to the service. ejabberd refuses a
    // publisher who overwrites or retracts an item someone else published (<forbidden/>); the
    // owner may. So a single-document node's `current` item can be replaced only by whoever
    // published it, or by the owner (WP 1.3 probe).
    it('a publisher cannot overwrite or retract an item another entity published', async () => {
      const fx = ctx.fx()
      const umpire = await ctx.login(fx.users.umpire)
      const node = fx.nodes.objectivesRed
      // `current` was seeded by the admin, the node's owner.
      const overwrite = await umpire.pubsub.publish(node, 'current', json({ text: 'mine now' }))
      expect(errorOf(overwrite)).toMatchObject({ condition: 'forbidden', type: 'auth' })
      expect(errorOf(await umpire.pubsub.retract(node, 'current'))?.condition).toBe('forbidden')
      // The owner can overwrite an item a publisher made.
      must(await umpire.pubsub.publish(node, 'by-umpire', json({ v: 1 })), 'umpire publishes')
      must(await ctx.admin().pubsub.publish(node, 'by-umpire', json({ v: 2 })), 'owner overwrites')
    })

    // §3 rule 15, PLY-37: every role reads announcements; only the admin publishes.
    it('every role reads announcements, and only the admin publishes them', async () => {
      const fx = ctx.fx()
      must(
        await ctx.admin().pubsub.publish(fx.nodes.announcements, 'a1', json({ text: 'hi' })),
        'admin',
      )
      for (const user of Object.values(fx.users)) {
        const session = await ctx.login(user)
        must(await session.pubsub.getItems(fx.nodes.announcements), `${user} reads`)
        const attempt = await session.pubsub.publish(
          fx.nodes.announcements,
          'x',
          json({ text: user }),
        )
        expect(errorOf(attempt)?.condition, `${user} publishes`).toBe('forbidden')
      }
    })

    // §8.9: affiliation changes apply to online sessions at once, with no notification (PLY-52).
    it('adding and removing a reader applies to an online session', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const red = await ctx.login(fx.users.redCo)
      const node = fx.nodes.objectivesBlue
      const jid = ctx.jid(fx.users.redCo)
      expect((await red.pubsub.getItems(node)).ok).toBe(false)
      must(await admin.pubsub.setAffiliations(node, [{ jid, affiliation: 'member' }]), 'grant')
      expect((await red.pubsub.getItems(node)).ok).toBe(true)
      must(await admin.pubsub.setAffiliations(node, [{ jid, affiliation: 'none' }]), 'revoke')
      expect(errorOf(await red.pubsub.getItems(node))?.condition).toBe('not-allowed')
    })

    it('granting and revoking publisher applies to an online session', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const blue = await ctx.login(fx.users.blueCo)
      const node = fx.nodes.objectivesBlue
      const jid = ctx.jid(fx.users.blueCo)
      must(await admin.pubsub.setAffiliations(node, [{ jid, affiliation: 'publisher' }]), 'grant')
      must(await blue.pubsub.publish(node, 'by-blue', json({ text: 'allowed' })), 'publish')
      must(await admin.pubsub.setAffiliations(node, [{ jid, affiliation: 'member' }]), 'revoke')
      expect(
        errorOf(await blue.pubsub.publish(node, 'by-blue', json({ text: 'no' })))?.condition,
      ).toBe('forbidden')
    })

    // §8: owner operations need the owner affiliation; ejabberd says <forbidden/> (spike S2).
    it('owner operations by a player are forbidden', async () => {
      const fx = ctx.fx()
      const blue = await ctx.login(fx.users.blueCo)
      const node = fx.nodes.objectivesBlue
      expect(errorOf(await blue.pubsub.getNodeConfig(node))?.condition).toBe('forbidden')
      expect(errorOf(await blue.pubsub.getAffiliations(node))?.condition).toBe('forbidden')
      expect(errorOf(await blue.pubsub.getSubscriptions(node))?.condition).toBe('forbidden')
      expect(errorOf(await blue.pubsub.deleteNode(node))?.condition).toBe('forbidden')
      expect(errorOf(await blue.pubsub.retract(node, 'current'))?.condition).toBe('forbidden')
      expect(
        errorOf(
          await blue.pubsub.createNode(`${fx.tag}:player-node`, {
            accessModel: 'open',
            publishModel: 'publishers',
            maxItems: 1,
            notifyRetract: false,
          }),
        )?.condition,
      ).toBe('forbidden')
    })
  })
}
