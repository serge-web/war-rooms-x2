// S12 live changes (D23, ADM-25): move an online player between forces, and delete an online
// account. Port of spike S12-live-changes.test.ts and C01 R-D, on temporary accounts, rooms and
// nodes so the fixture is untouched.
import type { OccupantEvent } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { GAME_ROOM, WHITELIST_NODE } from '../fixture.ts'
import { errorOf, json, must, record, sleep, uniq } from '../harness.ts'

export function s12(ctx: Ctx): void {
  describe('S12 live changes', () => {
    // R-D grant first, then revoke. XEP-0045 §9.4 (revoke membership: status 321);
    // XEP-0060 §8.9 and §8.8. No access is pushed to the session (PLY-52).
    it('moves an online player: new access works at once, the old room ejects it (110, 321)', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const user = uniq(`${fx.tag}-s12`)
      const jid = ctx.jid(user)
      const [roomA, roomB] = [ctx.room(uniq(`${fx.tag}-s12a`)), ctx.room(uniq(`${fx.tag}-s12b`))]
      const [nodeA, nodeB] = [`${fx.tag}:${uniq('s12a')}`, `${fx.tag}:${uniq('s12b')}`]
      try {
        must(await admin.admin.addUser(jid, fx.password), 'add-user')
        for (const room of [roomA, roomB]) must(await admin.muc.createRoom(room, GAME_ROOM), 'room')
        for (const node of [nodeA, nodeB]) {
          must(await admin.pubsub.createNode(node, WHITELIST_NODE), 'node')
          must(await admin.pubsub.publish(node, 'current', json({ node })), 'seed')
        }
        must(await admin.muc.setAffiliations(roomA, [{ jid, affiliation: 'member' }]), 'member A')
        must(await admin.pubsub.setAffiliations(nodeA, [{ jid, affiliation: 'member' }]), 'read A')

        const player = await ctx.login(user)
        must(await player.muc.join(roomA, 'player'), 'join A')
        must(await player.pubsub.subscribe(nodeA), 'subscribe A')
        const inA = record<OccupantEvent>((l) => player.muc.onOccupant(roomA, l))

        // Grant the new access.
        must(await admin.muc.setAffiliations(roomB, [{ jid, affiliation: 'member' }]), 'member B')
        must(await admin.pubsub.setAffiliations(nodeB, [{ jid, affiliation: 'member' }]), 'read B')
        must(await player.pubsub.getItems(nodeA), 'still reads A')
        must(await player.pubsub.getItems(nodeB), 'reads B')
        must(await player.muc.join(roomB, 'player'), 'joins B')

        // Revoke the old: room affiliation none ejects; node needs the subscription removed (R-A).
        must(await admin.muc.setAffiliations(roomA, [{ jid, affiliation: 'none' }]), 'revoke A')
        const ejected = await inA.next((o) => o.self && !o.available)
        expect(ejected.statusCodes).toEqual(expect.arrayContaining([110, 321]))
        expect(ejected).toMatchObject({ affiliation: 'none', role: 'none' })
        expect(player.muc.occupants(roomA)).toEqual([])
        must(
          await admin.pubsub.setAffiliations(nodeA, [{ jid, affiliation: 'none' }]),
          'revoke node',
        )
        const subs = must(await admin.pubsub.getSubscriptions(nodeA), 'subscriptions')
        const theirs = subs.filter((s) => s.jid.split('/')[0] === jid)
        must(
          await admin.pubsub.setSubscriptions(
            nodeA,
            theirs.map((s) => ({ jid: s.jid, subscription: 'none' })),
          ),
          'remove subscription',
        )
        expect(errorOf(await player.pubsub.getItems(nodeA))?.condition).toBe('not-allowed')
        // §7.2.6 members-only: rejoining the old room is refused.
        expect(errorOf(await player.muc.join(roomA, 'player'))?.condition).toBe(
          'registration-required',
        )
        must(await player.muc.send(roomB, json({ text: 'in the new room' })), 'post in B')
      } finally {
        for (const node of [nodeA, nodeB]) await admin.pubsub.deleteNode(node)
        for (const room of [roomA, roomB]) await admin.muc.destroyRoom(room)
        await admin.admin.deleteUser(jid)
      }
    })

    // XEP-0133 §4.2 on an online account: others see it leave the room, and ejabberd drops its
    // room affiliation with the account (spike S12).
    it('deleting an online account removes it from rooms and their member lists', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const user = uniq(`${fx.tag}-s12d`)
      const jid = ctx.jid(user)
      const room = ctx.room(fx.rooms.blueHq)
      must(await admin.admin.addUser(jid, fx.password), 'add-user')
      try {
        must(await admin.muc.setAffiliations(room, [{ jid, affiliation: 'member' }]), 'member')
        const doomed = await ctx.login(user)
        must(await doomed.muc.join(room, user), 'join')
        const umpire = await ctx.login(fx.users.umpire)
        must(await umpire.muc.join(room, 'umpire-1'), 'umpire joins')
        const seen = record<OccupantEvent>((l) => umpire.muc.onOccupant(room, l))
        must(await admin.admin.deleteUser(jid), 'delete-user')
        await seen.next((o) => o.nick === user && !o.available, 10_000)
        await sleep(500)
        expect(doomed.status()).toMatchObject({ state: 'ended', reason: 'account-removed' })
        const members = must(await admin.muc.getAffiliations(room, 'member'), 'members')
        expect(members.map((m) => m.jid)).not.toContain(jid)
      } finally {
        await admin.admin.deleteUser(jid)
        await admin.muc.setAffiliations(room, [{ jid, affiliation: 'none' }])
      }
    })
  })
}
