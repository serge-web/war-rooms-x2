// S00 connectivity: every account logs in over the backend's connection, the services are
// discovered, and logout is clean. Port of spike S00-connectivity.test.ts.
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { errorOf, uniq } from '../harness.ts'

export function s00(ctx: Ctx): void {
  describe('S00 connectivity', () => {
    // RFC 6120 §6 (SASL) and §7 (resource binding); spike S00.
    it('the admin and every fixture role log in, bound to the requested resource', async () => {
      const fx = ctx.fx()
      const admin = await ctx.adminSession()
      expect(admin.status()).toEqual({ state: 'online' })
      expect(admin.anonymous).toBe(false)
      for (const user of Object.values(fx.users)) {
        const resource = uniq('pane')
        const session = await ctx.login(user, { resource })
        expect(session.status()).toEqual({ state: 'online' })
        expect(session.jid).toBe(`${ctx.jid(user)}/${resource}`)
      }
    })

    // XEP-0030 §4: disco#items on the domain, then disco#info, find the services (ARC-2).
    it('discovers the MUC and PubSub services before it is ready', async () => {
      const session = await ctx.login(ctx.fx().users.blueCo)
      expect(session.services.muc).toMatch(/\S/)
      expect(session.services.pubsub).toMatch(/\S/)
      expect(session.services.muc).not.toBe(session.services.pubsub)
      expect(session.services).toEqual(ctx.admin().services)
    })

    // RFC 6120 §6.5.10: a wrong password or an unknown account is <not-authorized/>.
    it('refuses a wrong password and an unknown account with not-authorized', async () => {
      const fx = ctx.fx()
      const wrong = await ctx.tryLogin({
        kind: 'password',
        username: fx.users.blueCo,
        password: 'not-the-password',
      })
      expect(errorOf(wrong)?.condition).toBe('not-authorized')
      const unknown = await ctx.tryLogin({
        kind: 'password',
        username: `${fx.tag}-nobody`,
        password: fx.password,
      })
      expect(errorOf(unknown)?.condition).toBe('not-authorized')
    })

    // PLY-3: disconnect ends the stream; it is idempotent, and later operations fail cleanly.
    it('logs out once, reports logout, and refuses operations afterwards', async () => {
      const session = await ctx.login(ctx.fx().users.redCo)
      const states: string[] = []
      session.onStatus((s) => states.push(s.state))
      await session.disconnect()
      await session.disconnect()
      expect(session.status()).toEqual({ state: 'ended', reason: 'logout' })
      expect(states).toEqual(['ended'])
      const after = await session.pubsub.getItems(ctx.fx().nodes.announcements)
      expect(errorOf(after)?.condition).toBe('disconnected')
    })
  })
}
