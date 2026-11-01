// The publish scenario (WP 2.3), run against the mock (src/publish/mock.publish.test.ts) and
// against ejabberd (ejabberd/publish.ejabberd.test.ts). Through the real planner and executor:
//
// 1. publish `sampleDesignWithWhiteCell()` on a clean server; check the effects as players
//    (C01 style);
// 2. publishing it again plans nothing (ADM-10); a server published before WP 3.5, where White
//    Cell published its own objectives item, is corrected: its publisher affiliation goes, the
//    node is purged and the admin's item published again (D21, §3 rule 14);
// 3. with players online, publish a change: Blue CO moves to Red (R-D), Red CO is deleted
//    (R-E), the negotiation room is destroyed with its count confirmed (R-F), a joint room is
//    added (Blue Observer read-only there, R-B), and the White Cell becomes an observer (write
//    to read in every room). Check the plan's order and warnings, then the effects;
// 4. a publish that fails part-way stops, reports what ran, and a re-run completes it with the
//    same design version (ADM-11, §3 rule 8);
// 5. a per-role password reset keeps the vault in step (ADM-26);
// 6. reset removes everything (ADM-15).
import { nodeName } from '@wrx/schemas'
import type { DesignFile } from '@wrx/schemas'
import { sampleDesignWithWhiteCell, tid } from '@wrx/schemas/fixtures'
import type { Endpoint, Outcome, Session, Transport, TransportError } from '@wrx/transport'
import { CLOSED_SIDE_CHANNELS, err } from '@wrx/transport'
import { createSessionStore } from '@wrx/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminOps,
  CredentialsBook,
  ObserverVault,
  VAULT_KDF,
  VAULT_STORAGE_KEY,
  executePlan,
  planConfirmations,
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

const quiet = { debug: () => undefined, warn: () => undefined }

/** The session, with node listing refused (disco#items), as a server might (WP 3.4, fix 1). */
function withoutListing(session: Session): Session {
  const bound = <T extends object>(target: T, override: (p: string | symbol) => unknown) =>
    new Proxy(target, {
      get(t, p) {
        const replaced = override(p)
        if (replaced !== undefined) return replaced
        const value: unknown = Reflect.get(t, p, t)
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value
      },
    })
  const pubsub = bound(session.pubsub, (p) =>
    p === 'listNodes' ? () => Promise.resolve(err('forbidden')) : undefined,
  )
  return bound(session, (p) => (p === 'pubsub' ? pubsub : undefined))
}

/** The changed design of step 3. */
export function publishChangedDesign(): DesignFile {
  const base = sampleDesignWithWhiteCell()
  return {
    ...base,
    roles: base.roles
      .filter((r) => r.loginName !== 'red-co')
      .map((r) =>
        r.loginName === 'blue-co'
          ? { ...r, forceId: tid('red'), order: 0 }
          : r.loginName === 'white-cell'
            ? { ...r, isObserver: true }
            : r,
      ),
    rooms: [
      ...base.rooms.filter((r) => r.id !== tid('negotiation')),
      {
        schemaVersion: 1,
        id: tid('joint'),
        name: 'Joint room',
        roomType: 'chat',
        participants: [
          { kind: 'force', id: tid('blue'), access: 'write' },
          { kind: 'force', id: tid('red'), access: 'write' },
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
    rooms: base.rooms.map((r) => (r.id === tid('red-hq') ? { ...r, name: 'Red headquarters' } : r)),
    roles: [
      ...base.roles,
      {
        schemaVersion: 1,
        id: tid('red-xo'),
        loginName: 'red-xo',
        name: 'Red XO',
        forceId: tid('red'),
        isObserver: false,
        order: 1,
      },
      {
        schemaVersion: 1,
        id: tid('red-obs'),
        loginName: 'red-obs',
        name: 'Red Observer',
        forceId: tid('red'),
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
      executePlan(theOps(), p, { passwordFor, marker, confirmed: planConfirmations(p) })
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
      for (const design of [sampleDesignWithWhiteCell(), opsChangedDesign(), thirdDesign()]) {
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

    describe('1. first publish of sampleDesignWithWhiteCell()', () => {
      let first: PublishPlan | undefined
      beforeAll(async () => {
        first = await plan(sampleDesignWithWhiteCell())
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
        expect(first?.steps.map((s) => s.id)).toContain(
          `doc:${nodeName.objectives(tid('blue'))}:admin`,
        )
      })

      it('every password is random and only the observers’ are in the vault (NFR-6, ADM-37)', () => {
        expect(book.list().map((c) => c.roleId)).toEqual([
          'blue-co',
          'blue-observer',
          'red-co',
          'white-cell',
          'white-observer',
        ])
        for (const c of book.list()) expect(c.password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/)
        expect(vault?.roles()).toEqual(['blue-observer', 'white-observer'])
      })

      it('rooms have the NFR-3 defaults; writers post, the observer cannot, outsiders cannot join', async () => {
        for (const roomId of [tid('blue-hq'), tid('red-hq'), tid('negotiation')]) {
          const config = must(await theOps().session.muc.getRoomConfig(room(roomId)), 'config')
          expect(config).toMatchObject({
            membersOnly: true,
            moderated: true,
            whois: 'anyone',
            archive: true,
            ...CLOSED_SIDE_CHANNELS,
          })
        }
        expect(await postResult('blue-co', tid('blue-hq'))).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        expect(await postResult('white-cell', tid('red-hq'))).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        await expectReadOnly('blue-observer', tid('blue-hq'))
        expect((await postResult('red-co', tid('blue-hq'))).joined?.condition).toBe(
          'registration-required',
        )
        const red = await login('red-co')
        expect(
          errorOf(await red.pubsub.getItems(nodeName.objectives(tid('blue'))))?.condition,
        ).toBe('not-allowed')
        expect(
          must(await red.pubsub.getItems(nodeName.objectives(tid('red'))), 'own objectives'),
        ).toHaveLength(1)
      })

      it('a role finds its own role, force, objectives and rooms with node listing refused (§3 rule 1)', async () => {
        // The directory names each role's GUID by login name, so nothing depends on listing.
        const session = await login('blue-co')
        const store = createSessionStore({ session: withoutListing(session), logger: quiet })
        await store.ready()
        const me = store.me().data
        expect(me.role?.id).toBe(tid('blue-co'))
        expect(me.force?.id).toBe(tid('blue'))
        expect(me.rooms.map((r) => r.room.id)).toContain(tid('blue-hq'))
        expect(me.rooms.map((r) => r.room.id)).not.toContain(tid('red-hq'))
        expect(store.objectives(tid('blue')).data?.forceId).toBe(tid('blue'))
        // Fails closed: another force's objectives stay unreadable however the role was found.
        expect(store.objectives(tid('red')).data).toBeUndefined()
        await closeAll()
      })

      it('the game is at design version 1', async () => {
        expect(await gameVersion()).toBe(1)
      })

      it('publishing the same design again plans nothing (ADM-10)', async () => {
        const again = await plan(sampleDesignWithWhiteCell())
        expect(again.steps).toEqual([])
        expect(again.designVersion).toBeUndefined()
      })

      afterAll(closeAll)
    })

    describe('2. a server published before WP 3.5, with a White Force editor’s item (D21)', () => {
      let corrected: PublishPlan | undefined
      let result: ExecutionResult | undefined
      const node = nodeName.objectives(tid('red'))
      const ids = async () =>
        must(await theOps().session.pubsub.getItems(node), 'items')
          .map((i) => i.id)
          .sort()

      beforeAll(async () => {
        // What a publish before WP 3.5 left: White Cell a publisher, room for its item, and its
        // own item beside the admin's.
        const config = must(await theOps().session.pubsub.getNodeConfig(node), 'config')
        must(
          await theOps().session.pubsub.configureNode(node, { ...config, maxItems: 10 }),
          'old max_items',
        )
        mustOps(await theOps().setNodeAccess(node, 'white-cell', 'publish'), 'old publisher')
        const cell = await login('white-cell')
        must(
          await cell.pubsub.publish(
            node,
            'white-cell',
            JSON.stringify({
              schemaVersion: 1,
              forceId: tid('red'),
              markdown: 'Stale umpire text',
              updatedAt: '2026-10-30T09:00:00.000Z',
            }),
          ),
          'before: White Cell publishes its own item',
        )
        expect(await ids()).toEqual(['admin', 'white-cell'])
        corrected = await plan(sampleDesignWithWhiteCell())
        result = await apply(corrected)
      }, 300_000)

      afterAll(closeAll)

      it('plans: max_items to 1, White Cell to reader, purge, then the admin’s item again', () => {
        const steps = corrected?.steps.map((s) => s.id) ?? []
        expect(steps.slice(0, -1)).toEqual([
          `node:${node}`,
          `grant-node:${node}`,
          `purge:${node}`,
          `doc:${node}:admin`,
        ])
        expect(corrected?.steps.find((s) => s.id === `grant-node:${node}`)?.action).toEqual({
          type: 'node-access',
          node,
          changes: [{ roleId: 'white-cell', access: 'read' }],
        })
        expect(result?.ok).toBe(true)
      })

      it('after: the node holds the admin’s item only, and White Cell can no longer publish', async () => {
        expect(await ids()).toEqual(['admin'])
        const cell = await login('white-cell')
        const items = must(await cell.pubsub.getItems(node), 'White Cell still reads')
        expect(items.map((i) => JSON.parse(i.payload) as { markdown: string })).toEqual([
          expect.objectContaining({ markdown: '1. Delay Blue.' }),
        ])
        for (const itemId of ['white-cell', 'admin']) {
          expect(errorOf(await cell.pubsub.publish(node, itemId, '{}'))?.condition, itemId).toBe(
            'forbidden',
          )
        }
        const config = must(await theOps().session.pubsub.getNodeConfig(node), 'config')
        expect(config.maxItems).toBe(1)
      })

      it('publishing again plans nothing', async () => {
        expect((await plan(sampleDesignWithWhiteCell())).steps).toEqual([])
      })
    })

    describe('3. a change published while players are online', () => {
      let changed: PublishPlan | undefined
      let result: ExecutionResult | undefined
      let posted = 0
      let blue: Session | undefined

      beforeAll(async () => {
        blue = await login('blue-co')
        must(await blue.muc.join(room(tid('blue-hq')), 'blue-co'), 'join blue-hq')
        must(await blue.pubsub.subscribe(nodeName.objectives(tid('blue'))), 'subscribe')
        must(await blue.muc.join(room(tid('negotiation')), 'blue-co'), 'join negotiation')
        for (let i = 0; i < 3; i++) {
          must(
            await blue.muc.send(room(tid('negotiation')), JSON.stringify({ text: `m${i}` })),
            'post',
          )
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
          roomId: tid(tid('negotiation')),
          name: 'Blue–Red negotiation',
          messageCount: posted,
        })
        const resync = warnings.filter((w) => w.kind === 'resync').map((w) => w.id)
        expect(resync).toEqual(expect.arrayContaining([tid('blue-co'), tid('white-cell')]))
      })

      it('orders grants before revokes, read-only before documents, removals after, version last', () => {
        const ids = changed?.steps.map((s) => s.id) ?? []
        const at = (id: string) => {
          const i = ids.indexOf(id)
          expect(i, id).toBeGreaterThanOrEqual(0)
          return i
        }
        expect(at(`grant-room:${tid('red-hq')}`)).toBeLessThan(at(`revoke-room:${tid('blue-hq')}`))
        expect(at(`grant-node:${nodeName.objectives(tid('red'))}`)).toBeLessThan(
          at(`revoke-node:${nodeName.objectives(tid('blue'))}`),
        )
        expect(at('read-only-grant:blue-observer')).toBeLessThan(
          at(`doc:${nodeName.room(tid('joint'))}:current`),
        )
        expect(at('read-only-revoke:white-cell')).toBeLessThan(
          at(`doc:${nodeName.role(tid('white-cell'))}:current`),
        )
        expect(at(`room:${tid('joint')}`)).toBeLessThan(at('read-only-grant:blue-observer'))
        expect(at(`doc:${nodeName.room(tid('joint'))}:current`)).toBeLessThan(
          at('delete-role:red-co'),
        )
        expect(at('delete-role:red-co')).toBeLessThan(at(`destroy-room:${tid('negotiation')}`))
        expect(ids.at(-1)).toBe('doc:game-setup:current')
        expect(changed?.designVersion).toBe(3)
        expect(result?.ok).toBe(true)
      })

      it('the moved role keeps working, in its new rooms only (R-D)', async () => {
        expect(await postResult('blue-co', tid('red-hq'))).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        expect((await postResult('blue-co', tid('blue-hq'))).joined?.condition).toBe(
          'registration-required',
        )
        expect(await postResult('blue-co', tid('joint'))).toMatchObject({ posted: 'ok' })
        if (blue === undefined) throw new Error('no session')
        expect(
          errorOf(await blue.pubsub.getItems(nodeName.objectives(tid('blue'))))?.condition,
        ).toBe('not-allowed')
        const subs = must(
          await theOps().session.pubsub.getSubscriptions(nodeName.objectives(tid('blue'))),
          'subs',
        )
        expect(subs.filter((s) => s.jid.startsWith(theOps().roleJid('blue-co')))).toEqual([])
      })

      it('the deleted role cannot log in (R-E); the destroyed room is gone (R-F)', async () => {
        const password = book.get('red-co')?.password ?? ''
        const attempt = await connect('red-co', password)
        expect(errorOf(attempt)?.condition).toBe('not-authorized')
        if (attempt.ok) await attempt.value.disconnect()
        const rooms = must(await theOps().session.muc.listRooms(), 'rooms')
        expect(rooms).not.toContain(room(tid('negotiation')))
      })

      it('the deleted role keeps its last name in `retired`, read by every role, before its account went (§3 rule 1, ADM-39)', async () => {
        const ids = changed?.steps.map((s) => s.id) ?? []
        const record = `doc:retired:${tid('red-co')}`
        expect(ids.indexOf(record)).toBeGreaterThanOrEqual(0)
        expect(ids.indexOf(record)).toBeLessThan(ids.indexOf('delete-role:red-co'))
        const blueCo = await login('blue-co')
        const items = must(await blueCo.pubsub.getItems('retired'), 'Blue CO reads retired')
        expect(items.map((i) => [i.id, JSON.parse(i.payload) as unknown])).toEqual([
          [
            tid('red-co'),
            expect.objectContaining({ kind: 'role', name: 'Red CO', loginName: 'red-co' }),
          ],
        ])
        expect(errorOf(await blueCo.pubsub.publish('retired', 'x', '{}'))?.condition).toBe(
          'forbidden',
        )
      })

      it('the new observer is read-only everywhere; the old one is read-only in the new room (R-B)', async () => {
        await expectReadOnly('white-cell', tid('blue-hq'))
        await expectReadOnly('white-cell', tid('joint'))
        await expectReadOnly('blue-observer', tid('joint'))
        expect(vault?.roles()).toEqual(['blue-observer', 'white-cell', 'white-observer'])
        // As an observer, White Cell keeps reading objectives, and publishes none (D21).
        const cell = await login('white-cell')
        expect(
          must(await cell.pubsub.getItems(nodeName.objectives(tid('blue'))), 'still reads'),
        ).toHaveLength(1)
        expect(
          errorOf(await cell.pubsub.publish(nodeName.objectives(tid('blue')), 'white-cell', '{}'))
            ?.condition,
        ).toBe('forbidden')
        await sleep(QUIET_MS / 4)
      })

      it('documents and version are published; again plans nothing', async () => {
        expect(await gameVersion()).toBe(3)
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
        expect(rerun?.designVersion).toBe(4)
        expect(rerun?.steps.map((s) => s.id)).toContain('account:red-obs')
        // The account the first run made exists: it is neither created again nor reset (F3).
        expect(rerun?.steps.map((s) => s.id)).not.toContain('account:red-xo')
        expect(rerun?.warnings).toContainEqual(
          expect.objectContaining({ kind: 'account-exists', roleId: 'red-xo' }),
        )
        expect(rerun?.steps.at(-1)?.id).toBe('doc:game-setup:current')
      })

      it('running it completes the publish; then nothing is left', async () => {
        const done = await apply(rerun ?? (await plan(thirdDesign())))
        expect(done.ok).toBe(true)
        expect(done.passwordsSet).not.toContain('red-xo')
        expect(await gameVersion()).toBe(4)
        expect((await plan(thirdDesign())).steps).toEqual([])
        expect(await postResult('red-xo', tid('red-hq'))).toMatchObject({ posted: 'ok' })
        await expectReadOnly('red-obs', tid('red-hq'))
        const config = must(await theOps().session.muc.getRoomConfig(room(tid('red-hq'))), 'config')
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
          await theOps().makeReadOnly('blue-observer', [tid('joint')]),
          're-apply through the vault',
        )
        await expectReadOnly('blue-observer', tid('joint'))
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
