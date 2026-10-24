// C01 admin-tooling rules (R1): the behaviours the admin tooling (WP 2.1) builds on, R-A to R-F
// from the spike's provision/admin-ops.ts. Port of spike C01-admin-tooling.test.ts. Tagged `r1`.
// Uses its own accounts, rooms and nodes, so the shared fixture is untouched.
import type { Session } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import type { Ctx } from '../context.ts'
import { GAME_ROOM, WHITELIST_NODE, revokeVoice } from '../fixture.ts'
import { errorOf, json, must, record, sleep, uniq } from '../harness.ts'

export function c01(ctx: Ctx): void {
  describe('C01 admin-tooling rules (R1)', { tags: ['r1'] }, () => {
    /** A temporary account, room or node, removed at the end of the test. */
    async function tempAccount(admin: Session): Promise<string> {
      const user = uniq(`${ctx.fx().tag}-c01`)
      must(await admin.admin.addUser(ctx.jid(user), ctx.fx().password), 'add-user')
      return user
    }

    // XEP-0060 §8.9 (affiliations) and §8.8 (subscriptions). R-A: an affiliation change alone
    // leaves a subscribed reader reading; removing the subscription too cuts it off.
    it('R-A revoking a subscribed reader needs the subscription removed as well', async () => {
      const admin = ctx.admin()
      const user = await tempAccount(admin)
      const node = `${ctx.fx().tag}:c01:${uniq('ra')}`
      try {
        must(await admin.pubsub.createNode(node, WHITELIST_NODE), 'create node')
        must(await admin.pubsub.publish(node, 'current', json({ v: 1 })), 'seed')
        must(
          await admin.pubsub.setAffiliations(node, [{ jid: ctx.jid(user), affiliation: 'member' }]),
          'grant',
        )
        const reader = await ctx.login(user)
        must(await reader.pubsub.subscribe(node), 'subscribe')
        expect((await reader.pubsub.getItems(node)).ok).toBe(true)

        must(
          await admin.pubsub.setAffiliations(node, [{ jid: ctx.jid(user), affiliation: 'none' }]),
          'revoke affiliation',
        )
        // Server discretion (XEP-0060 leaves the effect on existing subscriptions open):
        // ejabberd keeps serving a subscribed reader (spike S2, S12). The tooling must not rely
        // on the affiliation alone.
        const afterAffiliation = await reader.pubsub.getItems(node)
        expect(afterAffiliation.ok).toBe(true)

        const subs = must(await admin.pubsub.getSubscriptions(node), 'list subscriptions')
        const theirs = subs.filter((s) => s.jid.split('/')[0] === ctx.jid(user))
        expect(theirs.length).toBeGreaterThan(0)
        must(
          await admin.pubsub.setSubscriptions(
            node,
            theirs.map((s) => ({ jid: s.jid, subscription: 'none' })),
          ),
          'remove subscription',
        )
        const events = record((l) => reader.pubsub.onItems(node, l))
        must(await admin.pubsub.publish(node, 'current', json({ v: 2 })), 'publish after revoke')
        expect(errorOf(await reader.pubsub.getItems(node))?.condition).toBe('not-allowed')
        expect(errorOf(await reader.pubsub.subscribe(node))?.condition).toBe('not-allowed')
        await sleep(1_000)
        expect(events.events).toEqual([])
      } finally {
        await admin.pubsub.deleteNode(node)
        await admin.admin.deleteUser(ctx.jid(user))
      }
    })

    // XEP-0045 §9.3 / §10.6 affiliation changes. R-B: any affiliation change clears the stored
    // visitor role (ejabberd discretion, R13); re-setting the same affiliation keeps it; the
    // password route restores it.
    it('R-B an affiliation round-trip clears the stored visitor role; re-revoking restores it', async () => {
      const admin = ctx.admin()
      const watcher = await tempAccount(admin)
      const room = ctx.room(uniq(`${ctx.fx().tag}-c01-rb`))
      const member = [{ jid: ctx.jid(watcher), affiliation: 'member' as const }]
      const roleOnJoin = async (): Promise<string> => {
        const s = await ctx.login(watcher)
        const joined = must(await s.muc.join(room, 'watcher'), 'watcher joins')
        await s.disconnect()
        return joined.role
      }
      try {
        must(await admin.muc.createRoom(room, GAME_ROOM), 'create room')
        must(await admin.muc.setAffiliations(room, member), 'member')
        const observer = await ctx.login(watcher)
        await revokeVoice(admin, observer, room, 'watcher')
        await observer.disconnect()
        expect(await roleOnJoin()).toBe('visitor')

        must(await admin.muc.setAffiliations(room, member), 'same affiliation again')
        expect(await roleOnJoin()).toBe('visitor')

        must(
          await admin.muc.setAffiliations(room, [{ jid: ctx.jid(watcher), affiliation: 'none' }]),
          'none',
        )
        must(await admin.muc.setAffiliations(room, member), 'member again')
        expect(await roleOnJoin()).toBe('participant')

        const again = await ctx.login(watcher)
        await revokeVoice(admin, again, room, 'watcher')
        await again.disconnect()
        expect(await roleOnJoin()).toBe('visitor')
      } finally {
        await admin.muc.destroyRoom(room)
        await admin.admin.deleteUser(ctx.jid(watcher))
      }
    })

    // XEP-0045 §10.2 (muc#roomconfig_moderatedroom). R-C: stored roles apply only while the room
    // is moderated, and survive it being unmoderated for a while.
    it('R-C an unmoderated room lets the observer speak; moderating it again restores visitor', async () => {
      const admin = ctx.admin()
      const watcher = await tempAccount(admin)
      const room = ctx.room(uniq(`${ctx.fx().tag}-c01-rc`))
      const roleOnJoin = async (): Promise<string> => {
        const s = await ctx.login(watcher)
        const joined = must(await s.muc.join(room, 'watcher'), 'watcher joins')
        await s.disconnect()
        return joined.role
      }
      try {
        must(await admin.muc.createRoom(room, GAME_ROOM), 'create room')
        must(
          await admin.muc.setAffiliations(room, [{ jid: ctx.jid(watcher), affiliation: 'member' }]),
          'member',
        )
        const observer = await ctx.login(watcher)
        await revokeVoice(admin, observer, room, 'watcher')
        await observer.disconnect()
        must(await admin.muc.configureRoom(room, { ...GAME_ROOM, moderated: false }), 'unmoderate')
        expect(must(await admin.muc.getRoomConfig(room), 'config').moderated).toBe(false)
        expect(await roleOnJoin()).toBe('participant')
        must(await admin.muc.configureRoom(room, GAME_ROOM), 'moderate')
        expect(await roleOnJoin()).toBe('visitor')
      } finally {
        await admin.muc.destroyRoom(room)
        await admin.admin.deleteUser(ctx.jid(watcher))
      }
    })

    // XEP-0133 §4.2 delete-user. R-E: deletion is idempotent, and the account cannot log in.
    it('R-E deleting an account is final and idempotent', async () => {
      const admin = ctx.admin()
      const user = await tempAccount(admin)
      must(await admin.admin.deleteUser(ctx.jid(user)), 'delete')
      must(await admin.admin.deleteUser(ctx.jid(user)), 'delete again')
      const login = await ctx.tryLogin({
        kind: 'password',
        username: user,
        password: ctx.fx().password,
      })
      expect(errorOf(login)?.condition).toBe('not-authorized')
    })

    // XEP-0045 §10.9 destroy, XEP-0313. R-F: destroying a room deletes its archive, so game
    // history lives exactly as long as the room (ADM-40).
    it('R-F destroying a room deletes its MAM archive', async () => {
      const admin = ctx.admin()
      const user = await tempAccount(admin)
      const room = ctx.room(uniq(`${ctx.fx().tag}-c01-rf`))
      try {
        must(await admin.muc.createRoom(room, GAME_ROOM), 'create room')
        must(
          await admin.muc.setAffiliations(room, [{ jid: ctx.jid(user), affiliation: 'member' }]),
          'member',
        )
        const poster = await ctx.login(user)
        must(await poster.muc.join(room, 'poster'), 'join')
        must(await poster.muc.send(room, json({ text: 'retained?' })), 'post')
        await poster.disconnect()
        must(await admin.muc.destroyRoom(room), 'destroy')
        must(await admin.muc.createRoom(room, GAME_ROOM), 'recreate')
        must(await admin.muc.join(room, 'admin'), 'admin joins')
        const page = must(await admin.mam.queryRoom(room, { max: 10 }), 'MAM')
        must(await admin.muc.leave(room), 'admin leaves')
        expect(page.messages).toEqual([])
        expect(page.complete).toBe(true)
      } finally {
        await admin.muc.destroyRoom(room)
        await admin.admin.deleteUser(ctx.jid(user))
      }
    })
  })
}
