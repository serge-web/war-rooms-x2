// S03 item and message size (R11, R15, PLY-53). Port of spike S03-item-size.test.ts, plus the
// client-side caps from WP 0.1 (S13.md). The caps come from @wrx/schemas, so both backends refuse
// the same payloads with `too-large` before anything is sent.
import { LIMITS } from '@wrx/schemas'
import type { RoomMessage } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { errorOf, must, record, uniq } from '../harness.ts'

/** The largest JSON payload one item may carry (PLY-53): the server limit less the XML around it. */
const ITEM_CAP = LIMITS.pubsubItemBytes - LIMITS.pubsubItemOverheadBytes

/** A JSON object whose UTF-8 text is exactly `bytes` long (ASCII only). */
function payloadOf(bytes: number): string {
  const frame = JSON.stringify({ kind: 'image', data: '' }).length
  return JSON.stringify({ kind: 'image', data: 'A'.repeat(bytes - frame) })
}

export function s03(ctx: Ctx): void {
  describe('S03 item and message size', () => {
    // XEP-0060 §7.1 publish, §6.5 retrieve; ~100 KB is the asset default (§3 rule 12).
    it('a ~100 KB JSON item publishes and reads back intact', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const payload = payloadOf(100 * 1024)
      const id = uniq('s03')
      must(await admin.pubsub.publish(fx.nodes.theme, id, payload), 'publish')
      const items = must(await admin.pubsub.getItems(fx.nodes.theme), 'read')
      const item = items.find((i) => i.id === id)
      expect(item === undefined ? undefined : JSON.parse(item.payload)).toEqual(JSON.parse(payload))
    })

    // The client cap sits below the server's `max_payload_size` (ejabberd 250,000; S3: a larger
    // item is <not-acceptable/> payload-too-big), so the largest allowed item is accepted.
    it('an item at the cap is accepted; one byte over is too-large and not sent', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const atCap = uniq('cap')
      must(await admin.pubsub.publish(fx.nodes.theme, atCap, payloadOf(ITEM_CAP)), 'at the cap')
      const over = uniq('over')
      const refused = await admin.pubsub.publish(fx.nodes.theme, over, payloadOf(ITEM_CAP + 1))
      expect(errorOf(refused)?.condition).toBe('too-large')
      const ids = must(await admin.pubsub.getItems(fx.nodes.theme), 'read').map((i) => i.id)
      expect(ids).toContain(atCap)
      expect(ids).not.toContain(over)
    })

    // PLY-53 (S13.md): a message stanza over 65,536 bytes of UTF-8 after XML escaping is refused
    // before sending. The server itself sets no limit on WebSocket (R15).
    it('a message within the stanza cap is delivered; one over it is too-large and not sent', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.blueHq)
      const co = await ctx.login(fx.users.blueCo)
      must(await co.muc.join(room, 'blue-co'), 'join')
      const seen = record<RoomMessage>((l) => co.muc.onMessage(room, l))
      const fits = 'x'.repeat(LIMITS.messageStanzaBytes - 1_024)
      must(await co.muc.send(room, fits), 'a message well inside the cap')
      await seen.next((m) => m.body === fits)
      const over = 'y'.repeat(LIMITS.messageStanzaBytes)
      expect(errorOf(await co.muc.send(room, over))?.condition).toBe('too-large')
    })

    it('the stanza cap counts bytes after XML escaping, not characters', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.blueHq)
      const co = await ctx.login(fx.users.blueCo)
      must(await co.muc.join(room, 'blue-co'), 'join')
      // `<` escapes to `&lt;` (4 bytes): 17,000 characters are 68,000 bytes on the wire.
      const escaped = '<'.repeat(17_000)
      expect(errorOf(await co.muc.send(room, escaped))?.condition).toBe('too-large')
      // `é` is 2 bytes of UTF-8: 33,000 characters are 66,000 bytes.
      expect(errorOf(await co.muc.send(room, 'é'.repeat(33_000)))?.condition).toBe('too-large')
    })
  })
}
