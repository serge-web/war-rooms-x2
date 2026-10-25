// S01 read-only members (R1): the observer can never post in its rooms, enforced by the server,
// across reconnection, with no moderator online. Port of spike S01-read-only.test.ts. Tagged
// `r1`. The mechanism is the stored visitor role (XEP-0045 §5.1 roles, §8.4 revoke voice; the
// storage is ejabberd's discretion, R13), set at provisioning by the password route (S13).
import type { RoomMessage, Session } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { errorOf, json, must, record, sleep, uniq } from '../harness.ts'

/** How long "nothing arrives" is watched for. */
const QUIET_MS = 1_500

export function s01(ctx: Ctx): void {
  describe('S01 read-only members (R1)', { tags: ['r1'] }, () => {
    async function observerPosts(): Promise<{ observer: Session; co: Session }> {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.blueHq)
      const co = await ctx.login(fx.users.blueCo)
      must(await co.muc.join(room, 'blue-co'), 'blue-co joins')
      const observer = await ctx.login(fx.users.blueObs)
      const joined = must(await observer.muc.join(room, 'blue-obs'), 'observer joins')
      // §7.2.3: the self-presence carries the stored role.
      expect(joined).toMatchObject({ role: 'visitor', affiliation: 'member' })
      // No moderator online: the server enforces the role by itself.
      const moderators = observer.muc.occupants(room).filter((o) => o.role === 'moderator')
      expect(moderators).toEqual([])
      const seen = record<RoomMessage>((l) => co.muc.onMessage(room, l))
      const body = json({ text: uniq('observer-post') })
      // §7.4 / §8.4: a visitor's groupchat message is refused with <forbidden/>. The transport
      // has no client-side check, so this is the same as a raw stanza post.
      const sent = await observer.muc.send(room, body)
      expect(errorOf(sent)).toMatchObject({ condition: 'forbidden', type: 'auth' })
      await sleep(QUIET_MS)
      expect(seen.events.filter((m) => m.body === body)).toEqual([])
      return { observer, co }
    }

    it('the observer joins as a visitor and its post is refused and not delivered', async () => {
      await observerPosts()
    })

    it('the refusal survives a new session (logout and login)', async () => {
      const first = await observerPosts()
      await first.observer.disconnect()
      await first.co.disconnect()
      await observerPosts()
    })

    it('the observer still receives history and live messages', async () => {
      const fx = ctx.fx()
      const room = ctx.room(fx.rooms.blueHq)
      const co = await ctx.login(fx.users.blueCo)
      must(await co.muc.join(room, 'blue-co'), 'blue-co joins')
      const before = json({ text: uniq('history') })
      must(await co.muc.send(room, before), 'blue-co posts')
      const observer = await ctx.login(fx.users.blueObs)
      const got = record<RoomMessage>((l) => observer.muc.onMessage(room, l))
      must(await observer.muc.join(room, 'blue-obs'), 'observer joins')
      await got.next((m) => m.body === before)
      const live = json({ text: uniq('live') })
      must(await co.muc.send(room, live), 'blue-co posts live')
      const message = await got.next((m) => m.body === live)
      expect(message.from).toBe(ctx.jid(fx.users.blueCo))
      // MAM too (PLY-49): the archive is open to members, visitors included.
      const page = must(await observer.mam.queryRoom(room, { max: 5 }), 'observer reads MAM')
      expect(page.messages.map((m) => m.body)).toContain(live)
    })
  })
}
