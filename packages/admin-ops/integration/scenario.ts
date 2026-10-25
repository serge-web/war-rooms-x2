// The admin-ops integration scenario, run against the mock (src/mock.integration.test.ts) and
// against ejabberd (ejabberd/admin-ops.ejabberd.test.ts). It provisions
// `sampleDesignWithWhiteCell()` on a clean server through AdminOps, checks each rule by its effect as C01 does (logging in as the
// players and trying), then provisions a changed design and checks again.
//
// The changed design: Blue CO moves to Red (R-D), Red CO is deleted (R-E), the negotiation room
// is destroyed (R-F), a new joint room makes the observer read-only there (R-B), and a new role
// gets a per-room read-only entry (§3 rule 5).
// @wrx/schemas does not export its fixtures; the mock server imports them the same way.
import { sampleDesignWithWhiteCell } from '../../schemas/src/fixtures.ts'
import type { DesignFile } from '@wrx/schemas'
import type {
  Endpoint,
  ItemsEvent,
  OccupantEvent,
  Outcome,
  Session,
  Transport,
  TransportError,
  Unsubscribe,
} from '@wrx/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AdminOps, ObserverVault, VAULT_KDF, VAULT_STORAGE_KEY, targetState } from '../src/index.ts'
import type { ProgressEvent } from '../src/index.ts'
import { mustOps, provision, reset } from './planner.ts'

export interface IntegrationBackend {
  readonly name: string
  readonly transport: Transport
  readonly endpoint: Endpoint
  readonly adminPassword: string
}

const QUIET_MS = 1_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function must<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: TransportError },
  what: string,
): T {
  if (result.ok) return result.value
  throw new Error(`${what}: ${result.error.condition} ${result.error.text ?? ''}`)
}

function errorOf(
  result:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: TransportError },
): TransportError | undefined {
  return result.ok ? undefined : result.error
}

function record<E>(subscribe: (listener: (event: E) => void) => Unsubscribe): {
  readonly events: E[]
  next(match: (event: E) => boolean, ms?: number): Promise<E>
} {
  const events: E[] = []
  subscribe((event) => events.push(event))
  return {
    events,
    async next(match, ms = 8_000) {
      const deadline = Date.now() + ms
      for (;;) {
        const found = events.find(match)
        if (found !== undefined) return found
        if (Date.now() > deadline) throw new Error('timed out waiting for an event')
        await sleep(20)
      }
    },
  }
}

/** The second design: what changes is listed at the top of this file. */
export function changedDesign(): DesignFile {
  const base = sampleDesignWithWhiteCell()
  return {
    ...base,
    game: { ...base.game, designVersion: 2 },
    roles: [
      ...base.roles
        .filter((r) => r.id !== 'red-co')
        .map((r) => (r.id === 'blue-co' ? { ...r, forceId: 'red' } : r)),
      {
        schemaVersion: 1,
        id: 'red-liaison',
        name: 'Red Liaison',
        forceId: 'red',
        isObserver: false,
        order: 1,
      },
    ],
    rooms: [
      ...base.rooms
        .filter((r) => r.id !== 'negotiation')
        .map((r) =>
          r.id === 'red-hq'
            ? {
                ...r,
                participants: [
                  ...r.participants,
                  { kind: 'role' as const, id: 'red-liaison', access: 'read' as const },
                ],
              }
            : r,
        ),
      {
        schemaVersion: 1,
        id: 'joint',
        name: 'Joint room',
        roomType: 'chat',
        participants: [
          { kind: 'force', id: 'blue', access: 'write' },
          { kind: 'force', id: 'red', access: 'write' },
        ],
        config: {},
        order: 3,
      },
    ],
  }
}

export function defineAdminOpsIntegration(backend: IntegrationBackend): void {
  describe(`admin-ops integration (${backend.name})`, () => {
    const first = sampleDesignWithWhiteCell()
    const second = changedDesign()
    const run = Math.random().toString(36).slice(2, 8)
    const passwords = new Map<string, string>()
    const passwordOf = (roleId: string): string => {
      const existing = passwords.get(roleId)
      if (existing !== undefined) return existing
      const generated = `pw-${run}-${roleId}-${Math.random().toString(36).slice(2, 10)}`
      passwords.set(roleId, generated)
      return generated
    }
    const passphrase = `vault passphrase ${run}`
    const opened: Session[] = []
    const progress: ProgressEvent[] = []
    let admin: Session | undefined
    let ops: AdminOps | undefined

    const connect = (username: string, password: string): Outcome<Session> =>
      backend.transport.connect({
        endpoint: backend.endpoint,
        credentials: { kind: 'password', username, password },
        resource: `it-${Math.random().toString(36).slice(2, 8)}`,
      })
    const login = async (roleId: string): Promise<Session> => {
      const session = must(await connect(roleId, passwordOf(roleId)), `login ${roleId}`)
      opened.push(session)
      return session
    }
    const theOps = (): AdminOps => {
      if (ops === undefined) throw new Error('not set up')
      return ops
    }
    const room = (roomId: string): string => theOps().roomJid(roomId)
    const jid = (roleId: string): string => theOps().roleJid(roleId)
    const closeAll = async () => {
      await Promise.all(opened.splice(0).map((s) => s.disconnect()))
    }

    /** Joins as the role and tries to post: whether the server let it. */
    const postResult = async (roleId: string, roomId: string) => {
      const session = await login(roleId)
      const joined = await session.muc.join(room(roomId), roleId)
      if (!joined.ok) return { joined: joined.error, role: undefined, posted: undefined }
      const posted = await session.muc.send(
        room(roomId),
        JSON.stringify({ text: `${roleId} ${run}` }),
      )
      return { joined: undefined, role: joined.value.role, posted: errorOf(posted) ?? 'ok' }
    }

    /** A read-only role: joins as visitor, its post is refused and nobody receives it. */
    const expectReadOnly = async (roleId: string, roomId: string, watcher: string) => {
      const watching = await login(watcher)
      must(await watching.muc.join(room(roomId), watcher), `${watcher} joins ${roomId}`)
      const seen = record<{ body: string }>((l) => watching.muc.onMessage(room(roomId), l))
      const session = await login(roleId)
      const joined = must(await session.muc.join(room(roomId), roleId), `${roleId} joins`)
      expect(joined.role, `${roleId} in ${roomId}`).toBe('visitor')
      const body = JSON.stringify({ text: `read-only ${roleId} ${run}` })
      const sent = await session.muc.send(room(roomId), body)
      expect(errorOf(sent)?.condition, `${roleId} posts in ${roomId}`).toBe('forbidden')
      await sleep(QUIET_MS)
      expect(seen.events.filter((m) => m.body === body)).toEqual([])
    }

    beforeAll(async () => {
      admin = must(await connect('admin', backend.adminPassword), 'admin login')
      // A clean server: no vault, and nothing either design provisions (a re-run on ejabberd).
      must(await admin.admin.setPrivate(VAULT_STORAGE_KEY, ''), 'clear vault')
      const cleaner = new AdminOps({ session: admin })
      await reset(cleaner, [first, second])
      const vault = mustOps(
        await ObserverVault.create(admin.admin, passphrase, {
          iterations: VAULT_KDF.minIterations,
        }),
        'create vault',
      )
      ops = new AdminOps({
        session: admin,
        login: { transport: backend.transport, endpoint: backend.endpoint },
        vault,
        onProgress: (e) => progress.push(e),
      })
    }, 300_000)

    afterAll(async () => {
      await closeAll()
      if (ops !== undefined) await reset(ops, [first, second])
      await admin?.admin.setPrivate(VAULT_STORAGE_KEY, '')
      await admin?.disconnect()
    }, 300_000)

    describe('first provision of sampleDesignWithWhiteCell()', () => {
      beforeAll(async () => {
        await provision(theOps(), first, undefined, passwordOf)
        await closeAll()
      }, 300_000)

      it('rooms are members-only, moderated, non-anonymous, persistent, unlisted (NFR-3, R-C)', async () => {
        for (const target of targetState(first).rooms) {
          const config = must(
            await theOps().session.muc.getRoomConfig(room(target.roomId)),
            'config',
          )
          expect(config).toMatchObject({
            membersOnly: true,
            moderated: true,
            whois: 'anyone',
            persistent: true,
            public: false,
            archive: true,
          })
        }
      })

      it('nodes are whitelist except game-setup and the theme asset, and all are publishers (§3 rule 15)', async () => {
        for (const node of targetState(first).nodes) {
          const config = must(await theOps().session.pubsub.getNodeConfig(node.node), node.node)
          const open = node.node === 'game-setup' || node.node === 'assets:game-logo'
          expect(config.accessModel, node.node).toBe(open ? 'open' : 'whitelist')
          expect(config.publishModel, node.node).toBe('publishers')
        }
        const objectives = must(
          await theOps().session.pubsub.getNodeConfig('objectives:blue'),
          'cfg',
        )
        expect(objectives.maxItems).toBeGreaterThanOrEqual(2)
      })

      it('the observer joins as a visitor and cannot post (R-B, ADM-37)', async () => {
        await expectReadOnly('blue-observer', 'blue-hq', 'blue-co')
      })

      it('a writer posts; a role with no access cannot join', async () => {
        expect(await postResult('blue-co', 'blue-hq')).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        expect(await postResult('white-cell', 'red-hq')).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        const outsider = await postResult('red-co', 'blue-hq')
        expect(outsider.joined?.condition).toBe('registration-required')
      })

      it('documents are readable by their readers only, and objectives take a White Force item (§3 rule 14)', async () => {
        const blue = await login('blue-co')
        const red = await login('red-co')
        const cell = await login('white-cell')
        expect(must(await blue.pubsub.getItems('objectives:blue'), 'blue reads').length).toBe(1)
        expect(errorOf(await red.pubsub.getItems('objectives:blue'))?.condition).toBe('not-allowed')
        must(
          await cell.pubsub.publish('objectives:blue', 'white-cell', JSON.stringify({ x: 1 })),
          'White Cell publishes its own item',
        )
        expect(must(await blue.pubsub.getItems('objectives:blue'), 'two items').length).toBe(2)
        expect(errorOf(await blue.pubsub.publish('objectives:blue', 'x', '{}'))?.condition).toBe(
          'forbidden',
        )
        // F5: a White Force observer reads every force's objectives and publishes none.
        const observer = await login('white-observer')
        expect(
          must(await observer.pubsub.getItems('objectives:red'), 'observer reads').length,
        ).toBe(1)
        expect(
          errorOf(await observer.pubsub.publish('objectives:red', 'white-observer', '{}'))
            ?.condition,
        ).toBe('forbidden')
        expect(must(await red.pubsub.getItems('rooms:blue-hq'), 'room doc').length).toBe(1)
      })

      it('a node is created before the first publish (never auto-created open)', () => {
        const steps = progress.filter((e) => e.state === 'done')
        const created = steps.findIndex(
          (e) => e.step === 'create node' && e.target === 'roles:blue-co',
        )
        const published = steps.findIndex(
          (e) => e.step === 'publish' && e.target === 'roles:blue-co',
        )
        expect(created).toBeGreaterThanOrEqual(0)
        expect(published).toBeGreaterThan(created)
      })

      it('a writer made read-only fails closed when the vault has no password for it (F1)', async () => {
        // Blue CO is a voiced member of Blue HQ. The vault has no password for it, so its voice
        // cannot be revoked: its membership is taken away instead, before anything else.
        const result = await theOps().makeReadOnly('blue-co', ['blue-hq'])
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'no-password', rolledBack: true },
        })
        const locked = await postResult('blue-co', 'blue-hq')
        expect(locked.joined?.condition).toBe('registration-required')
        await closeAll()
        // Put it back as the design has it: a writer.
        mustOps(
          await theOps().applyRoomAccess('blue-hq', [{ roleId: 'blue-co', access: 'write' }]),
          'restore writer',
        )
        expect(await postResult('blue-co', 'blue-hq')).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        await closeAll()
      })

      it('provisioning again changes nothing', async () => {
        expect(mustOps(await theOps().ensureRoom('blue-hq', { name: 'Blue HQ' }), 'room')).toBe(
          'unchanged',
        )
        const node = targetState(first).nodes.find((n) => n.node === 'objectives:red')
        if (node === undefined) throw new Error('no node')
        expect(mustOps(await theOps().ensureNode(node.node, node.config), 'node')).toBe('unchanged')
      })
    })

    describe('second, changed provision', () => {
      let destroyed: ReadonlyMap<string, number> = new Map()
      let blueSessions: Session[] = []
      let ejected: Promise<OccupantEvent> | undefined
      let notifications: ItemsEvent[][] = []
      let posted = 0

      beforeAll(async () => {
        // Before the change: Blue CO is online twice (two full JIDs, D22), in Blue HQ and
        // subscribed to Blue's objectives; there is history in the negotiation room.
        const a = await login('blue-co')
        const b = await login('blue-co')
        blueSessions = [a, b]
        for (const s of blueSessions) must(await s.pubsub.subscribe('objectives:blue'), 'subscribe')
        notifications = blueSessions.map(
          (s) => record<ItemsEvent>((l) => s.pubsub.onItems('objectives:blue', l)).events,
        )
        must(await a.muc.join(room('blue-hq'), 'blue-co'), 'join blue-hq')
        ejected = record<OccupantEvent>((l) => a.muc.onOccupant(room('blue-hq'), l)).next(
          (o) => o.self && !o.available,
        )
        must(await a.muc.join(room('negotiation'), 'blue-co'), 'join negotiation')
        for (let i = 0; i < 3; i++) {
          must(await a.muc.send(room('negotiation'), JSON.stringify({ text: `m${i}` })), 'post')
          posted++
        }
        // Subscriptions work before the change.
        must(
          await theOps().session.pubsub.publish(
            'objectives:blue',
            'admin',
            JSON.stringify({ v: 'before' }),
          ),
          'publish before',
        )
        await sleep(300)
        expect(notifications.map((n) => n.length)).toEqual([1, 1])

        const result = await provision(theOps(), second, first, passwordOf)
        destroyed = result.destroyed
      }, 300_000)

      afterAll(closeAll)

      it('the moved role: new access works at once, old access is gone (R-D)', async () => {
        const [a] = blueSessions
        if (a === undefined) throw new Error('no session')
        const out = await ejected
        expect(out?.statusCodes).toEqual(expect.arrayContaining([321]))
        must(await a.muc.join(room('red-hq'), 'blue-co'), 'joins red-hq')
        must(await a.muc.send(room('red-hq'), JSON.stringify({ text: 'moved' })), 'posts in red-hq')
        expect(errorOf(await a.muc.join(room('blue-hq'), 'blue-co'))?.condition).toBe(
          'registration-required',
        )
        must(await a.pubsub.getItems('objectives:red'), 'reads objectives:red')
      })

      it('the revoked reader cannot read and gets no further notifications, on every full JID (R-A)', async () => {
        for (const s of blueSessions) {
          expect(errorOf(await s.pubsub.getItems('objectives:blue'))?.condition).toBe('not-allowed')
        }
        const subs = must(await theOps().session.pubsub.getSubscriptions('objectives:blue'), 'subs')
        expect(subs.filter((s) => s.jid.startsWith(jid('blue-co')))).toEqual([])
        must(
          await theOps().session.pubsub.publish(
            'objectives:blue',
            'admin',
            JSON.stringify({ v: 'after' }),
          ),
          'publish after',
        )
        await sleep(QUIET_MS)
        expect(notifications.map((n) => n.length)).toEqual([1, 1])
      })

      it('the deleted role cannot log in and holds no affiliation (R-E)', async () => {
        const attempt = await connect('red-co', passwordOf('red-co'))
        expect(errorOf(attempt)?.condition).toBe('not-authorized')
        if (attempt.ok) await attempt.value.disconnect()
        const members = must(
          await theOps().session.muc.getAffiliations(room('red-hq'), 'member'),
          'members',
        )
        expect(members.map((m) => m.jid)).not.toContain(jid('red-co'))
        const affs = must(await theOps().session.pubsub.getAffiliations('objectives:red'), 'affs')
        expect(affs.map((a) => a.jid)).not.toContain(jid('red-co'))
      })

      it('the destroyed room reported its message count first, and is gone (R-F)', async () => {
        expect(destroyed.get('negotiation')).toBe(posted)
        const count = progress.find((e) => e.op === 'destroyRoom' && e.step === 'count messages')
        const done = progress.findIndex(
          (e) => e.op === 'destroyRoom' && e.step === 'destroy room' && e.state === 'done',
        )
        if (count === undefined) throw new Error('no count was reported')
        expect(count.messageCount).toBe(posted)
        expect(progress.indexOf(count)).toBeLessThan(done)
        const blue = await login('blue-co')
        expect(errorOf(await blue.muc.join(room('negotiation'), 'blue-co'))).toBeDefined()
      })

      it('the observer is read-only in the new room, and still in its old one (R-B)', async () => {
        await expectReadOnly('blue-observer', 'joint', 'blue-co')
        await expectReadOnly('blue-observer', 'blue-hq', 'white-cell')
      })

      it('a per-room read entry is read-only too (§3 rule 5)', async () => {
        await expectReadOnly('red-liaison', 'red-hq', 'blue-co')
        expect(await postResult('red-liaison', 'joint')).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
      })

      it('a password reset keeps the vault in step, so voice can be re-applied (ADM-26)', async () => {
        const fresh = `pw-${run}-reset`
        mustOps(await theOps().setPassword('blue-observer', fresh), 'reset')
        passwords.set('blue-observer', fresh)
        mustOps(await theOps().makeReadOnly('blue-observer', ['blue-hq', 'joint']), 're-apply')
        await expectReadOnly('blue-observer', 'joint', 'white-cell')
      })

      it('the vault refuses a wrong passphrase cleanly and opens with the right one', async () => {
        const wrong = await ObserverVault.unlock(theOps().session.admin, `${passphrase} nope`)
        expect(wrong.ok ? undefined : wrong.error.code).toBe('wrong-passphrase')
        const right = mustOps(
          await ObserverVault.unlock(theOps().session.admin, passphrase),
          'unlock',
        )
        expect(right.roles()).toEqual(['blue-observer', 'red-liaison', 'white-observer'])
        const stored = must(await theOps().session.admin.getPrivate(VAULT_STORAGE_KEY), 'stored')
        expect(stored).not.toContain(passwordOf('blue-observer'))
      })

      it('provisioning the changed design again changes nothing', async () => {
        const before = progress.length
        await provision(theOps(), second, second, passwordOf)
        const changes = progress
          .slice(before)
          .filter((e) => e.state === 'done' && e.step !== 'publish')
        expect(changes).toEqual([])
        await expectReadOnly('blue-observer', 'blue-hq', 'white-cell')
      })
    })
  })
}
