// The publish marker in the admin's private storage (marker.ts): every admin client sees an
// unfinished publish, an old browser-storage marker moves there once, and a publish whose marker
// cannot be set does not start.
import { MockServer, MockTransport } from '@wrx/mock-server'
import type { AdminApi, Session } from '@wrx/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleDesign } from '../../../schemas/src/fixtures.ts'
import { AdminOps } from '../ops.ts'
import { CredentialsBook } from './passwords.ts'
import { MARKER_STEP, executePlan } from './execute.ts'
import {
  MARKER_STORAGE_KEY,
  memoryMarkerStore,
  newMarker,
  privateMarkerStore,
  storageMarkerStore,
} from './marker.ts'
import { preparePublish } from './prepare.ts'
import { planConfirmations } from './plan.ts'
import { readServerView } from './view.ts'

const domain = 'marker.mock'
const adminPassword = 'mock-admin-password'

function webStorage() {
  const data = new Map<string, string>()
  return {
    data,
    storage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  }
}

describe('the publish marker in private storage', () => {
  const server = new MockServer({ domain, adminPassword })
  const transport = new MockTransport(server)
  const endpoint = { websocketUrl: 'mock://marker', domain }
  const sessions: Session[] = []
  const connect = async (): Promise<Session> => {
    const login = await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'admin', password: adminPassword },
      resource: `marker-${sessions.length}`,
    })
    if (!login.ok) throw new Error(`admin login: ${login.error.condition}`)
    sessions.push(login.value)
    return login.value
  }
  let first: Session | undefined
  let second: Session | undefined
  const both = () => {
    if (first === undefined || second === undefined) throw new Error('not set up')
    return { first, second }
  }

  beforeAll(async () => {
    first = await connect()
    second = await connect()
  })

  afterAll(async () => {
    await Promise.all(sessions.map((s) => s.disconnect()))
  })

  it('is seen by a second admin client with fresh browser storage, and cleared for both', async () => {
    const { first, second } = both()
    const here = privateMarkerStore(first.admin, {
      legacy: storageMarkerStore(webStorage().storage, 'k'),
    })
    const elsewhere = privateMarkerStore(second.admin, {
      legacy: storageMarkerStore(webStorage().storage, 'k'),
    })
    expect(await elsewhere.read()).toBeUndefined()
    expect((await here.write(newMarker(5, new Date('2026-10-25T00:00:00Z')))).ok).toBe(true)
    expect(await elsewhere.read()).toEqual({
      format: 'wrx1-publish-pending',
      designVersion: 5,
      startedAt: '2026-10-25T00:00:00.000Z',
    })
    // The planner's view, read by the second client, carries it.
    const ops = new AdminOps({ session: second, login: { transport, endpoint } })
    const view = await readServerView(ops, { marker: elsewhere })
    expect(view.ok ? view.value.marker?.designVersion : view.error.code).toBe(5)
    await here.clear()
    expect(await elsewhere.read()).toBeUndefined()
  })

  it('takes over a browser-storage marker once, then forgets the browser copy', async () => {
    const { first, second } = both()
    const old = webStorage()
    await storageMarkerStore(old.storage, 'k').write(newMarker(7, new Date()))
    const store = privateMarkerStore(first.admin, { legacy: storageMarkerStore(old.storage, 'k') })
    expect((await store.read())?.designVersion).toBe(7)
    expect(old.data.has('k')).toBe(false)
    expect((await privateMarkerStore(second.admin).read())?.designVersion).toBe(7)
    // A browser copy does not override a marker the server holds.
    await store.write(newMarker(9, new Date()))
    const stale = webStorage()
    await storageMarkerStore(stale.storage, 'k').write(newMarker(3, new Date()))
    const later = privateMarkerStore(first.admin, {
      legacy: storageMarkerStore(stale.storage, 'k'),
    })
    expect((await later.read())?.designVersion).toBe(9)
    expect(stale.data.has('k')).toBe(false)
    await store.clear()
  })

  it('counts an unreadable or garbled marker as one of unknown version', async () => {
    const failing = {
      getPrivate: () => Promise.resolve({ ok: false, error: { condition: 'service-unavailable' } }),
    } as unknown as AdminApi
    expect((await privateMarkerStore(failing).read())?.designVersion).toBe(1)
    const { first } = both()
    await first.admin.setPrivate(MARKER_STORAGE_KEY, 'garbage')
    expect((await privateMarkerStore(first.admin).read())?.designVersion).toBe(1)
    await first.admin.setPrivate(MARKER_STORAGE_KEY, '')
  })

  it('does not start a publish whose marker cannot be set', async () => {
    const { first } = both()
    const ops = new AdminOps({ session: first, login: { transport, endpoint } })
    const prepared = await preparePublish(ops, sampleDesign(), { marker: memoryMarkerStore() })
    if (!prepared.ok) throw new Error(prepared.error.message)
    const { plan } = prepared.value
    expect(plan.steps.length).toBeGreaterThan(0)
    const refusing = privateMarkerStore({
      ...first.admin,
      setPrivate: () => Promise.resolve({ ok: false, error: { condition: 'forbidden' } }),
    } as unknown as AdminApi)
    const book = new CredentialsBook('random')
    const result = await executePlan(ops, plan, {
      passwordFor: (id) => book.passwordFor(id),
      marker: refusing,
      confirmed: planConfirmations(plan),
    })
    expect(result.ok).toBe(false)
    expect(result.failed?.stepId).toBe(MARKER_STEP)
    expect(result.done).toEqual([])
    expect(result.notRun).toEqual(plan.steps.map((s) => s.id))
    const rooms = await first.muc.listRooms()
    expect(rooms.ok ? rooms.value : rooms.error.condition).toEqual([])
  })
})
