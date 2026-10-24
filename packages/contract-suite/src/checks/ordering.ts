// Event ordering on join (ARC-11): XEP-0045 §7.2.3 says the service sends the existing
// occupants' presence, then the joining occupant's self-presence (status 110), then the
// discussion history (§7.2.15), then the subject. ejabberd follows it (WP 1.2 probes), and the
// mock must deliver events in the same order. Join history is not relied on for content (PLY-49),
// but the order is what the domain layer sees first.
import type { RoomMessage } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { json, must, record, uniq } from '../harness.ts'

type Seen =
  | { readonly kind: 'occupant'; readonly nick: string; readonly self: boolean }
  | { readonly kind: 'message'; readonly body: string }
  | { readonly kind: 'joined' }

export function ordering(ctx: Ctx): void {
  describe('event ordering on join', () => {
    it('existing occupants, then self-presence, then history, oldest first', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.redHq)
      const umpire = await ctx.login(fx.users.umpire)
      must(await umpire.muc.join(room, 'umpire-1'), 'umpire joins')
      const bodies = [json({ text: uniq('h1') }), json({ text: uniq('h2') })]
      for (const body of bodies) must(await umpire.muc.send(room, body), 'umpire posts')

      const red = await ctx.login(fx.users.redCo)
      const seen: Seen[] = []
      red.muc.onOccupant(room, (o) => seen.push({ kind: 'occupant', nick: o.nick, self: o.self }))
      const messages = record<RoomMessage>((l) => red.muc.onMessage(room, l))
      red.muc.onMessage(room, (m) => seen.push({ kind: 'message', body: m.body }))
      const joined = must(await red.muc.join(room, 'red-co'), 'red joins')
      seen.push({ kind: 'joined' })
      await messages.next((m) => m.body === bodies[1])

      const index = (match: (s: Seen) => boolean): number => seen.findIndex(match)
      const umpireAt = index((s) => s.kind === 'occupant' && s.nick === 'umpire-1')
      const selfAt = index((s) => s.kind === 'occupant' && s.self)
      const joinedAt = index((s) => s.kind === 'joined')
      const firstAt = index((s) => s.kind === 'message' && s.body === bodies[0])
      const secondAt = index((s) => s.kind === 'message' && s.body === bodies[1])
      expect(joined).toMatchObject({ nick: 'red-co', role: 'participant', affiliation: 'member' })
      expect(umpireAt).toBeGreaterThanOrEqual(0)
      expect(umpireAt).toBeLessThan(selfAt)
      // join() resolves on the self-presence, before any history arrives.
      expect(selfAt).toBeLessThan(joinedAt)
      expect(selfAt).toBeLessThan(firstAt)
      expect(firstAt).toBeLessThan(secondAt)
      // The occupant list is complete once join() resolves.
      expect(
        red.muc
          .occupants(room)
          .map((o) => o.nick)
          .sort(),
      ).toEqual(['red-co', 'umpire-1'])
    })
  })
}
