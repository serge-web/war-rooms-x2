// S13 (WP 0.1, plan/decisions/S13.md): a role change for an occupant who is not in the room is
// refused, so observer voice is revoked with the observer present (the vault route, ADM-37).
// XEP-0045 §8.4 (revoke voice) addresses the occupant by nick; ejabberd also refuses by JID.
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { GAME_ROOM } from '../fixture.ts'
import { errorOf, must, sleep, uniq } from '../harness.ts'
import type { RawAccess } from '../suite.ts'

export function s13(ctx: Ctx, raw: RawAccess | undefined): void {
  describe('S13 role change for an absent occupant', () => {
    // By nick: <not-acceptable/> type modify, "Nickname … does not exist in the room".
    it('by nick, for an observer who never joined: not-acceptable', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const room = ctx.room(uniq(`${fx.tag}-s13`))
      try {
        must(await admin.muc.createRoom(room, GAME_ROOM), 'create room')
        must(
          await admin.muc.setAffiliations(room, [
            { jid: ctx.jid(fx.users.blueObs), affiliation: 'member' },
          ]),
          'member',
        )
        must(await admin.muc.join(room, 'admin'), 'admin joins')
        const refused = await admin.muc.setRole(room, 'blue-obs', 'visitor')
        expect(errorOf(refused)).toMatchObject({ condition: 'not-acceptable', type: 'modify' })
        must(await admin.muc.leave(room), 'admin leaves')
        // And so the observer, never present, still joins as a participant.
        const observer = await ctx.login(fx.users.blueObs)
        expect(must(await observer.muc.join(room, 'blue-obs'), 'join').role).toBe('participant')
      } finally {
        await admin.muc.destroyRoom(room)
      }
    })

    // The same by nick for an observer who joined before and is now offline (the R-B case).
    it('by nick, for an observer who has left: not-acceptable', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const room = ctx.room(fx.rooms.blueHq)
      must(await admin.muc.join(room, 'admin'), 'admin joins')
      const refused = await admin.muc.setRole(room, 'blue-obs', 'visitor')
      expect(errorOf(refused)?.condition).toBe('not-acceptable')
      must(await admin.muc.leave(room), 'admin leaves')
    })

    if (raw === undefined) return

    // By JID: the interface's setRole takes a nick only, so this is sent raw from the admin's own
    // session (a documented muc#admin request): <not-allowed/> type cancel, "Changing
    // role/affiliation is not allowed" (S13.md option 1).
    it('by JID: not-allowed', { tags: ['raw'] }, async () => {
      const fx = ctx.fx()
      const admin = await ctx.adminSession()
      const room = ctx.room(fx.rooms.blueHq)
      must(await admin.muc.join(room, 'admin'), 'admin joins')
      const id = uniq('s13')
      const replies: string[] = []
      const stop = raw.onIncoming(admin, (xml) => {
        if (xml.includes(id)) replies.push(xml)
      })
      raw.send(
        admin,
        `<iq xmlns="jabber:client" type="set" to="${room}" id="${id}"><query xmlns="http://jabber.org/protocol/muc#admin"><item jid="${ctx.jid(fx.users.blueObs)}" role="visitor"/></query></iq>`,
      )
      await sleep(1_500)
      stop()
      expect(replies).toHaveLength(1)
      expect(replies[0]).toMatch(/type='error'/)
      expect(replies[0]).toMatch(/<not-allowed xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'\/>/)
      must(await admin.muc.leave(room), 'admin leaves')
    })
  })
}
