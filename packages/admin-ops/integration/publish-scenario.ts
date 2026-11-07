// The publish scenario (WP 2.3), run against the mock (src/publish/mock.publish.test.ts) and
// against ejabberd (ejabberd/publish.ejabberd.test.ts). Through the real planner and executor:
//
// 1. publish `sampleDesignWithWhiteCell()` on a clean server; check the effects as players
//    (C01 style);
// 2. publishing it again plans nothing (ADM-10). Objectives edited by the White Force (D21,
//    §3 rule 14, WP 5.8): a server published under WP 3.5 (White Cell read only, the admin's
//    item under the fixed id `admin`) is corrected by granting White Cell publish, nothing
//    republished; White Cell's edit is the newest and a publish keeps it; a changed draft goes
//    out as a new item and trims only the admin's own; White Cell moved out of the White Force
//    loses publish and then its edit; moved back, everything converges;
// 3. with players online, publish a change: Blue CO moves to Red (R-D), Red CO is deleted
//    (R-E), the negotiation room is destroyed with its count confirmed (R-F), a joint room is
//    added (Blue Observer read-only there, R-B), and the White Cell becomes an observer (write
//    to read in every room). Check the plan's order and warnings, then the effects;
// 4. a publish that fails part-way stops, reports what ran, and a re-run completes it with the
//    same design version (ADM-11, §3 rule 8);
// 5. a per-role password reset keeps the vault in step (ADM-26);
// 5b. message templates (Annex A): published before the room that offers them and locked; each
//    role offered its own; a templated message sent and checked valid on receipt; a change to a
//    locked template refused; an unlocked one the design drops retracted;
// 5c. the map room and the turn state (WP 5.2): the map room added, every force a write entry
//    (§3 rule 18), so the vault gains nobody and only observers are read only; the admin posts a
//    world state near
//    500 KB (PLY-53); the turn the admin advanced survives a publish, and a missing one is set
//    to turn 1 again;
// 6. reset removes everything (ADM-15), the templates node, the turn state and the map room
//    included.
import { INITIAL_GAME_STATE, LIMITS, nodeName, withUmpireRoom } from '@wrx/schemas'
import type { DesignFile, Template } from '@wrx/schemas'
import {
  ROOM,
  TEMPLATE,
  sampleDesignWithWhiteCell,
  sampleTemplates,
  sampleWorldState,
  tid,
  withSampleMapRoom,
} from '@wrx/schemas/fixtures'
import type { Endpoint, Outcome, Session, Transport, TransportError } from '@wrx/transport'
import { CLOSED_SIDE_CHANNELS, err } from '@wrx/transport'
import { accessOf, createSessionStore, effectiveAccess } from '@wrx/domain'
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

/** Step 4: a renamed room and new roles, on top of step 3: not structural (§3 rule 8, WP 5.9). */
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

const RED_REPORTS = tid('red-reports')
const SPARE = tid('spare-template')

/** An unlocked template no room offers, for step 5b's retraction. */
function spareTemplate(): Template {
  const [first] = sampleTemplates()
  if (first === undefined) throw new Error('no sample template')
  return { ...first, id: SPARE, name: 'Spare' }
}

/**
 * Step 5b: the step 4 design with the three sample templates and a Red Reports room offering
 * them, free text off: Red's force entry gives two, Red XO's role entry adds the third.
 */
function templatedThirdDesign(): DesignFile {
  const base = thirdDesign()
  return {
    ...base,
    templates: sampleTemplates(),
    rooms: [
      ...base.rooms,
      {
        schemaVersion: 1,
        id: RED_REPORTS,
        name: 'Red reports',
        roomType: 'chat',
        participants: [{ kind: 'force', id: tid('red'), access: 'write' }],
        config: {
          schemaVersion: 2,
          freeText: false,
          templates: [
            { kind: 'force', id: tid('red'), templateIds: [TEMPLATE.sitrep, TEMPLATE.contact] },
            { kind: 'role', id: tid('red-xo'), templateIds: [TEMPLATE.support] },
          ],
        },
        order: 3,
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

      it('the objectives document is a new item of the admin’s (§3 rule 14)', () => {
        const prefix = `doc:${nodeName.objectives(tid('blue'))}:admin-`
        expect(first?.steps.filter((s) => s.id.startsWith(prefix))).toHaveLength(1)
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

      it('the turn state is turn 1, planning, and every role reads it (D7, §3 rule 15)', async () => {
        const red = await login('red-co')
        const items = must(await red.pubsub.getItems('game-state'), 'read game-state')
        expect(items.map((i) => [i.id, JSON.parse(i.payload) as unknown])).toEqual([
          ['current', INITIAL_GAME_STATE],
        ])
        const forged = JSON.stringify({ ...INITIAL_GAME_STATE, turn: 5 })
        expect(errorOf(await red.pubsub.publish('game-state', 'current', forged))?.condition).toBe(
          'forbidden',
        )
        await closeAll()
      })

      it('publishing the same design again plans nothing (ADM-10)', async () => {
        const again = await plan(sampleDesignWithWhiteCell())
        expect(again.steps).toEqual([])
        expect(again.designVersion).toBeUndefined()
      })

      afterAll(closeAll)
    })

    describe('2. objectives edited by the White Force (D21, §3 rule 14, WP 5.8)', () => {
      const node = nodeName.objectives(tid('red'))
      const items = async () => must(await theOps().session.pubsub.getItems(node), 'items')
      const objectives = (markdown: string) =>
        JSON.stringify({
          schemaVersion: 1,
          forceId: tid('red'),
          markdown,
          updatedAt: '2026-11-04T09:00:00.000Z',
        })
      const shown = async (session: Session) => {
        const all = must(await session.pubsub.getItems(node), 'read')
        const last = all.at(-1)
        return last === undefined ? undefined : (JSON.parse(last.payload) as { markdown: string })
      }
      /** The sample design with Red's draft objectives changed. */
      const newDraft = (): DesignFile => {
        const base = sampleDesignWithWhiteCell()
        return {
          ...base,
          objectives: base.objectives.map((o) =>
            o.forceId === tid('red')
              ? {
                  ...o,
                  markdown: '1. Delay Blue.\n2. Hold the ford.',
                  updatedAt: '2026-11-04T10:00:00.000Z',
                }
              : o,
          ),
        }
      }
      /** The sample design with White Cell moved to Blue: it leaves the White Force. */
      const whiteCellInBlue = (): DesignFile => {
        const base = sampleDesignWithWhiteCell()
        return {
          ...base,
          roles: base.roles.map((r) =>
            r.loginName === 'white-cell' ? { ...r, forceId: tid('blue') } : r,
          ),
        }
      }
      afterAll(closeAll)

      it('corrects a WP 3.5 server: White Cell publishes again, nothing is republished', async () => {
        // What WP 3.5 left: White Cell read only; the admin's item under the fixed id `admin`
        // (publishing it trims the admin's other item, max_items being per publisher).
        const draft = sampleDesignWithWhiteCell().objectives.find((o) => o.forceId === tid('red'))
        must(
          await theOps().session.pubsub.publish(node, 'admin', JSON.stringify(draft)),
          'the old admin item',
        )
        mustOps(await theOps().setNodeAccess(node, 'white-cell', 'read'), 'WP 3.5 reader')
        expect((await items()).map((i) => i.id)).toEqual(['admin'])
        const corrected = await plan(sampleDesignWithWhiteCell())
        // An access fix, not a structural change: the design version stays (§3 rule 8).
        expect(corrected.steps.map((s) => s.id)).toEqual([`grant-node:${node}`])
        expect(corrected.designVersion).toBeUndefined()
        expect(corrected.steps.find((s) => s.id === `grant-node:${node}`)?.action).toEqual({
          type: 'node-access',
          node,
          changes: [{ roleId: 'white-cell', access: 'publish' }],
        })
        expect((await apply(corrected)).ok).toBe(true)
        expect((await plan(sampleDesignWithWhiteCell())).steps).toEqual([])
      })

      it('White Cell’s edit is the newest, for Red CO too, and a publish keeps it', async () => {
        const cell = await login('white-cell')
        must(
          await cell.pubsub.publish(node, 'white-cell-e1', objectives('Umpire: hold the ford.')),
          'White Cell edits Red’s objectives',
        )
        // It cannot overwrite or retract the admin's item (S14-8, contract S02).
        expect(errorOf(await cell.pubsub.publish(node, 'admin', '{}'))?.condition).toBe('forbidden')
        expect(errorOf(await cell.pubsub.retract(node, 'admin'))?.condition).toBe('forbidden')
        expect((await items()).map((i) => i.id)).toEqual(['admin', 'white-cell-e1'])
        expect(await shown(await login('red-co'))).toMatchObject({
          markdown: 'Umpire: hold the ford.',
        })
        expect((await plan(sampleDesignWithWhiteCell())).steps).toEqual([])
      })

      it('a changed draft goes out as a new item, the newest; only the admin’s old one goes', async () => {
        const changed = await plan(newDraft())
        const step = changed.steps.find((s) => s.id.startsWith(`doc:${node}:admin-`))
        expect(step).toBeDefined()
        expect((await apply(changed)).ok).toBe(true)
        const after = await items()
        expect(after.map((i) => i.publisher)).toEqual([
          theOps().roleJid('white-cell'),
          theOps().roleJid('admin'),
        ])
        expect(after.at(-1)?.id).toBe(step?.action.type === 'publish' ? step.action.itemId : '')
        expect(await shown(await login('red-co'))).toMatchObject({
          markdown: '1. Delay Blue.\n2. Hold the ford.',
        })
        expect((await plan(newDraft())).steps).toEqual([])
      })

      it('White Cell leaving the White Force loses publish, then its edit', async () => {
        const moved = await plan(whiteCellInBlue())
        const ids = moved.steps.map((s) => s.id)
        const retract = `retract:${node}:white-cell-e1`
        expect(ids).toContain(retract)
        expect(ids.indexOf(`revoke-node:${node}`)).toBeLessThan(ids.indexOf(retract))
        expect((await apply(moved)).ok).toBe(true)
        expect((await items()).map((i) => i.publisher)).toEqual([theOps().roleJid('admin')])
        const cell = await login('white-cell')
        expect(errorOf(await cell.pubsub.getItems(node))?.condition).toBeDefined()
        expect((await plan(whiteCellInBlue())).steps).toEqual([])
      })

      it('moved back, White Cell publishes again, and the sample design converges', async () => {
        expect((await apply(await plan(sampleDesignWithWhiteCell()))).ok).toBe(true)
        expect((await plan(sampleDesignWithWhiteCell())).steps).toEqual([])
        const cell = await login('white-cell')
        must(await cell.pubsub.publish(node, 'white-cell-e2', objectives('Again.')), 'publish')
        must(await cell.pubsub.retract(node, 'white-cell-e2'), 'retracts its own')
      })
    })

    describe('2b. a design that changes a published role’s login name is refused (ADM-5)', () => {
      const renamed = (): DesignFile => {
        const base = sampleDesignWithWhiteCell()
        return {
          ...base,
          roles: base.roles.map((r) =>
            r.loginName === 'blue-co' ? { ...r, loginName: 'blue-commander' } : r,
          ),
        }
      }

      it('plans an error naming the role, both login names and the remedy, and no step', async () => {
        const refused = await plan(renamed())
        expect(refused.steps).toEqual([])
        expect(refused.errors).toHaveLength(1)
        expect(refused.errors[0]).toMatchObject({
          kind: 'login-name-changed',
          roleId: tid('blue-co'),
          from: 'blue-co',
          to: 'blue-commander',
        })
        expect(refused.errors[0]?.message).toMatch(/delete the role and add a new one/)
        const result = await apply(refused)
        expect(result).toMatchObject({ ok: false, done: [] })
      })

      it('the server is unchanged: the old account works, no new one exists', async () => {
        const blue = await login('blue-co')
        expect(blue.jid.startsWith('blue-co@')).toBe(true)
        const attempt = await connect('blue-commander', 'any-password-at-all')
        if (attempt.ok) await attempt.value.disconnect()
        expect(attempt.ok).toBe(false)
        expect((await plan(sampleDesignWithWhiteCell())).steps).toEqual([])
        await closeAll()
      })
    })

    describe('3. a change published while players are online', () => {
      let changed: PublishPlan | undefined
      let result: ExecutionResult | undefined
      let posted = 0
      let blue: Session | undefined
      /** Blue CO's client, online through the publish, finding rooms by the directory alone. */
      let client: ReturnType<typeof createSessionStore> | undefined

      beforeAll(async () => {
        client = createSessionStore({
          session: withoutListing(await login('blue-co')),
          logger: quiet,
        })
        await client.ready()
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

      it('the online client finds the new room from the directory, without logging in again (PLY-60)', async () => {
        const store = client
        if (store === undefined) throw new Error('no client')
        const rooms = () => store.me().data.rooms.map((r) => r.room.id)
        await expect.poll(rooms, { timeout: 20_000 }).toContain(tid('joint'))
        await expect.poll(rooms, { timeout: 20_000 }).not.toContain(tid('blue-hq'))
        expect(rooms()).toContain(tid('red-hq'))
        // The destroyed room's document went with it.
        expect(store.rooms().data.map((r) => r.id)).not.toContain(tid('negotiation'))
        await expect.poll(() => store.gameSetup().data?.designVersion, { timeout: 20_000 }).toBe(4)
        await store.logout()
      })

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
        // Step 2's objectives and access fixes kept the version (§3 rule 8); White Cell moving
        // out of the White Force and back made versions 2 and 3.
        expect(changed?.designVersion).toBe(4)
        expect(changed?.structural).toBe(true)
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
        // As an observer, White Cell keeps reading objectives, and publishes none (D21, F5).
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
        expect(await gameVersion()).toBe(4)
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
        // New roles and a renamed room are not structural (§3 rule 8, WP 5.9): version 4 stays.
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

    describe('5b. message templates (Annex A, WP 4.1)', () => {
      let first: PublishPlan | undefined
      beforeAll(async () => {
        first = await plan(templatedThirdDesign())
        const result = await apply(first)
        if (!result.ok) throw new Error(`templates: ${result.failed?.error.message}`)
      }, 120_000)

      it('published the templates before the room that offers them, locking them (TD6)', () => {
        const ids = first?.steps.map((s) => s.id) ?? []
        const reports = ids.indexOf(`doc:${nodeName.room(RED_REPORTS)}:current`)
        for (const id of [TEMPLATE.sitrep, TEMPLATE.contact, TEMPLATE.support]) {
          const at = ids.indexOf(`doc:templates:${id}`)
          expect(at, id).toBeGreaterThanOrEqual(0)
          expect(at, id).toBeLessThan(reports)
          expect(first?.steps[at]?.details).toEqual([
            'A room offers it, so it locks: its fields are fixed from now on (TD6)',
          ])
        }
      })

      it('every role reads them, locked; no role may publish one', async () => {
        const session = await login('blue-observer')
        const items = must(await session.pubsub.getItems('templates'), 'read templates')
        expect(items.map((i) => i.id).sort()).toEqual(
          [TEMPLATE.sitrep, TEMPLATE.contact, TEMPLATE.support].sort(),
        )
        for (const item of items) {
          expect(JSON.parse(item.payload)).toMatchObject({
            lockedAt: templatedThirdDesign().exportedAt,
          })
        }
        expect(
          errorOf(
            await session.pubsub.publish('templates', TEMPLATE.sitrep, items[0]?.payload ?? '{}'),
          )?.condition,
        ).toBe('forbidden')
        await closeAll()
      })

      it('each role is offered its templates; one is sent, checked and received as valid', async () => {
        const xo = createSessionStore({ session: await login('red-xo'), logger: quiet })
        const co = createSessionStore({ session: await login('blue-co'), logger: quiet })
        const watcher = createSessionStore({
          session: await login('white-observer'),
          logger: quiet,
        })
        await Promise.all([xo.ready(), co.ready(), watcher.ready()])
        const names = (s: typeof xo) => s.roomTemplates(RED_REPORTS).data.templates.map((t) => t.id)
        expect(names(xo)).toEqual([TEMPLATE.sitrep, TEMPLATE.contact, TEMPLATE.support])
        // Blue CO is in Red since step 3: Red's two, not Red XO's own.
        expect(names(co)).toEqual([TEMPLATE.sitrep, TEMPLATE.contact])
        expect(names(watcher)).toEqual([])
        expect(xo.roomTemplates(RED_REPORTS).data.freeText).toBe(false)

        xo.acquireRoom(RED_REPORTS)
        watcher.acquireRoom(RED_REPORTS)
        for (const s of [xo, watcher]) {
          await expect
            .poll(() => s.roomView(RED_REPORTS).data?.status, { timeout: 10_000 })
            .toBe('joined')
        }
        const text = await xo.sendMessage(RED_REPORTS, 'free text')
        expect(text.ok ? undefined : text.error.code).toBe('not-permitted')
        const sent = await xo.sendTemplateMessage(RED_REPORTS, TEMPLATE.sitrep, {
          force: tid('red'),
          summary: `Holding ${run}`,
          readiness: 80,
          asOf: '2026-10-24',
        })
        expect(sent.ok).toBe(true)
        await expect
          .poll(
            () =>
              (watcher.roomView(RED_REPORTS).data?.messages ?? []).flatMap((m) =>
                m.kind === 'message' && m.body.type === 'template'
                  ? [watcher.checkTemplate(m)?.status]
                  : [],
              ),
            { timeout: 10_000 },
          )
          .toEqual(['valid'])
        await Promise.all([xo.logout(), co.logout(), watcher.logout()])
        await closeAll()
      })

      it('refuses a change to a locked template’s fields, and plans no step', async () => {
        const design = templatedThirdDesign()
        const changed = {
          ...design,
          templates: design.templates.map((t) =>
            t.id === TEMPLATE.contact ? { ...t, schema: { ...t.schema, required: ['grid'] } } : t,
          ),
        }
        const refused = await plan(changed)
        expect(refused.steps).toEqual([])
        expect(refused.errors.map((e) => e.kind)).toEqual(['template-locked-changed'])
        const result = await apply(refused)
        expect(result.failed?.stepId).toBe('error:template-locked-changed')
      })

      it('removes an unlocked template the design drops, then plans nothing', async () => {
        const design = templatedThirdDesign()
        const draft = {
          ...design,
          templates: [...design.templates, spareTemplate()],
        }
        expect((await apply(await plan(draft))).ok).toBe(true)
        const spare = must(await theOps().session.pubsub.getItems('templates'), 'read').find(
          (i) => i.id === SPARE,
        )
        expect(JSON.parse(spare?.payload ?? '{}')).not.toHaveProperty('lockedAt')
        const dropped = await plan(design)
        expect(dropped.steps.map((s) => s.id)).toContain(`retract:templates:${SPARE}`)
        expect((await apply(dropped)).ok).toBe(true)
        const ids = must(await theOps().session.pubsub.getItems('templates'), 'read').map(
          (i) => i.id,
        )
        expect(ids).not.toContain(SPARE)
        expect((await plan(design)).steps).toEqual([])
      })

      afterAll(closeAll)
    })

    describe('5c. the map room and the turn state (WP 5.2)', () => {
      const design = () => withSampleMapRoom(templatedThirdDesign())
      const turnState = async () => {
        const items = must(await theOps().session.pubsub.getItems('game-state'), 'game-state')
        return items.map((i) => JSON.parse(i.payload) as unknown)
      }

      it('adds the map room with every role, the observers read only, and nobody new in the vault (§3 rule 18, D25)', async () => {
        const added = await plan(design())
        expect(added.steps.map((s) => s.id)).toContain(`room:${ROOM.map}`)
        expect((await apply(added)).ok).toBe(true)
        const config = must(await theOps().session.muc.getRoomConfig(room(ROOM.map)), 'config')
        expect(config).toMatchObject({ membersOnly: true, moderated: true, archive: true })
        const before = vault?.roles()
        expect(added.steps.some((s) => s.id.startsWith('password:'))).toBe(false)
        expect(vault?.roles()).toEqual(before)
        for (const role of ['blue-observer', 'white-cell']) await expectReadOnly(role, ROOM.map)
        // A writer has voice (D25); clients accept only the admin's world states (PLY-58).
        expect(await postResult('red-xo', ROOM.map)).toMatchObject({
          role: 'participant',
          posted: 'ok',
        })
        await closeAll()
        expect((await plan(design())).steps).toEqual([])
      })

      it('the admin posts a world state near 500 KB, and a role reads it from MAM (D25, PLY-53)', async () => {
        const admin = theOps().session
        must(await admin.muc.join(room(ROOM.map), 'admin'), 'admin joins')
        const base = Object.values(sampleWorldState().assets)[0]
        if (base === undefined) throw new Error('fixture')
        const assets = Object.fromEntries(
          Array.from({ length: 1_600 }, (_, i) => {
            const id = `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
            return [id, { ...base, id, title: `Unit ${i}` }]
          }),
        )
        const body = JSON.stringify({
          type: 'world-state',
          schemaVersion: 1,
          content: { turn: 1, assets },
        })
        expect(body.length).toBeGreaterThan(400_000)
        const sent = must(
          await admin.muc.send(room(ROOM.map), body, { maxBytes: LIMITS.worldStateStanzaBytes }),
          'send the world state',
        )
        must(await admin.muc.leave(room(ROOM.map)), 'admin leaves')
        const reader = await login('red-xo')
        must(await reader.muc.join(room(ROOM.map), 'red-xo'), 'join')
        const page = must(await reader.mam.queryRoom(room(ROOM.map), { max: 1 }), 'MAM')
        expect(page.messages.at(-1)?.stanzaId).toBe(sent.stanzaId)
        expect(page.messages.at(-1)?.body).toBe(body)
        await closeAll()
      }, 120_000)

      it('a publish leaves the turn the admin advanced; a missing one is set to turn 1 again', async () => {
        const advanced = { schemaVersion: 1, turn: 2, phase: 'adjudication' }
        must(
          await theOps().session.pubsub.publish('game-state', 'current', JSON.stringify(advanced)),
          'advance',
        )
        expect((await plan(design())).steps).toEqual([])
        expect(await turnState()).toEqual([advanced])
        must(await theOps().session.pubsub.retract('game-state', 'current'), 'retract')
        const again = await plan(design())
        // A repair: the design version stays (§3 rule 8).
        expect(again.steps.map((s) => s.id)).toEqual(['doc:game-state:current'])
        expect((await apply(again)).ok).toBe(true)
        expect(await turnState()).toEqual([INITIAL_GAME_STATE])
      })

      afterAll(closeAll)
    })

    describe('5d. the umpire room (WP 6.4)', () => {
      // Step 5c's design with its umpire room, and a White Force role that writes (White Cell
      // is an observer since step 3): a new role, so not structural by itself (§3 rule 8).
      const design = (): DesignFile => {
        const base = withSampleMapRoom(templatedThirdDesign())
        const withWriter: DesignFile = {
          ...base,
          roles: [
            ...base.roles,
            {
              schemaVersion: 1,
              id: tid('white-two'),
              loginName: 'white-two',
              name: 'White Cell 2',
              forceId: tid('white'),
              isObserver: false,
              order: 9,
            },
          ],
        }
        return withUmpireRoom(withWriter, () => ROOM.umpire)
      }

      it('publishing creates it for the White Force only: writers post, its observers read, nobody else joins (§3 rule 19, PD8)', async () => {
        const added = await plan(design())
        expect(added.steps.map((s) => s.id)).toContain(`room:${ROOM.umpire}`)
        expect((await apply(added)).ok).toBe(true)
        const config = must(await theOps().session.muc.getRoomConfig(room(ROOM.umpire)), 'config')
        expect(config).toMatchObject({ membersOnly: true, moderated: true, archive: true })
        const matrix = effectiveAccess(design())
        const seen = { write: 0, read: 0, none: 0 }
        for (const role of design().roles) {
          const access = accessOf(matrix, ROOM.umpire, role.id)
          seen[access]++
          if (access === 'write') {
            expect(await postResult(role.loginName, ROOM.umpire), role.loginName).toMatchObject({
              role: 'participant',
              posted: 'ok',
            })
          } else if (access === 'read') {
            await expectReadOnly(role.loginName, ROOM.umpire)
          } else {
            const result = await postResult(role.loginName, ROOM.umpire)
            expect(result.joined?.condition, role.loginName).toBe('registration-required')
          }
        }
        // The design has a White Force writer, a White Force observer and players.
        expect(seen.write).toBeGreaterThan(0)
        expect(seen.read).toBeGreaterThan(0)
        expect(seen.none).toBeGreaterThan(0)
        await closeAll()
        expect((await plan(design())).steps).toEqual([])
      })

      it('a White Force writer’s proposal near 500 KB reaches the admin through MAM (PY-8, PLY-53)', async () => {
        const matrix = effectiveAccess(design())
        const writer = design().roles.find((r) => accessOf(matrix, ROOM.umpire, r.id) === 'write')
        if (writer === undefined) throw new Error('no White Force writer')
        const base = Object.values(sampleWorldState().assets)[0]
        if (base === undefined) throw new Error('fixture')
        const assets = Object.fromEntries(
          Array.from({ length: 1_600 }, (_, i) => {
            const id = `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
            return [id, { ...base, id, title: `Unit ${i}` }]
          }),
        )
        const body = JSON.stringify({
          type: 'world-proposal',
          schemaVersion: 1,
          content: { state: { turn: 1, assets }, summary: `Proposal ${run}` },
        })
        expect(body.length).toBeGreaterThan(400_000)
        const session = await login(writer.loginName)
        must(await session.muc.join(room(ROOM.umpire), writer.loginName), 'join')
        const sent = must(
          await session.muc.send(room(ROOM.umpire), body, {
            maxBytes: LIMITS.worldStateStanzaBytes,
          }),
          'post the proposal',
        )
        const admin = theOps().session
        must(await admin.muc.join(room(ROOM.umpire), 'admin'), 'admin joins')
        const page = must(await admin.mam.queryRoom(room(ROOM.umpire), { max: 1 }), 'MAM')
        expect(page.messages.at(-1)?.stanzaId).toBe(sent.stanzaId)
        expect(page.messages.at(-1)?.body).toBe(body)
        must(await admin.muc.leave(room(ROOM.umpire)), 'admin leaves')
        await closeAll()
      }, 120_000)

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
