// S04 admin provisioning (R5): every admin operation runs over XMPP with the admin's own session,
// and each test checks the effect, not just the reply. Port of spike S04-admin-provisioning.
import type { ConnectionStatus } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { GAME_ROOM, WHITELIST_NODE } from '../fixture.ts'
import { errorOf, json, must, record, uniq } from '../harness.ts'

export function s04(ctx: Ctx): void {
  describe('S04 admin provisioning', () => {
    const account = () => uniq(`${ctx.fx().tag}-s04`)

    // XEP-0133 §4.1 add-user; an existing account is <conflict/> (spike S4).
    it('add-user creates an account that can log in; adding it again is conflict', async () => {
      const admin = ctx.admin()
      const user = account()
      try {
        must(await admin.admin.addUser(ctx.jid(user), 'pw-one'), 'add-user')
        const session = await ctx.login(user, { password: 'pw-one' })
        expect(session.status()).toEqual({ state: 'online' })
        expect(errorOf(await admin.admin.addUser(ctx.jid(user), 'pw-two'))?.condition).toBe(
          'conflict',
        )
      } finally {
        await admin.admin.deleteUser(ctx.jid(user))
      }
    })

    // §4.7 change-user-password: the new password works, the old fails, and a session that is
    // already open stays open (PLY-31).
    it('change-user-password switches the password without ending open sessions', async () => {
      const admin = ctx.admin()
      const user = account()
      try {
        must(await admin.admin.addUser(ctx.jid(user), 'pw-one'), 'add-user')
        const open = await ctx.login(user, { password: 'pw-one' })
        must(await admin.admin.changePassword(ctx.jid(user), 'pw-two'), 'change password')
        const old = await ctx.tryLogin({ kind: 'password', username: user, password: 'pw-one' })
        expect(errorOf(old)?.condition).toBe('not-authorized')
        await ctx.login(user, { password: 'pw-two' })
        expect(open.status()).toEqual({ state: 'online' })
        must(await open.pubsub.listNodes(), 'the open session still works')
      } finally {
        await admin.admin.deleteUser(ctx.jid(user))
      }
    })

    // §4.18 get-online-users-list (field name is the server's: ejabberd `onlineuserjids`).
    it('lists online accounts as bare JIDs', async () => {
      const fx = ctx.fx()
      await ctx.login(fx.users.redCo)
      const online = must(await ctx.admin().admin.onlineUsers(), 'online users')
      expect(online).toContain(ctx.jid(fx.users.redCo))
      expect(online.every((j) => !j.includes('/'))).toBe(true)
    })

    // §4.6 end-user-session ends every session of the account (D22: a role may have several).
    it('end-user-session ends every session of the account with session-ended', async () => {
      const admin = ctx.admin()
      const user = account()
      try {
        must(await admin.admin.addUser(ctx.jid(user), 'pw'), 'add-user')
        const one = await ctx.login(user, { password: 'pw' })
        const two = await ctx.login(user, { password: 'pw' })
        const ended = [one, two].map((s) => record<ConnectionStatus>((l) => s.onStatus(l)))
        must(await admin.admin.endUserSessions(ctx.jid(user)), 'end sessions')
        for (const r of ended) await r.next((s) => s.state === 'ended', 10_000)
        expect(one.status()).toMatchObject({ state: 'ended', reason: 'session-ended' })
        expect(two.status()).toMatchObject({ state: 'ended', reason: 'session-ended' })
      } finally {
        await admin.admin.deleteUser(ctx.jid(user))
      }
    })

    // §4.2 delete-user on an online account: the session gets <conflict/> (account-removed,
    // PLY-50); the account can no longer log in.
    it('delete-user ends the online session with account-removed', async () => {
      const admin = ctx.admin()
      const user = account()
      must(await admin.admin.addUser(ctx.jid(user), 'pw'), 'add-user')
      const session = await ctx.login(user, { password: 'pw' })
      const statuses = record<ConnectionStatus>((l) => session.onStatus(l))
      must(await admin.admin.deleteUser(ctx.jid(user)), 'delete-user')
      await statuses.next((s) => s.state === 'ended', 10_000)
      expect(session.status()).toMatchObject({ state: 'ended', reason: 'account-removed' })
      const again = await ctx.tryLogin({ kind: 'password', username: user, password: 'pw' })
      expect(errorOf(again)?.condition).toBe('not-authorized')
    })

    // XEP-0133 is for admins only (§4 "the requesting entity is authorized"); ejabberd answers
    // <forbidden/> "Access denied by service policy".
    it('a player cannot run admin commands', async () => {
      const fx = ctx.fx()
      const player = await ctx.login(fx.users.blueCo)
      expect(errorOf(await player.admin.addUser(ctx.jid(account()), 'pw'))?.condition).toBe(
        'forbidden',
      )
      expect(errorOf(await player.admin.onlineUsers())?.condition).toBe('forbidden')
      expect(errorOf(await player.admin.endUserSessions(ctx.jid(fx.users.redCo)))?.condition).toBe(
        'forbidden',
      )
    })

    // XEP-0045 §10.1–10.2 create and configure, §9.5 / §10.5 affiliation lists.
    it('creates a room whose config and affiliations read back as set', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const room = ctx.room(uniq(`${fx.tag}-s04`))
      try {
        const config = { ...GAME_ROOM, name: 'S04 room', description: 'made by the suite' }
        must(await admin.muc.createRoom(room, config), 'create')
        expect(must(await admin.muc.getRoomConfig(room), 'config')).toEqual(config)
        const entries = [
          { jid: ctx.jid(fx.users.blueCo), affiliation: 'member' as const },
          { jid: ctx.jid(fx.users.redCo), affiliation: 'member' as const },
        ]
        must(await admin.muc.setAffiliations(room, entries), 'affiliations')
        const members = must(await admin.muc.getAffiliations(room, 'member'), 'list members')
        expect(members.map((m) => m.jid).sort()).toEqual(entries.map((e) => e.jid).sort())
        expect(must(await admin.muc.listRooms(), 'list rooms')).toContain(room)
      } finally {
        await admin.muc.destroyRoom(room)
      }
    })

    // XEP-0060 §8.1–8.2 create and configure, §8.9 affiliations.
    it('creates a node whose config and affiliations read back as set', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const node = `${fx.tag}:${uniq('s04')}`
      try {
        const config = { ...WHITELIST_NODE, maxItems: 3, title: 'S04 node' }
        must(await admin.pubsub.createNode(node, config), 'create')
        expect(must(await admin.pubsub.getNodeConfig(node), 'config')).toEqual(config)
        const entries = [{ jid: ctx.jid(fx.users.blueCo), affiliation: 'publisher' as const }]
        must(await admin.pubsub.setAffiliations(node, entries), 'affiliations')
        const affiliations = must(await admin.pubsub.getAffiliations(node), 'list')
        expect(affiliations).toContainEqual(entries[0])
        expect(affiliations.find((a) => a.affiliation === 'owner')?.jid).toBe(
          admin.jid.split('/')[0],
        )
        expect(must(await admin.pubsub.listNodes(), 'list nodes')).toContain(node)
        expect(errorOf(await admin.pubsub.createNode(node, config))?.condition).toBe('conflict')
      } finally {
        await admin.pubsub.deleteNode(node)
      }
    })

    // XEP-0049 private storage: per account, so the vault (ADM-37) is the admin's alone.
    it('private storage keeps a value per account', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const key = `contract-${fx.tag}`
      expect(must(await admin.admin.getPrivate(key), 'read unset')).toBeUndefined()
      const value = json({ ciphertext: 'abc', at: 1 })
      must(await admin.admin.setPrivate(key, value), 'write')
      expect(must(await admin.admin.getPrivate(key), 'read back')).toBe(value)
      const player = await ctx.login(fx.users.blueCo)
      expect(must(await player.admin.getPrivate(key), 'another account reads')).toBeUndefined()
      must(await admin.admin.setPrivate(key, json(null)), 'overwrite')
      expect(must(await admin.admin.getPrivate(key), 'read again')).toBe('null')
    })

    // Several keys in one session: the vault and the publish marker live side by side.
    it('private storage keeps several keys apart', async () => {
      const fx = ctx.fx()
      const admin = ctx.admin()
      const first = `contract-a-${fx.tag}`
      const second = `contract-b-${fx.tag}`
      must(await admin.admin.setPrivate(first, 'one'), 'write first')
      must(await admin.admin.setPrivate(second, 'two'), 'write second')
      expect(must(await admin.admin.getPrivate(first), 'read first')).toBe('one')
      expect(must(await admin.admin.getPrivate(second), 'read second')).toBe('two')
      must(await admin.admin.setPrivate(first, 'uno'), 'overwrite first')
      expect(must(await admin.admin.getPrivate(second), 'second unchanged')).toBe('two')
      expect(must(await admin.admin.getPrivate(first), 'first updated')).toBe('uno')
    })
  })
}
