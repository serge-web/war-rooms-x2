// U01 the umpire room (WP 6.4; Annex C PD8, PY-8, §3 rule 19, PLY-53). The room as the admin
// tooling provisions it: members-only, the White Force only. A White Force proposal near the
// 500 KB cap goes from the White Force writer to the admin live and through MAM, with the
// sender's real JID, and the White Force observer receives it; the observer, made read-only by
// the password route (ADM-37), cannot post; a player of another force cannot join; and a proposal
// over the cap is refused before anything is sent.
import { LIMITS, parseDocument } from '@wrx/schemas'
import type { RoomMessage } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { revokeVoice } from '../fixture.ts'
import { errorOf, must, record, uniq } from '../harness.ts'

/** A proposal body whose UTF-8 text is about `bytes` long: a full world state and a summary. */
function proposalBody(bytes: number): string {
  const assets: Record<string, unknown> = {}
  let size = 0
  for (let i = 0; size < bytes; i++) {
    const id = `b0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
    const asset = {
      id,
      forceId: '10000000-0000-4000-8000-000000000001',
      title: `Unit ${i} <&> "quoted"`,
      category: 'armour',
      sidc: 'SFGPUCA----K---',
      lat: 52 + (i % 100) / 1000,
      lon: 5.9 - (i % 50) / 1000,
      state: 'damaged',
      health: 40,
      fuel: 87.5,
    }
    assets[id] = asset
    size += JSON.stringify(asset).length + 45
  }
  return JSON.stringify({
    type: 'world-proposal',
    schemaVersion: 1,
    content: { state: { turn: 1, assets }, summary: uniq('Tanks damaged by artillery') },
  })
}

/** Under the cap with room for the stanza and escaping. */
const NEAR_CAP = LIMITS.worldStateStanzaBytes - 40_000

export function u01(ctx: Ctx): void {
  describe('U01 the umpire room', () => {
    it('a player of another force cannot join it (members only)', async () => {
      const fx = ctx.fx()
      const co = await ctx.login(fx.users.blueCo)
      const joined = await co.muc.join(ctx.room(fx.rooms.umpire), 'blue-co')
      expect(errorOf(joined)).toBeDefined()
    })

    it('a proposal near 500 KB goes from the White Force to the admin, live and through MAM, and its observer reads it', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.umpire)
      const admin = await ctx.adminSession()
      const white = await ctx.login(fx.users.umpire)
      const observer = await ctx.login(fx.users.whiteObs)
      must(await admin.muc.join(room, 'admin'), 'admin joins')
      must(await observer.muc.join(room, 'white-obs'), 'observer joins')
      must(await white.muc.join(room, 'umpire-1'), 'the White Force writer joins')
      const toAdmin = record<RoomMessage>((l) => admin.muc.onMessage(room, l))
      const toObserver = record<RoomMessage>((l) => observer.muc.onMessage(room, l))
      const body = proposalBody(NEAR_CAP)
      expect(body.length).toBeGreaterThan(LIMITS.messageStanzaBytes * 5)
      expect(parseDocument('message', body).ok).toBe(true)
      const sent = must(
        await white.muc.send(room, body, { maxBytes: LIMITS.worldStateStanzaBytes }),
        'post the proposal',
      )
      const live = await toAdmin.next((m) => m.stanzaId === sent.stanzaId, 20_000)
      expect(live.body).toBe(body)
      expect(live.from?.split('/')[0]).toBe(ctx.jid(fx.users.umpire))
      await toObserver.next((m) => m.stanzaId === sent.stanzaId, 20_000)

      const page = must(await admin.mam.queryRoom(room, { max: 1 }), 'MAM, newest page')
      const archived = page.messages.at(-1)
      expect(archived?.stanzaId).toBe(sent.stanzaId)
      expect(archived?.body).toBe(body)
      must(await admin.muc.leave(room), 'admin leaves')
    }, 60_000)

    it('the White Force observer, made read-only, cannot post in it', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.umpire)
      const admin = ctx.admin()
      const observer = await ctx.login(fx.users.whiteObs)
      await revokeVoice(admin, observer, room, 'white-obs')
      const joined = must(await observer.muc.join(room, 'white-obs'), 'observer joins')
      expect(joined).toMatchObject({ role: 'visitor', affiliation: 'member' })
      const refused = await observer.muc.send(room, proposalBody(1_000), {
        maxBytes: LIMITS.worldStateStanzaBytes,
      })
      expect(errorOf(refused)?.condition).toBe('forbidden')
    })

    it('a proposal over 500,000 bytes is too-large and not sent', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.umpire)
      const white = await ctx.login(fx.users.umpire)
      must(await white.muc.join(room, 'umpire-1'), 'join')
      const over = proposalBody(LIMITS.worldStateStanzaBytes + 1_000)
      const sent = await white.muc.send(room, over, { maxBytes: LIMITS.worldStateStanzaBytes })
      expect(errorOf(sent)?.condition).toBe('too-large')
    })
  })
}
