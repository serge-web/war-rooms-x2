// S11 two sessions on one role (D22): two sessions of blue-co join with the same nickname and
// act as one occupant. XEP-0045 §7.2 leaves multi-session occupants to the service; this is
// ejabberd's behaviour (spike S11-two-sessions.test.ts), which the mock must match.
import type { OccupantEvent, RoomMessage } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { json, must, record, sleep, uniq } from '../harness.ts'

const QUIET_MS = 1_500

export function s11(ctx: Ctx): void {
  describe('S11 two sessions on one role', () => {
    it('both sessions join with one nick, both receive, and others see one occupant', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.blueHq)
      const umpire = await ctx.login(fx.users.umpire)
      must(await umpire.muc.join(room, 'umpire-1'), 'umpire joins')
      const presences = record<OccupantEvent>((l) => umpire.muc.onOccupant(room, l))
      const tab1 = await ctx.login(fx.users.blueCo)
      const tab2 = await ctx.login(fx.users.blueCo)
      must(await tab1.muc.join(room, 'blue-co'), 'tab 1 joins')
      const second = must(await tab2.muc.join(room, 'blue-co'), 'tab 2 joins with the same nick')
      expect(second).toMatchObject({ nick: 'blue-co', role: 'participant', affiliation: 'member' })
      const blueOccupants = umpire.muc.occupants(room).filter((o) => o.nick === 'blue-co')
      expect(blueOccupants).toHaveLength(1)

      // Both sessions receive what others post.
      const in1 = record<RoomMessage>((l) => tab1.muc.onMessage(room, l))
      const in2 = record<RoomMessage>((l) => tab2.muc.onMessage(room, l))
      const fromUmpire = json({ text: uniq('from-umpire') })
      must(await umpire.muc.send(room, fromUmpire), 'umpire posts')
      await in1.next((m) => m.body === fromUmpire)
      await in2.next((m) => m.body === fromUmpire)

      // A post from tab 1 reaches others once, and is reflected to tab 2 too; tab 1's send
      // resolves on its own reflection.
      const toUmpire = record<RoomMessage>((l) => umpire.muc.onMessage(room, l))
      const fromTab1 = json({ text: uniq('from-tab1') })
      const sent = must(await tab1.muc.send(room, fromTab1), 'tab 1 posts')
      await toUmpire.next((m) => m.body === fromTab1)
      await in2.next((m) => m.body === fromTab1)
      await sleep(QUIET_MS)
      const atUmpire = toUmpire.events.filter((m) => m.body === fromTab1)
      expect(atUmpire).toHaveLength(1)
      expect(atUmpire[0]?.stanzaId).toBe(sent.stanzaId)
      expect(in2.events.filter((m) => m.body === fromTab1)).toHaveLength(1)

      // When tab 1 leaves, others see no unavailable presence and tab 2 stays in.
      const before = presences.events.length
      must(await tab1.muc.leave(room), 'tab 1 leaves')
      await sleep(QUIET_MS)
      const left = presences.events
        .slice(before)
        .filter((o) => o.nick === 'blue-co' && !o.available)
      expect(left).toEqual([])
      const still = json({ text: uniq('still') })
      must(await umpire.muc.send(room, still), 'umpire posts again')
      await in2.next((m) => m.body === still)
      must(await tab2.muc.send(room, json({ text: 'tab 2 can still post' })), 'tab 2 posts')
    })
  })
}
