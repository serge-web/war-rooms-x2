import { ManualTime, demoState, emptyState, parseMockState } from '@wrx/mock-server'
import type { ServerFrame } from '@wrx/mock-server'
import { describe, expect, it } from 'vitest'
import { ServerHost } from './host.ts'
import type { ServerHostOptions } from './host.ts'
import { MemoryStore, UnavailableStore } from './store.ts'
import type { LogEntry, MockNotice } from './wire.ts'

const seed = emptyState('wrx.test', 'pw')

function options(store = new MemoryStore(), extra: Partial<ServerHostOptions> = {}) {
  const notices: MockNotice[] = []
  const logs: LogEntry[] = []
  const time = new ManualTime()
  const opts: ServerHostOptions = {
    store,
    seed,
    log: (entry) => logs.push(entry),
    broadcast: (notice) => notices.push(notice),
    scheduler: time,
    server: { clock: time },
    ...extra,
  }
  return { opts, notices, logs, time, store }
}

function stored(store: MemoryStore) {
  const parsed = parseMockState(store.current)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

/** Logs in as the admin on connection 1 of `tab`, collecting frames. */
function adminLogin(host: ServerHost, tab = 't1') {
  const frames: ServerFrame[] = []
  host.receive(
    tab,
    1,
    { t: 'login', credentials: { kind: 'password', username: 'admin', password: 'pw' } },
    (f) => frames.push(f),
  )
  return frames
}

describe('ServerHost (ARC-7, DOC-17)', () => {
  it('starts from the seed when nothing is stored, and saves it', async () => {
    const { opts, store } = options()
    const host = await ServerHost.start(opts)
    expect(host.notices).toEqual([])
    expect(stored(store)).toEqual(seed)
  })

  it('loads stored state', async () => {
    const demo = demoState()
    const { opts } = options(new MemoryStore(JSON.stringify(demo)))
    const host = await ServerHost.start(opts)
    const result = await host.control({ op: 'export' })
    expect(result.ok && JSON.parse(result.json!)).toEqual(demo)
    expect(host.notices).toEqual([])
  })

  it('resets unreadable state to the seed with a notice, and stores the seed', async () => {
    const { opts, logs, store } = options(new MemoryStore('{"format": "wrx1-mock-state", "vers'))
    const host = await ServerHost.start(opts)
    expect(host.notices).toHaveLength(1)
    expect(host.notices[0]?.kind).toBe('reset-unreadable')
    expect(logs.some((l) => l.message.includes('unreadable'))).toBe(true)
    expect(stored(store)).toEqual(seed)
  })

  it('migrates older state with a notice, and stores the result', async () => {
    const old = { ...demoState(), version: 1 }
    const { opts, store } = options(new MemoryStore(old), {
      migrations: { 1: (doc) => ({ ...doc, version: 2 }) },
    })
    const host = await ServerHost.start(opts)
    expect(host.notices).toEqual([expect.objectContaining({ kind: 'migrated', from: 1, to: 2 })])
    expect(stored(store)).toEqual(demoState())
  })

  it('resets a state from before GUID ids to the seed, with a notice (WP 3.5, DOC-17)', async () => {
    // What a browser kept from a release before GUID ids: version 1, slug-named nodes.
    const old = { ...demoState(), version: 1, nodes: [] }
    const { opts, store } = options(new MemoryStore(old))
    const host = await ServerHost.start(opts)
    expect(host.notices).toEqual([
      expect.objectContaining({ kind: 'reset-unreadable', reason: 'no migration from version 1' }),
    ])
    expect(stored(store)).toEqual(seed)
  })

  it('runs in memory with a notice when storage is unavailable', async () => {
    const { opts } = options()
    const host = await ServerHost.start({ ...opts, store: new UnavailableStore('private mode') })
    expect(host.notices[0]?.kind).toBe('storage-unavailable')
    const frames = adminLogin(host)
    expect(frames[0]?.t).toBe('bound')
  })

  it('saves after requests, once per delay', async () => {
    const { opts, store, time } = options(undefined, { saveDelayMs: 100 })
    const host = await ServerHost.start(opts)
    const frames = adminLogin(host)
    host.receive(
      't1',
      1,
      { t: 'request', id: 1, request: { op: 'admin.addUser', args: ['a@wrx.test', 'x'] } },
      (f) => frames.push(f),
    )
    host.receive(
      't1',
      1,
      { t: 'request', id: 2, request: { op: 'admin.addUser', args: ['b@wrx.test', 'x'] } },
      (f) => frames.push(f),
    )
    expect(stored(store).accounts).toHaveLength(1)
    await time.advance(100)
    expect(stored(store).accounts.map((a) => a.jid)).toEqual([
      'admin@wrx.test',
      'a@wrx.test',
      'b@wrx.test',
    ])
  })

  it('reports a failed save once', async () => {
    const store = new MemoryStore()
    const { opts, notices } = options(store)
    const host = await ServerHost.start(opts)
    store.save = () => Promise.reject(new DOMException('full', 'QuotaExceededError'))
    adminLogin(host)
    const add = (id: number) => {
      host.receive(
        't1',
        1,
        { t: 'request', id, request: { op: 'admin.addUser', args: [`u${id}@wrx.test`, 'x'] } },
        () => undefined,
      )
    }
    add(1)
    await host.flush()
    add(2)
    await host.flush()
    expect(notices.map((n) => n.kind)).toEqual(['storage-failed'])
  })

  it('resets, exports and imports for every connection, and tells every tab', async () => {
    const { opts, notices, store } = options()
    const host = await ServerHost.start(opts)
    const frames = adminLogin(host)
    host.receive(
      't1',
      1,
      { t: 'request', id: 1, request: { op: 'admin.addUser', args: ['a@wrx.test', 'x'] } },
      (f) => frames.push(f),
    )
    const exported = await host.control({ op: 'export' })
    expect(exported.ok).toBe(true)
    const json = exported.ok ? exported.json! : ''

    expect(await host.control({ op: 'reset' })).toEqual({ ok: true })
    expect(frames.at(-1)).toEqual({ t: 'dropped' })
    expect(stored(store)).toEqual(seed)
    expect(host.connectedTabs()).toEqual([])

    expect(await host.control({ op: 'import', json })).toEqual({ ok: true })
    expect(stored(store).accounts).toHaveLength(2)
    expect(notices.map((n) => n.kind)).toEqual(['reset', 'imported'])

    const bad = await host.control({ op: 'import', json: '{"format":"nope"}' })
    expect(bad.ok).toBe(false)
    expect(stored(store).accounts).toHaveLength(2)
  })

  it('drops the sessions of a tab that has gone', async () => {
    const { opts } = options()
    const host = await ServerHost.start(opts)
    adminLogin(host, 't1')
    adminLogin(host, 't2')
    expect(host.sessions()).toHaveLength(2)
    host.dropTab('t1')
    expect(host.sessions()).toHaveLength(1)
    expect(host.connectedTabs()).toEqual(['t2'])
  })

  it('tells a connection it does not know to start again', async () => {
    const { opts } = options()
    const host = await ServerHost.start(opts)
    const frames: ServerFrame[] = []
    host.receive(
      't1',
      7,
      {
        t: 'request',
        id: 1,
        request: { op: 'muc.listRooms', args: [{ max: 50, after: undefined }] },
      },
      (f) => frames.push(f),
    )
    expect(frames).toEqual([{ t: 'dropped' }])
  })

  it('stops serving and saving once retired', async () => {
    const { opts, store } = options()
    const host = await ServerHost.start(opts)
    const frames = adminLogin(host)
    host.retire()
    expect(frames.at(-1)).toEqual({ t: 'dropped' })
    const again = adminLogin(host)
    expect(again[0]).toMatchObject({ t: 'refused' })
    await store.save('sentinel')
    await host.flush()
    expect(store.current).toBe('sentinel')
  })
})
