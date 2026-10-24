// Recovery from a dropped connection (PLY-2, ARC-8 SHOULD use XEP-0198), and forced logout by
// the server (PLY-50). WP 0.3 showed resumption live; the spike had no check for it.
import type { ConnectionStatus, Recovery, RoomMessage } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { json, must, record, uniq } from '../harness.ts'

export function recovery(ctx: Ctx): void {
  describe('recovery and forced logout (PLY-2, PLY-50)', () => {
    // XEP-0198 §5: a resumed stream keeps the session, so room membership is intact and nothing
    // is missed; the client reports `resumed`.
    it('a resumable drop resumes the session: same JID, still in the room, nothing missed', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.negotiation)
      const blue = await ctx.login(fx.users.blueCo)
      const red = await ctx.login(fx.users.redCo)
      must(await blue.muc.join(room, 'blue-co'), 'blue joins')
      must(await red.muc.join(room, 'red-co'), 'red joins')
      const statuses = record<ConnectionStatus>((l) => blue.onStatus(l))
      const recoveries = record<Recovery>((l) => blue.onRecovered(l))
      const messages = record<RoomMessage>((l) => blue.muc.onMessage(room, l))
      const jid = blue.jid
      await ctx.backend.interrupt(blue, 'resumable')
      const body = json({ text: uniq('while-away') })
      must(await red.muc.send(room, body), 'red posts during the drop')
      await recoveries.next(() => true, 30_000)
      await messages.next((m) => m.body === body, 15_000)
      expect(recoveries.events).toEqual(['resumed'])
      expect(statuses.events[0]).toEqual({ state: 'reconnecting', attempt: 1 })
      expect(statuses.events.at(-1)).toEqual({ state: 'online' })
      expect(blue.jid).toBe(jid)
      expect(blue.muc.occupants(room).some((o) => o.self)).toBe(true)
      // Still an occupant on the server: a post goes through without rejoining.
      must(await blue.muc.send(room, json({ text: 'back' })), 'blue posts after resuming')
    }, 60_000)

    // XEP-0198 §5 failure, RFC 6120 §7: a new session, so rooms are left and the client must
    // rejoin and fetch what it missed from MAM (PLY-2, PLY-49). The transport does not rejoin.
    it('a lost session reconnects as a new one: rooms to rejoin, missed messages in MAM', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.negotiation)
      const blue = await ctx.login(fx.users.blueCo)
      const red = await ctx.login(fx.users.redCo)
      must(await blue.muc.join(room, 'blue-co'), 'blue joins')
      must(await red.muc.join(room, 'red-co'), 'red joins')
      const recoveries = record<Recovery>((l) => blue.onRecovered(l))
      await ctx.backend.interrupt(blue, 'lost')
      await recoveries.next(() => true, 30_000)
      expect(recoveries.events).toEqual(['reconnected'])
      expect(blue.status()).toEqual({ state: 'online' })
      expect(blue.muc.occupants(room)).toEqual([])
      const missed = json({ text: uniq('missed') })
      const sent = must(await red.muc.send(room, missed), 'red posts while blue is out')
      const page = must(await blue.mam.queryRoom(room, { max: 20 }), 'blue reads MAM')
      expect(page.messages.map((m) => m.stanzaId)).toContain(sent.stanzaId)
      must(await blue.muc.join(room, 'blue-co'), 'blue rejoins')
    }, 60_000)

    // XEP-0133 §4.6 end-user-session: the server closes with <policy-violation/> (spike S4).
    it('an admin ending the session is a forced logout: session-ended, no reconnect', async () => {
      const fx = ctx.fx()
      const session = await ctx.login(fx.users.redCo)
      const statuses = record<ConnectionStatus>((l) => session.onStatus(l))
      must(await ctx.admin().admin.endUserSessions(ctx.jid(fx.users.redCo)), 'end sessions')
      await statuses.next((s) => s.state === 'ended', 10_000)
      expect(session.status()).toMatchObject({ state: 'ended', reason: 'session-ended' })
      expect(statuses.events.filter((s) => s.state === 'reconnecting')).toEqual([])
    })
  })
}
