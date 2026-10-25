// S10 anonymous access (D20, NFR-21): a SASL ANONYMOUS session reads `game-setup` and the game
// theme's assets, and nothing else. Port of spike S10-anonymous.test.ts.
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { OPEN_NODE } from '../fixture.ts'
import { errorOf, json, must, uniq } from '../harness.ts'

export function s10(ctx: Ctx): void {
  describe('S10 anonymous access (NFR-21)', () => {
    // RFC 4505 SASL ANONYMOUS (XEP-0175): the server assigns a JID on the domain.
    it('logs in anonymously with a server-assigned JID', async () => {
      const anon = await ctx.anonymous()
      expect(anon.anonymous).toBe(true)
      expect(anon.jid.split('/')[0]?.endsWith(`@${ctx.fx().domain}`)).toBe(true)
    })

    // XEP-0060 §4.5 open access model: anyone may retrieve items.
    it('reads game-setup and the theme assets', async () => {
      const fx = ctx.fx()
      const anon = await ctx.anonymous()
      const setup = must(await anon.pubsub.getItems(fx.nodes.gameSetup), 'game-setup')
      expect(setup.length).toBeGreaterThan(0)
      must(await anon.pubsub.getItems(fx.nodes.theme), 'theme')
    })

    // §4.5 whitelist: <not-allowed/> for anyone not on it (spike S10).
    it('cannot read any whitelist node', async () => {
      const fx = ctx.fx()
      const anon = await ctx.anonymous()
      const { objectivesBlue, objectivesRed, announcements, forcesBlue, rolesBlueCo, gameState } =
        fx.nodes
      for (const node of [
        objectivesBlue,
        objectivesRed,
        announcements,
        forcesBlue,
        rolesBlueCo,
        gameState,
      ]) {
        expect(errorOf(await anon.pubsub.getItems(node))?.condition, node).toBe('not-allowed')
      }
    })

    // XEP-0045 §7.2.6 members-only: <registration-required/>, type auth.
    it('cannot join any game room', async () => {
      const fx = ctx.fx()
      const anon = await ctx.anonymous()
      for (const id of Object.values(fx.rooms)) {
        expect(errorOf(await anon.muc.join(ctx.room(id), uniq('anon'))), id).toMatchObject({
          condition: 'registration-required',
          type: 'auth',
        })
      }
    })

    // XEP-0313 §4.1: ejabberd lets only members query a room archive (<forbidden/>).
    it('cannot query a room archive', async () => {
      const fx = ctx.fx()
      const anon = await ctx.anonymous()
      for (const id of Object.values(fx.rooms)) {
        expect(errorOf(await anon.mam.queryRoom(ctx.room(id), { max: 5 }))?.condition, id).toBe(
          'forbidden',
        )
      }
    })

    // XEP-0045 §10.1.1 room creation is the service's policy: admin only (<forbidden/>).
    it('cannot create a room, publish, create a node or run admin commands', async () => {
      const fx = ctx.fx()
      const anon = await ctx.anonymous()
      expect(
        errorOf(await anon.muc.join(ctx.room(uniq(`${fx.tag}-anon`)), 'anon'))?.condition,
      ).toBe('forbidden')
      expect(
        errorOf(await anon.pubsub.publish(fx.nodes.gameSetup, 'x', json({ hacked: true })))
          ?.condition,
      ).toBe('forbidden')
      expect(errorOf(await anon.pubsub.createNode(`${fx.tag}:anon`, OPEN_NODE))?.condition).toBe(
        'forbidden',
      )
      expect(errorOf(await anon.admin.onlineUsers())?.condition).toBe('forbidden')
    })

    // Node names may be listed (human decision 2026-10-24, R17); none it lists is readable
    // beyond the two open nodes.
    it('reads no protected node it can discover', async () => {
      const fx = ctx.fx()
      const anon = await ctx.anonymous()
      const names = must(await anon.pubsub.listNodes(), 'list nodes').filter((n) =>
        n.startsWith(`${fx.tag}:`),
      )
      expect(names).toContain(fx.nodes.objectivesBlue)
      const open = new Set([fx.nodes.gameSetup, fx.nodes.theme])
      const readable: string[] = []
      for (const name of names.filter((n) => !open.has(n))) {
        if ((await anon.pubsub.getItems(name)).ok) readable.push(name)
      }
      expect(readable).toEqual([])
    })

    // XEP-0045 §6.3 disco#items: unlisted rooms (public=false) are not shown.
    it('sees no game room on the MUC service', async () => {
      const anon = await ctx.anonymous()
      const rooms = must(await anon.muc.listRooms(), 'list rooms')
      expect(rooms.filter((r) => r.startsWith(ctx.fx().tag))).toEqual([])
    })
  })
}
