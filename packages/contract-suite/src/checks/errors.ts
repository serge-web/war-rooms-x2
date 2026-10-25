// Refused operations (ARC-11, PLY-52): the error condition the server returns for each, so the
// mock returns the same. Conditions are RFC 6120 §8.3.3; refusals covered by other checks (S01,
// S01b, S02, S04, S10, S13) are not repeated here.
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { GAME_ROOM } from '../fixture.ts'
import { errorOf, json, must, uniq } from '../harness.ts'

export function errors(ctx: Ctx): void {
  describe('error conditions of refused operations (ARC-11)', () => {
    // XEP-0060 §6.5.9.11 / §8.4.3.2: a node that does not exist is <item-not-found/>.
    it('PubSub operations on a missing node: item-not-found', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const missing = `${fx.tag}:${uniq('missing')}`
      expect(errorOf(await admin.pubsub.getItems(missing))?.condition).toBe('item-not-found')
      expect(errorOf(await admin.pubsub.deleteNode(missing))?.condition).toBe('item-not-found')
      expect(errorOf(await admin.pubsub.getNodeConfig(missing))?.condition).toBe('item-not-found')
    })

    // XEP-0060 §7.1.4 auto-create is the service's choice: ejabberd creates the node when the
    // admin (who may create nodes) publishes to a missing one, with the default config, and
    // refuses a player with <item-not-found/>. The admin tooling must name nodes exactly.
    it('publishing to a missing node: a player gets item-not-found; the admin creates it', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const missing = `${fx.tag}:${uniq('auto')}`
      const blue = await ctx.login(fx.users.blueCo)
      expect(errorOf(await blue.pubsub.publish(missing, 'x', json({})))?.condition).toBe(
        'item-not-found',
      )
      try {
        must(await admin.pubsub.publish(missing, 'x', json({ auto: true })), 'admin publishes')
        expect(must(await admin.pubsub.getItems(missing), 'read').map((i) => i.id)).toEqual(['x'])
      } finally {
        await admin.pubsub.deleteNode(missing)
      }
    })

    // XEP-0060 §7.1.3 / XEP-0335: the payload must be JSON; refused locally as bad-request.
    it('publishing a payload that is not JSON: bad-request, nothing sent', async () => {
      const fx = ctx.fx()
      const refused = await ctx.admin().pubsub.publish(fx.nodes.theme, 'bad', '{not json')
      expect(errorOf(refused)?.condition).toBe('bad-request')
      const ids = must(await ctx.admin().pubsub.getItems(fx.nodes.theme), 'read').map((i) => i.id)
      expect(ids).not.toContain('bad')
    })

    // XEP-0045 §10.2 / §10.9 owner use: a member is <forbidden/>; an affiliation change by a
    // member is <not-allowed/>. §9.5 lets a room show members the member list, and ejabberd does.
    it('room owner and admin operations by a member are refused', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.blueHq)
      const blue = await ctx.login(fx.users.blueCo)
      expect(errorOf(await blue.muc.getRoomConfig(room))?.condition).toBe('forbidden')
      expect(errorOf(await blue.muc.configureRoom(room, GAME_ROOM))?.condition).toBe('forbidden')
      expect(errorOf(await blue.muc.destroyRoom(room))?.condition).toBe('forbidden')
      const members = must(await blue.muc.getAffiliations(room, 'member'), 'member list')
      expect(members.map((m) => m.jid)).toContain(ctx.jid(fx.users.blueCo))
      expect(
        errorOf(
          await blue.muc.setAffiliations(room, [
            { jid: ctx.jid(fx.users.redCo), affiliation: 'member' },
          ]),
        )?.condition,
      ).toBe('not-allowed')
    })

    // XEP-0045 §8.4: only a moderator may change roles; a participant is refused.
    it('a role change by a participant: not-allowed', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.negotiation)
      const blue = await ctx.login(fx.users.blueCo)
      const red = await ctx.login(fx.users.redCo)
      must(await blue.muc.join(room, 'blue-co'), 'blue joins')
      must(await red.muc.join(room, 'red-co'), 'red joins')
      expect(errorOf(await blue.muc.setRole(room, 'red-co', 'visitor'))?.condition).toBe(
        'not-allowed',
      )
    })

    // XEP-0045 §7.2.7: an outcast is <forbidden/> on entry.
    it('joining a room one is banned from: forbidden', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const room = ctx.room(uniq(`${fx.tag}-ban`))
      try {
        must(await admin.muc.createRoom(room, GAME_ROOM), 'create')
        must(
          await admin.muc.setAffiliations(room, [
            { jid: ctx.jid(fx.users.redCo), affiliation: 'outcast' },
          ]),
          'ban',
        )
        const red = await ctx.login(fx.users.redCo)
        expect(errorOf(await red.muc.join(room, 'red-co'))).toMatchObject({
          condition: 'forbidden',
          type: 'auth',
        })
      } finally {
        await admin.muc.destroyRoom(room)
      }
    })

    // XEP-0045 §10.1: an owner request to a missing room. ejabberd treats it as creating the
    // room, so a player is refused by the creation policy (<forbidden/>); for the admin it creates
    // the room (not exercised here: it would leave a room behind).
    it('a player asking for a missing room’s config: forbidden', async () => {
      const blue = await ctx.login(ctx.fx().users.blueCo)
      const room = ctx.room(uniq(`${ctx.fx().tag}-none`))
      expect(errorOf(await blue.muc.getRoomConfig(room))?.condition).toBe('forbidden')
    })

    // Leaving a room one is not in is a no-op success; sending to it is §7.4 not-acceptable.
    it('leaving a room one is not in succeeds; sending to it is not-acceptable', async () => {
      const fx = ctx.fx()
      const blue = await ctx.login(fx.users.blueCo)
      const room = ctx.room(fx.rooms.negotiation)
      must(await blue.muc.leave(room), 'leave without joining')
      expect(errorOf(await blue.muc.send(room, json({ text: 'x' })))?.condition).toBe(
        'not-acceptable',
      )
    })
  })
}
