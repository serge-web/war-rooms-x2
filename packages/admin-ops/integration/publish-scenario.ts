// The publish scenario (WP 2.3), run against the mock (src/publish/mock.publish.test.ts) and
// against ejabberd (ejabberd/publish.ejabberd.test.ts). Through the real planner and executor:
//
// 1. publish `sampleDesign()` on a clean server; check the effects as players (C01 style);
// 2. publishing it again plans nothing (ADM-10);
// 3. with players online, publish a change: Blue CO moves to Red (R-D), Red CO is deleted
//    (R-E), the negotiation room is destroyed with its count confirmed (R-F), a joint room is
//    added (Blue Observer read-only there, R-B), and the Lead Umpire becomes an observer (write
//    to read in every room). Check the plan's order and warnings, then the effects;
// 4. a publish that fails part-way stops, reports what ran, and a re-run completes it with the
//    same design version (ADM-11, §3 rule 8);
// 5. a per-role password reset keeps the vault in step (ADM-26);
// 6. reset removes everything (ADM-15).
import type { DesignFile } from '@wrx/schemas'
import { sampleDesign } from '@wrx/schemas/fixtures'
import type { Endpoint, Outcome, Session, Transport, TransportError } from '@wrx/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminOps,
  CredentialsBook,
  ObserverVault,
  VAULT_KDF,
  VAULT_STORAGE_KEY,
  executePlan,
  memoryMarkerStore,
  preparePublish,
  prepareReset,
  readServerView,
} from '../src/index.ts'
import type {
  ExecutionResult,
  ObserverVault as Vault,
  PublishPlan,
  StepGroup,
} from '../src/index.ts'
import { mustOps } from './planner.ts'
import { changedDesign as opsChangedDesign } from './scenario.ts'

export interface PublishBackend {
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

/** The changed design of step 3. */
export function publishChangedDesign(): DesignFile {
  const base = sampleDesign()
  return {
    ...base,
    roles: base.roles
      .filter((r) => r.id !== 'red-co')
      .map((r) =>
        r.id === 'blue-co'
          ? { ...r, forceId: 'red', order: 0 }
          : r.id === 'umpire-1'
            ? { ...r, isObserver: true }
            : r,
      ),
    rooms: [
      ...base.rooms.filter((r) => r.id !== 'negotiation'),
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
        order: 2,
      },
    ],
  }
}

/** Step 4: a renamed room and a new role, on top of step 3. */
function thirdDesign(): DesignFile {
  const base = publishChangedDesign()
  return {
    ...base,
    rooms: base.rooms.map((r) => (r.id === 'red-hq' ? { ...r, name: 'Red headquarters' } : r)),
    roles: [
      ...base.roles,
      {
        schemaVersion: 1,
        id: 'red-xo',
        name: 'Red XO',
        forceId: 'red',
        isObserver: false,
        order: 1,
      },
      {
        schemaVersion: 1,
        id: 'red-obs',
        name: 'Red Observer',
        forceId: 'red',
        isObserver: true,
        order: 2,
      },
    ],
  }
}

export function definePublishIntegration(backend: PublishBackend): void {
  describe(`publish (${backend.name})`, () => {
    const book = new CredentialsBook('random')
    const marker = memoryMarkerStore()
    const viewOptions = () => ({ marker, ...(vault === undefined ? {} : { vault }) })
    const run = Math.random().toString(36).slice(2, 8)
    const passphrase = `publish passphrase ${run}`
    const opened: Session[] = []
    let admin: Session | undefined
    let ops: AdminOps | undefined
    let vault: Vault | undefined

    const connect = (username: string, password: string): Outcome<Session> =>
      backend.transport.connect({
        endpoint: backend.endpoint,
        credentials: { kind: 'password', username, password },
        resource: `pub-${Math.random().toString(36).slice(2, 8)}`,
      })
    const theOps = (): AdminOps => {
      if (ops === undefined) throw new Error('not set up')
      return ops
    }
    const room = (roomId: string) => theOps().roomJid(roomId)
    const login = async (roleId: string): Promise<Session> => {
      const password = book.get(roleId)?.password
      if (password === undefined) throw new Error(`no password for ${roleId}`)
      const session = must(await connect(roleId, password), `login ${roleId}`)
      opened.push(session)
      return session
    }
    const closeAll = async () => {
      await Promise.all(opened.splice(0).map((s) => s.disconnect()))
    }
    const plan = async (design: DesignFile): Promise<PublishPlan> =>
      mustOps(await preparePublish(theOps(), design, viewOptions()), 'plan').plan
    const apply = (p: PublishPlan, passwordFor = (id: string) => book.passwordFor(id)) =>
      executePlan(theOps(), p, { passwordFor, marker })
    const gameVersion = async (): Promise<number | undefined> => {
      const items = must(await theOps().session.pubsub.getItems('game-setup'), 'game-setup')
      const payload = items.find((i) => i.id === 'current')?.payload
      if (payload === undefined) return undefined
      const parsed: unknown = JSON.parse(payload)
      return typeof parsed === 'object' && parsed !== null && 'designVersion' in parsed
        ? Number(parsed.designVersion)
        : undefined
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
      return {
        joined: undefined,
        role: joined.value.role,
        posted: errorOf(posted)?.condition ?? 'ok',
      }
    }
    const expectReadOnly = async (roleId: string, roomId: string) => {
      expect(await postResult(roleId, roomId), `${roleId} in ${roomId}`).toMatchObject({
        role: 'visitor',
        posted: 'forbidden',
      })
    }

    const resetServer = async () => {
      const prepared = mustOps(await prepareReset(theOps(), viewOptions()), 'plan reset')
      const result = await apply(prepared.plan)
      if (!result.ok)
        throw new Error(`reset failed at ${result.failed?.stepId}: ${result.failed?.error.message}`)
    }

    beforeAll(async () => {
      admin = must(await connect('admin', backend.adminPassword), 'admin login')
      // A clean server, whatever an earlier run left: no vault, nothing provisioned.
      must(await admin.admin.setPrivate(VAULT_STORAGE_KEY, ''), 'clear vault')
      ops = new AdminOps({
        session: admin,
        login: { transport: backend.transport, endpoint: backend.endpoint },
      })
      // Leftovers from the admin-ops scenario on the same server use these ids too.
      for (const design of [sampleDesign(), opsChangedDesign(), thirdDesign()]) {
        for (const role of design.roles)
          await theOps().deleteRole(role.id, { rooms: [], nodes: [] })
      }
      await resetServer()
      vault = mustOps(
        await ObserverVault.create(admin.admin, passphrase, {
          iterations: VAULT_KDF.minIterations,
        }),
        'create vault',
      )
      theOps().useVault(vault)
    }, 300_000)

    afterAll(async () => {
      await closeAll()
      if (ops !== undefined) await resetServer()
      await admin?.admin.setPrivate(VAULT_STORAGE_KEY, '')
      await admin?.disconnect()
    }, 300_000)

    describe('1. first publish of sampleDesign()', () => {
      let first: PublishPlan | undefined
      beforeAll(async () => {
        first = await plan(sampleDesign())
        const result = await apply(first)
        if (!result.ok) throw new Error(`first publish: ${result.failed?.error.message}`)
        await closeAll()
      }, 300_000)

      it('planned accounts, rooms and nodes before access, and documents after them', () => {
        const groups: StepGroup[] = first?.steps.map((s) => s.group) ?? []
        const lastOf = (g: StepGroup) => groups.lastIndexOf(g)
        const firstOf = (g: StepGroup) => groups.indexOf(g)
        expect(lastOf('accounts')).toBeLessThan(firstOf('rooms'))
        expect(lastOf('rooms')).toBeLessThan(firstOf('nodes'))
        expect(lastOf('nodes')).toBeLessThan(firstOf('access'))
        expect(lastOf('access')).toBeLessThan(firstOf('documents'))
        expect(first?.steps.at(-1)?.id).toBe('doc:game-setup:current')
        expect(first?.designVersion).toBe(1)
        expect(first?.steps.filter((s) => s.group === 'removals')).toEqual([])
      })

      it('the objectives document is the admin’s own item (§3 rule 14)', () => {
        expect(first?.steps.map((s) => s.id)).toContain('doc:objectives:blue:admin')
      })

      it('every password is random and only the observer’s is in the vault (NFR-6, ADM-37)', () => {
        expect(book.list().map((c) => c.roleId)).toEqual([
          'blue-co',
          'blue-observer',
          'red-co',
          'umpire-1',
        ])
        for (const c of book.list()) expect(c.password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/)
        expect(vault?.roles()).toEqual(['blue-observer'])
      })

      it('rooms have the NFR-3 defaults; writers post, the observer cannot, outsiders cannot join', async () => {
        for (const roomId of ['blue-hq', 'red-hq', 'negotiation']) {
          const config = must(await theOps().session.muc.getRoomConfig(room(roomId)), 'config')
          expect(config).toMatchObject({
            membersOnly: true,
            moderated: true,
            whois: 'anyone',
            archive: true,
          })
        }
        expect(await postResult('blue-co', 'blue-hq')).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        expect(await postResult('umpire-1', 'red-hq')).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        await expectReadOnly('blue-observer', 'blue-hq')
        expect((await postResult('red-co', 'blue-hq')).joined?.condition).toBe(
          'registration-required',
        )
        const red = await login('red-co')
        expect(errorOf(await red.pubsub.getItems('objectives:blue'))?.condition).toBe('not-allowed')
        expect(must(await red.pubsub.getItems('objectives:red'), 'own objectives')).toHaveLength(1)
      })

      it('the game is at design version 1', async () => {
        expect(await gameVersion()).toBe(1)
      })

      it('publishing the same design again plans nothing (ADM-10)', async () => {
        const again = await plan(sampleDesign())
        expect(again.steps).toEqual([])
        expect(again.designVersion).toBeUndefined()
      })

      afterAll(closeAll)
    })

    describe('3. a change published while players are online', () => {
      let changed: PublishPlan | undefined
      let result: ExecutionResult | undefined
      let posted = 0
      let blue: Session | undefined

      beforeAll(async () => {
        blue = await login('blue-co')
        must(await blue.muc.join(room('blue-hq'), 'blue-co'), 'join blue-hq')
        must(await blue.pubsub.subscribe('objectives:blue'), 'subscribe')
        must(await blue.muc.join(room('negotiation'), 'blue-co'), 'join negotiation')
        for (let i = 0; i < 3; i++) {
          must(await blue.muc.send(room('negotiation'), JSON.stringify({ text: `m${i}` })), 'post')
          posted++
        }
        await sleep(300)
        changed = await plan(publishChangedDesign())
        result = await apply(changed)
      }, 300_000)

      afterAll(closeAll)

      it('shows the online roles it affects before applying (ADM-17, ADM-25)', () => {
        expect(changed?.affectedOnline).toEqual(['blue-co'])
      })

      it('warns: deleted role, destroyed room with its count, re-syncs (ADM-13, ADM-14, ADM-40)', () => {
        const warnings = changed?.warnings ?? []
        expect(warnings).toContainEqual({ kind: 'role-deleted', roleId: 'red-co', name: 'Red CO' })
        expect(warnings).toContainEqual({
          kind: 'room-destroyed',
          roomId: 'negotiation',
          name: 'Blue–Red negotiation',
          messageCount: posted,
        })
        const resync = warnings.filter((w) => w.kind === 'resync').map((w) => w.id)
        expect(resync).toEqual(expect.arrayContaining(['blue-co', 'umpire-1']))
      })

      it('orders grants before revokes, read-only before documents, removals after, version last', () => {
        const ids = changed?.steps.map((s) => s.id) ?? []
        const at = (id: string) => {
          const i = ids.indexOf(id)
          expect(i, id).toBeGreaterThanOrEqual(0)
          return i
        }
        expect(at('grant-room:red-hq')).toBeLessThan(at('revoke-room:blue-hq'))
        expect(at('grant-node:objectives:red')).toBeLessThan(at('revoke-node:objectives:blue'))
        expect(at('read-only-grant:blue-observer')).toBeLessThan(at('doc:rooms:joint:current'))
        expect(at('read-only-revoke:umpire-1')).toBeLessThan(at('doc:roles:umpire-1:current'))
        expect(at('room:joint')).toBeLessThan(at('read-only-grant:blue-observer'))
        expect(at('doc:rooms:joint:current')).toBeLessThan(at('delete-role:red-co'))
        expect(at('delete-role:red-co')).toBeLessThan(at('destroy-room:negotiation'))
        expect(ids.at(-1)).toBe('doc:game-setup:current')
        expect(changed?.designVersion).toBe(2)
        expect(result?.ok).toBe(true)
      })

      it('the moved role keeps working, in its new rooms only (R-D)', async () => {
        expect(await postResult('blue-co', 'red-hq')).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        expect((await postResult('blue-co', 'blue-hq')).joined?.condition).toBe(
          'registration-required',
        )
        expect(await postResult('blue-co', 'joint')).toMatchObject({ posted: 'ok' })
        if (blue === undefined) throw new Error('no session')
        expect(errorOf(await blue.pubsub.getItems('objectives:blue'))?.condition).toBe(
          'not-allowed',
        )
        const subs = must(await theOps().session.pubsub.getSubscriptions('objectives:blue'), 'subs')
        expect(subs.filter((s) => s.jid.startsWith(theOps().roleJid('blue-co')))).toEqual([])
      })

      it('the deleted role cannot log in (R-E); the destroyed room is gone (R-F)', async () => {
        const password = book.get('red-co')?.password ?? ''
        const attempt = await connect('red-co', password)
        expect(errorOf(attempt)?.condition).toBe('not-authorized')
        if (attempt.ok) await attempt.value.disconnect()
        const rooms = must(await theOps().session.muc.listRooms(), 'rooms')
        expect(rooms).not.toContain(room('negotiation'))
      })

      it('the new observer is read-only everywhere; the old one is read-only in the new room (R-B)', async () => {
        await expectReadOnly('umpire-1', 'blue-hq')
        await expectReadOnly('umpire-1', 'joint')
        await expectReadOnly('blue-observer', 'joint')
        expect(vault?.roles()).toEqual(['blue-observer', 'umpire-1'])
        await sleep(QUIET_MS / 4)
      })

      it('documents and version are published; again plans nothing', async () => {
        expect(await gameVersion()).toBe(2)
        expect((await plan(publishChangedDesign())).steps).toEqual([])
      })
    })

    describe('4. a publish that fails part-way, then completes on a re-run (ADM-11)', () => {
      let failed: ExecutionResult | undefined
      let firstPlan: PublishPlan | undefined
      let rerun: PublishPlan | undefined

      beforeAll(async () => {
        firstPlan = await plan(thirdDesign())
        // The second account fails: the first is created, nothing after runs.
        failed = await apply(firstPlan, (id) => {
          if (id === 'red-obs') throw new Error('injected failure')
          return book.passwordFor(id)
        })
        rerun = await plan(thirdDesign())
      }, 300_000)

      it('stops at the failure and says what ran and what did not', () => {
        expect(failed?.ok).toBe(false)
        expect(failed?.done).toEqual(['account:red-xo'])
        expect(failed?.failed?.stepId).toBe('account:red-obs')
        expect(failed?.notRun.length).toBe((firstPlan?.steps.length ?? 0) - 2)
      })

      it('the re-run plans what is left, with the same version', () => {
        expect(rerun?.designVersion).toBe(3)
        expect(rerun?.steps.map((s) => s.id)).toContain('account:red-obs')
        expect(rerun?.steps.at(-1)?.id).toBe('doc:game-setup:current')
      })

      it('running it completes the publish; then nothing is left', async () => {
        const done = await apply(rerun ?? (await plan(thirdDesign())))
        expect(done.ok).toBe(true)
        expect(done.notes.get('account:red-xo')).toMatch(/already existed/)
        expect(await gameVersion()).toBe(3)
        expect((await plan(thirdDesign())).steps).toEqual([])
        expect(await postResult('red-xo', 'red-hq')).toMatchObject({ posted: 'ok' })
        await expectReadOnly('red-obs', 'red-hq')
        const config = must(await theOps().session.muc.getRoomConfig(room('red-hq')), 'config')
        expect(config.name).toBe('Red headquarters')
      })

      afterAll(closeAll)
    })

    describe('5. a per-role password reset (ADM-26)', () => {
      it('sets a new random password, kept in the vault for a read-only role', async () => {
        const before = book.get('blue-observer')?.password
        const fresh = book.issue('blue-observer')
        expect(fresh).not.toBe(before)
        mustOps(await theOps().setPassword('blue-observer', fresh, { readOnly: true }), 'reset')
        expect(vault?.get('blue-observer')).toBe(fresh)
        mustOps(
          await theOps().makeReadOnly('blue-observer', ['joint']),
          're-apply through the vault',
        )
        await expectReadOnly('blue-observer', 'joint')
        const stored = must(await theOps().session.admin.getPrivate(VAULT_STORAGE_KEY), 'stored')
        expect(stored).not.toContain(fresh)
      })
      afterAll(closeAll)
    })

    describe('6. reset (ADM-15)', () => {
      it('deletes every account, room and node', async () => {
        await resetServer()
        const view = mustOps(await readServerView(theOps(), viewOptions()), 'view')
        expect(view.rooms).toEqual([])
        expect(view.nodes).toEqual([])
        expect(view.marker).toBeUndefined()
        const attempt = await connect('blue-co', book.get('blue-co')?.password ?? '')
        expect(errorOf(attempt)?.condition).toBe('not-authorized')
        if (attempt.ok) await attempt.value.disconnect()
        expect(vault?.roles()).toEqual([])
      })
    })
  })
}
