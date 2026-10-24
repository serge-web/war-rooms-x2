// S05 MAM paging (PLY-49, ARC-4): page a room's archive backwards from the latest message with
// RSM, with no gaps, duplicates or reordering. Port of spike S05-mam-paging.test.ts (which used
// 10,000 messages; the count here is a suite option).
import type { MamPage, RoomMessage, Session } from '@wrx/transport'
import { afterAll, describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { GAME_ROOM } from '../fixture.ts'
import { errorOf, must, record, setupOrFail, uniq } from '../harness.ts'

const label = (i: number): string => `m-${String(i).padStart(5, '0')}`

export function s05(ctx: Ctx, total: number): void {
  describe('S05 MAM paging', () => {
    let room = ''
    let sent: { readonly stanzaId: string }[] = []
    let poster: Session | undefined

    setupOrFail(async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      room = ctx.room(uniq(`${fx.tag}-s05`))
      must(await admin.muc.createRoom(room, GAME_ROOM), 'create room')
      const entries = [{ jid: ctx.jid(fx.users.blueCo), affiliation: 'member' as const }]
      must(await admin.muc.setAffiliations(room, entries), 'member')
      poster = must(
        await ctx.backend.connect({
          kind: 'password',
          username: fx.users.blueCo,
          password: fx.password,
          resource: uniq('s05'),
        }),
        'poster logs in',
      )
      must(await poster.muc.join(room, 'poster'), 'join')
      sent = []
      for (let i = 0; i < total; i++) sent.push(must(await poster.muc.send(room, label(i)), 'post'))
    }, 120_000)

    afterAll(async () => {
      await poster?.disconnect()
      if (room !== '') await ctx.admin().muc.destroyRoom(room)
    })

    /** Pages backwards from the latest message until `complete`. */
    async function pageAll(
      session: Session,
      max: number,
    ): Promise<{ all: RoomMessage[]; pages: MamPage[] }> {
      const pages: MamPage[] = []
      const all: RoomMessage[] = []
      let before: string | undefined
      for (let guard = 0; guard < total + 2; guard++) {
        const page = must(
          await session.mam.queryRoom(room, before === undefined ? { max } : { max, before }),
          'MAM page',
        )
        pages.push(page)
        all.unshift(...page.messages)
        if (page.complete) break
        // XEP-0059 §2.5: the page's <first/> is the cursor for the page before it.
        expect(page.first).toBeDefined()
        before = page.first
      }
      return { all, pages }
    }

    // XEP-0313 §4.3 with XEP-0059 §2.5 (<before/>): pages arrive oldest first; `complete` on the
    // last (XEP-0313 §4.3.2).
    it.each([50, 7])(
      'pages backwards with max=%i: complete, in order, no duplicates',
      async (max) => {
        const reader = await ctx.login(ctx.fx().users.blueCo)
        const { all, pages } = await pageAll(reader, max)
        const bodies = all.map((m) => m.body)
        expect(bodies).toEqual(Array.from({ length: total }, (_, i) => label(i)))
        expect(new Set(all.map((m) => m.stanzaId)).size).toBe(total)
        expect(pages.length).toBe(Math.ceil(total / max))
        expect(pages.at(-1)?.complete).toBe(true)
        for (const page of pages.slice(0, -1)) expect(page.messages.length).toBe(max)
        for (const page of pages) {
          expect(page.first).toBe(page.messages[0]?.stanzaId)
          expect(page.last).toBe(page.messages.at(-1)?.stanzaId)
        }
      },
    )

    // XEP-0359 §3 and XEP-0313 §5.1.3 (PLY-10): the archive id is the stanza-id of the live
    // message; MAM reports the occupant nick, the real bare JID (non-anonymous room) and the
    // server timestamp (XEP-0203), in order.
    it('MAM ids, senders and timestamps match what the live messages carried', async () => {
      const reader = await ctx.login(ctx.fx().users.blueCo)
      const { all } = await pageAll(reader, 50)
      expect(all.map((m) => m.stanzaId)).toEqual(sent.map((s) => s.stanzaId))
      for (const m of all) {
        expect(m).toMatchObject({ room, nick: 'poster', from: ctx.jid(ctx.fx().users.blueCo) })
        expect(Number.isNaN(Date.parse(m.timestamp))).toBe(false)
      }
      const stamps = all.map((m) => Date.parse(m.timestamp))
      expect([...stamps].sort((a, b) => a - b)).toEqual(stamps)
    })

    // XEP-0045 §7.2.15 join history vs MAM (spike S5): the same messages carry the same ids, so
    // a client can de-duplicate across the two (PLY-49). Join history itself is not relied on.
    it('join history and live messages carry the archive ids, and so does the reflection', async () => {
      const reader = await ctx.login(ctx.fx().users.blueCo)
      const live = record<RoomMessage>((l) => reader.muc.onMessage(room, l))
      must(await reader.muc.join(room, 'reader'), 'join')
      const last = sent.at(-1)?.stanzaId
      const history = await live.next((m) => m.stanzaId === last)
      expect(history.body).toBe(label(total - 1))
      const fresh = must(await reader.muc.send(room, 'fresh'), 'post')
      const echoed = await live.next((m) => m.body === 'fresh')
      expect(echoed.stanzaId).toBe(fresh.stanzaId)
      const latest = must(await reader.mam.queryRoom(room, { max: 1 }), 'latest page')
      expect(latest.messages.map((m) => m.stanzaId)).toEqual([fresh.stanzaId])
      expect(latest.messages[0]?.timestamp).toBe(echoed.timestamp)
    })

    // XEP-0313 §4.1 access: ejabberd restricts room archives to members (spike S10).
    it('a non-member cannot query the archive: forbidden', async () => {
      const red = await ctx.login(ctx.fx().users.redCo)
      expect(errorOf(await red.mam.queryRoom(room, { max: 5 }))?.condition).toBe('forbidden')
    })
  })
}
