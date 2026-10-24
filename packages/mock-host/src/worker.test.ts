// The SharedWorker path in Node: the worker host (worker-host.ts) behind MessageChannels, as
// FakeBrowser simulates it. Playwright runs the real SharedWorker in Chromium (e2e/).
import type { RoomMessage } from '@wrx/transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectMockTransport } from './connect.ts'
import type { MockHost } from './connect.ts'
import { FakeBrowser } from './fixtures.ts'
import type { LogEntry } from './wire.ts'

const ROOM = 'negotiation@conference.wrx.mock'
const endpoint = { websocketUrl: 'mock://test', domain: 'wrx.mock' }
const open: MockHost[] = []
const browsers: FakeBrowser[] = []

afterEach(async () => {
  for (const host of open.splice(0)) await host.close()
  for (const browser of browsers.splice(0)) browser.close()
})

function newBrowser(): FakeBrowser {
  const browser = new FakeBrowser()
  browsers.push(browser)
  return browser
}

async function tab(browser: FakeBrowser, release = 'v1', workerLog?: (e: LogEntry) => void) {
  const t = browser.tab('http://localhost/demo/', {
    worker: release,
    ...(workerLog === undefined ? {} : { workerLog }),
  })
  const host = await connectMockTransport({
    environment: t.environment,
    readyTimeoutMs: 2_000,
    log: () => undefined,
  })
  open.push(host)
  return { host, kill: t.kill }
}

async function player(host: MockHost, role: string) {
  const result = await host.connect({
    endpoint,
    credentials: { kind: 'password', username: role, password: `demo-${role}` },
    resource: `${role}-${host.tab}`,
  })
  if (!result.ok) throw new Error(`${role} cannot log in: ${result.error.condition}`)
  const session = result.value
  const bodies: string[] = []
  session.muc.onMessage(ROOM, (m: RoomMessage) => bodies.push(m.body))
  const joined = await session.muc.join(ROOM, role)
  if (!joined.ok) throw new Error(`${role} cannot join: ${joined.error.condition}`)
  const history = await session.mam.queryRoom(ROOM, { max: 100 })
  if (history.ok) bodies.push(...history.value.messages.map((m) => m.body))
  return { session, bodies }
}

describe('connectMockTransport, SharedWorker (D17, ARC-7)', () => {
  it('serves every tab from the worker', async () => {
    const browser = newBrowser()
    const one = await tab(browser)
    const two = await tab(browser)
    expect(one.host.hosting).toBe('shared-worker')
    expect(one.host.isHosting()).toBe(false)
    expect(two.host.isHosting()).toBe(false)
    const blue = await player(one.host, 'blue-co')
    const red = await player(two.host, 'red-co')
    expect((await red.session.muc.send(ROOM, '"hello"')).ok).toBe(true)
    await vi.waitFor(() => {
      expect(blue.bodies).toContain('"hello"')
    })
    expect(await two.host.resetToSeed()).toEqual({ ok: true, value: undefined })
    await vi.waitFor(() => {
      expect(one.host.notices().map((n) => n.kind)).toEqual(['reset'])
    })
  })

  it('drops the sessions of a tab that closes', async () => {
    const browser = newBrowser()
    const one = await tab(browser)
    const two = await tab(browser)
    const blue = await player(one.host, 'blue-co')
    await player(two.host, 'red-co')
    expect(blue.session.muc.occupants(ROOM).map((o) => o.nick)).toContain('red-co')
    two.kill()
    await vi.waitFor(() => {
      expect(blue.session.muc.occupants(ROOM).map((o) => o.nick)).not.toContain('red-co')
    })
  })

  it('hands the database to a newer release’s worker, and tells old tabs to reload', async () => {
    const browser = newBrowser()
    const old = await tab(browser, 'v1')
    const blue = await player(old.host, 'blue-co')
    expect((await blue.session.muc.send(ROOM, '"from v1"')).ok).toBe(true)
    await vi.waitFor(() => {
      expect(blue.bodies).toContain('"from v1"')
    })
    const fresh = await tab(browser, 'v2')
    await vi.waitFor(() => {
      expect(old.host.notices().map((n) => n.kind)).toEqual(['superseded'])
    })
    const red = await player(fresh.host, 'red-co')
    expect(red.bodies).toContain('"from v1"')
    // The old worker no longer serves or saves.
    const again = await old.host.connect({
      endpoint,
      credentials: { kind: 'password', username: 'blue-co', password: 'demo-blue-co' },
    })
    expect(!again.ok && again.error.condition).toBe('service-unavailable')
  })

  it('logs and drops invalid messages from a tab', async () => {
    const browser = newBrowser()
    const logs: LogEntry[] = []
    const t = browser.tab('http://localhost/demo/', {
      worker: 'v1',
      workerLog: (e) => logs.push(e),
    })
    const handle = t.environment.startWorker?.('wrx1-mock:/demo/:worker')
    handle?.port.listen(() => undefined)
    handle?.port.post({ k: 'c2s', tab: 'x', conn: 1, frame: { t: 'explode' } })
    await vi.waitFor(() => {
      expect(logs.map((l) => l.message)).toEqual([
        'mock host: dropped an invalid message (tab to SharedWorker)',
      ])
    })
    t.kill()
  })
})
