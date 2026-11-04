// W01 turns and the world state (WP 5.2; D7, D25, PLY-53, PLY-58, PLY-59). The `game-state` node
// as the admin tooling provisions it (whitelist, every role a member, the admin the only
// publisher): every role reads the turn state, no role publishes it, anonymous sessions read
// nothing. The map room takes a world-state message near the 500 KB map-room cap: delivered live
// and kept in MAM intact, with the sender's real JID; one over the cap, and a large message sent
// without asking for the larger cap, are refused before anything is sent.
import { INITIAL_GAME_STATE, LIMITS, parseDocument } from '@wrx/schemas'
import type { RoomMessage } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { errorOf, must, record } from '../harness.ts'

/** A world-state body whose UTF-8 text is about `bytes` long: assets with GUID keys. */
function worldStateBody(bytes: number, turn = 1): string {
  const asset = (i: number) => {
    const id = `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
    return [
      id,
      {
        id,
        forceId: '10000000-0000-4000-8000-000000000001',
        title: `Unit ${i} <&> "quoted"`,
        category: 'armour',
        sidc: 'SFGPUCA----K---',
        lat: 52 + (i % 100) / 1000,
        lon: 5.9 - (i % 50) / 1000,
        state: 'operational',
        health: 100,
        fuel: 87.5,
      },
    ] as const
  }
  const assets: [string, unknown][] = []
  let size = 0
  for (let i = 0; size < bytes; i++) {
    const entry = asset(i)
    assets.push([entry[0], entry[1]])
    size += JSON.stringify(entry).length + 1
  }
  return JSON.stringify({
    type: 'world-state',
    schemaVersion: 1,
    content: { turn, assets: Object.fromEntries(assets) },
  })
}

/** Body bytes escaped as text, plus the stanza around it: under the cap with room to spare. */
const NEAR_CAP = LIMITS.worldStateStanzaBytes - 30_000

export function w01(ctx: Ctx): void {
  describe('W01 turns and the world state', () => {
    // XEP-0060 §6.5 retrieve on a whitelist node; §7.1.3.1 publish without rights is forbidden.
    it('every role reads game-state; no role publishes it, not even the White Force writer', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const turn = { ...INITIAL_GAME_STATE }
      must(
        await admin.pubsub.publish(fx.nodes.gameState, 'current', JSON.stringify(turn)),
        'publish turn 1',
      )
      for (const user of Object.values(fx.users)) {
        const session = await ctx.login(user)
        const items = must(await session.pubsub.getItems(fx.nodes.gameState), `${user} reads`)
        const item = items.find((i) => i.id === 'current')
        const parsed = parseDocument('game-state', item?.payload ?? '')
        expect(parsed.ok && parsed.value, user).toEqual(turn)
        const forged = JSON.stringify({ schemaVersion: 1, turn: 9, phase: 'adjudication' })
        expect(
          errorOf(await session.pubsub.publish(fx.nodes.gameState, 'current', forged))?.condition,
          user,
        ).toBe('forbidden')
      }
      const after = must(await admin.pubsub.getItems(fx.nodes.gameState), 'read back')
      expect(after.find((i) => i.id === 'current')?.payload).toBe(JSON.stringify(turn))
    })

    it('the admin advances the turn, and readers are told live (ADM-43, PLY-55)', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const red = await ctx.login(fx.users.redCo)
      must(await red.pubsub.subscribe(fx.nodes.gameState), 'subscribe')
      const events = record<{ payload: string }>((l) =>
        red.pubsub.onItems(fx.nodes.gameState, (e) => {
          for (const item of e.items) l({ payload: item.payload })
        }),
      )
      const next = JSON.stringify({ schemaVersion: 1, turn: 1, phase: 'adjudication' })
      must(await admin.pubsub.publish(fx.nodes.gameState, 'current', next), 'advance')
      const seen = await events.next((e) => e.payload === next)
      expect(parseDocument('game-state', seen.payload).ok).toBe(true)
      must(await red.pubsub.unsubscribe(fx.nodes.gameState), 'unsubscribe')
    })

    it('an anonymous session cannot read game-state (D20)', async () => {
      const anon = await ctx.anonymous()
      expect(errorOf(await anon.pubsub.getItems(ctx.fx().nodes.gameState))).toBeDefined()
    })

    // PLY-53, D25: the map-room cap is 500,000 bytes for world states; the server sets no
    // WebSocket limit (R15), so the client's cap is the only one.
    it('a world state near 500 KB round-trips live and through MAM, with the admin’s real JID', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.map)
      const admin = await ctx.adminSession()
      const co = await ctx.login(fx.users.blueCo)
      must(await co.muc.join(room, 'blue-co'), 'blue joins')
      must(await admin.muc.join(room, 'admin'), 'admin joins')
      const seen = record<RoomMessage>((l) => co.muc.onMessage(room, l))
      const body = worldStateBody(NEAR_CAP)
      expect(body.length).toBeGreaterThan(LIMITS.messageStanzaBytes * 6)
      const sent = must(
        await admin.muc.send(room, body, { maxBytes: LIMITS.worldStateStanzaBytes }),
        'send the world state',
      )
      const live = await seen.next((m) => m.stanzaId === sent.stanzaId, 20_000)
      expect(live.body).toBe(body)
      expect(live.from?.split('/')[0]).toBe(`admin@${fx.domain}`)
      expect(parseDocument('message', live.body).ok).toBe(true)

      const page = must(await co.mam.queryRoom(room, { max: 1 }), 'MAM, newest first page')
      const archived = page.messages.at(-1)
      expect(archived?.stanzaId).toBe(sent.stanzaId)
      expect(archived?.body).toBe(body)
      expect(archived?.from?.split('/')[0]).toBe(`admin@${fx.domain}`)
      must(await admin.muc.leave(room), 'admin leaves')
    }, 60_000)

    it('a world state over 500,000 bytes, and 100 KB without the larger cap, are too-large and not sent', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.map)
      const admin = await ctx.adminSession()
      must(await admin.muc.join(room, 'admin'), 'join')
      const before = must(await admin.mam.queryRoom(room, { max: 1 }), 'newest').messages
      const over = worldStateBody(LIMITS.worldStateStanzaBytes + 1_000)
      const asked = await admin.muc.send(room, over, { maxBytes: LIMITS.worldStateStanzaBytes })
      expect(errorOf(asked)?.condition).toBe('too-large')
      // Asking for more than the world-state cap gets the world-state cap.
      const greedy = await admin.muc.send(room, over, { maxBytes: 10_000_000 })
      expect(errorOf(greedy)?.condition).toBe('too-large')
      const plain = worldStateBody(100_000)
      expect(errorOf(await admin.muc.send(room, plain))?.condition).toBe('too-large')
      const after = must(await admin.mam.queryRoom(room, { max: 1 }), 'newest').messages
      expect(after.map((m) => m.stanzaId)).toEqual(before.map((m) => m.stanzaId))
      must(await admin.muc.leave(room), 'leave')
    })
  })
}
