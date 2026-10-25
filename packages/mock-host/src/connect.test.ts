// The leader-tab path in Node (D17, R7): several "tabs" of one fake browser profile, sharing
// Web Locks, BroadcastChannels and storage. The SharedWorker path runs in Playwright (e2e/).
import type { RoomMessage, Session } from '@wrx/transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectMockTransport } from './connect.ts'
import type { MockHost, MockHostOptions } from './connect.ts'
import { FakeBrowser } from './fixtures.ts'
import { migrateMockState } from './migrate.ts'
import { hostNames, mockNamespace } from './namespace.ts'
import type { LogEntry } from './wire.ts'

const ROOM = 'negotiation@conference.wrx.mock'
const endpoint = { websocketUrl: 'mock://test', domain: 'wrx.mock' }

const open: MockHost[] = []

afterEach(async () => {
  for (const host of open.splice(0)) await host.close()
})

interface Tab {
  readonly host: MockHost
  kill(): void
}

async function tab(
  browser: FakeBrowser,
  url = 'http://localhost/app/',
  options: MockHostOptions = {},
): Promise<Tab> {
  const t = browser.tab(url)
  const host = await connectMockTransport({
    environment: t.environment,
    saveDelayMs: 10,
    readyTimeoutMs: 2_000,
    log: () => undefined,
    ...options,
  })
  open.push(host)
  return { host, kill: t.kill }
}

function chat(text: string): string {
  return JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text } })
}

/** A player logged in and in the room, collecting messages; rejoins after a reconnection. */
async function player(host: MockHost, role: string) {
  const result = await host.connect({
    endpoint,
    credentials: { kind: 'password', username: role, password: `demo-${role}` },
    resource: `${role}-${host.tab}`,
  })
  if (!result.ok) throw new Error(`${role} cannot log in: ${result.error.condition}`)
  const session: Session = result.value
  const seen = new Map<string, string>()
  const record = (m: RoomMessage) => {
    seen.set(m.stanzaId, (JSON.parse(m.body) as { content: { text: string } }).content.text)
  }
  session.muc.onMessage(ROOM, record)
  const join = async () => {
    const joined = await session.muc.join(ROOM, role)
    if (!joined.ok) throw new Error(`${role} cannot join: ${joined.error.condition}`)
    const page = await session.mam.queryRoom(ROOM, { max: 100 })
    if (page.ok) page.value.messages.forEach(record)
  }
  let recoveries = 0
  session.onRecovered(() => {
    recoveries++
    seen.clear()
    void join()
  })
  await join()
  return {
    session,
    texts: () => [...seen.values()],
    recoveries: () => recoveries,
    send: async (text: string) => {
      const sent = await session.muc.send(ROOM, chat(text))
      if (!sent.ok) throw new Error(`${role} cannot send: ${sent.error.condition}`)
    },
  }
}

describe('connectMockTransport, leader tab (D17, ARC-7, R7)', () => {
  it('elects one leader and lets two tabs act as two players', async () => {
    const browser = new FakeBrowser()
    const one = await tab(browser)
    const two = await tab(browser)
    expect(one.host.hosting).toBe('leader')
    expect(one.host.isHosting()).toBe(true)
    expect(two.host.isHosting()).toBe(false)
    expect(one.host.kind).toBe('mock')

    const blue = await player(one.host, 'blue-co')
    const red = await player(two.host, 'red-co')
    await red.send('Red is ready.')
    await blue.send('Blue too.')
    await vi.waitFor(() => {
      expect(blue.texts()).toContain('Red is ready.')
      expect(red.texts()).toContain('Blue too.')
    })
  })

  it('keeps messages flowing when the leader tab closes mid-conversation', async () => {
    const browser = new FakeBrowser()
    const leader = await tab(browser)
    const two = await tab(browser)
    const three = await tab(browser)
    const umpire = await player(leader.host, 'umpire-1')
    const blue = await player(two.host, 'blue-co')
    const red = await player(three.host, 'red-co')
    await blue.send('Before the leader closes.')
    await vi.waitFor(() => {
      expect(red.texts()).toContain('Before the leader closes.')
      expect(umpire.texts()).toContain('Before the leader closes.')
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    leader.kill()
    await vi.waitFor(() => {
      expect(two.host.isHosting() || three.host.isHosting()).toBe(true)
      expect(blue.recoveries()).toBe(1)
      expect(red.recoveries()).toBe(1)
    })
    await vi.waitFor(async () => {
      await red.send('After the leader closed.')
    })
    await vi.waitFor(() => {
      expect(blue.texts()).toContain('After the leader closed.')
      // The new leader loaded what the old one had saved.
      expect(blue.texts()).toContain('Before the leader closes.')
    })
  })

  it('applies reset to seed, export and import to every tab', async () => {
    const browser = new FakeBrowser()
    const one = await tab(browser)
    const two = await tab(browser)
    const blue = await player(one.host, 'blue-co')
    const red = await player(two.host, 'red-co')
    const seedTexts = red.texts()
    await blue.send('Gone after the reset.')
    await vi.waitFor(() => {
      expect(red.texts()).toContain('Gone after the reset.')
    })
    const exported = await two.host.exportDatabase()
    expect(exported.ok).toBe(true)

    expect(await two.host.resetToSeed()).toEqual({ ok: true, value: undefined })
    await vi.waitFor(() => {
      expect(blue.recoveries()).toBe(1)
      expect(red.recoveries()).toBe(1)
      expect(blue.texts()).toEqual(seedTexts)
      expect(red.texts()).toEqual(seedTexts)
    })
    for (const host of [one.host, two.host]) {
      expect(host.notices().map((n) => n.kind)).toEqual(['reset'])
    }

    expect(await one.host.importDatabase(exported.ok ? exported.value : '')).toEqual({
      ok: true,
      value: undefined,
    })
    await vi.waitFor(() => {
      expect(red.texts()).toContain('Gone after the reset.')
    })
    const bad = await two.host.importDatabase('{"not": "a database"}')
    expect(bad.ok).toBe(false)
  })

  it('turns an export after a rehearsal into the seed of another deployment (PLY-34)', async () => {
    const rehearsal = await tab(new FakeBrowser())
    const blue = await player(rehearsal.host, 'blue-co')
    await blue.send('Said in the rehearsal.')
    const exported = await rehearsal.host.exportDatabase()
    if (!exported.ok) throw new Error(exported.error)
    const seed = migrateMockState(exported.value)
    if (!seed.ok) throw new Error(seed.error)

    // A new browser, seeded from the export: the rehearsal's history is there, and a reset
    // returns to it rather than to the demo.
    const demo = await tab(new FakeBrowser(), 'http://localhost/demo/', { seed: seed.value.state })
    const red = await player(demo.host, 'red-co')
    expect(red.texts()).toContain('Said in the rehearsal.')
    await red.send('Said in the demo.')
    expect(await demo.host.resetToSeed()).toEqual({ ok: true, value: undefined })
    await vi.waitFor(() => {
      expect(red.recoveries()).toBe(1)
      expect(red.texts()).toContain('Said in the rehearsal.')
      expect(red.texts()).not.toContain('Said in the demo.')
    })
  })

  it('keeps the state when every tab closes and a new one opens', async () => {
    const browser = new FakeBrowser()
    const one = await tab(browser)
    const blue = await player(one.host, 'blue-co')
    await blue.send('Kept across reloads.')
    await one.host.close()
    const again = await tab(browser)
    const red = await player(again.host, 'red-co')
    expect(red.texts()).toContain('Kept across reloads.')
  })

  it('keeps deployments under different base paths apart (DOC-10)', async () => {
    const browser = new FakeBrowser()
    const a = await tab(browser, 'http://localhost/war-rooms-x2/pr/1/app/')
    const b = await tab(browser, 'http://localhost/war-rooms-x2/pr/2/app/index.html')
    expect(a.host.isHosting()).toBe(true)
    expect(b.host.isHosting()).toBe(true)
    const blueA = await player(a.host, 'blue-co')
    const redB = await player(b.host, 'red-co')
    await blueA.send('Only in PR 1.')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(redB.texts()).not.toContain('Only in PR 1.')
    expect([...browser.stores.keys()].sort()).toEqual([
      hostNames(mockNamespace('/war-rooms-x2/pr/1/app/')).database,
      hostNames(mockNamespace('/war-rooms-x2/pr/2/app/')).database,
    ])
  })

  it('resets a corrupted database to the seed with a notice, and still loads (DOC-17)', async () => {
    const browser = new FakeBrowser()
    const db = hostNames(mockNamespace('/app/')).database
    await browser.store(db).save('{"format":"wrx1-mock-state","version":1,"accounts":')
    const notices: string[] = []
    const one = await tab(browser, undefined, { onNotice: (n) => notices.push(n.kind) })
    expect(notices).toEqual(['reset-unreadable'])
    const two = await tab(browser)
    // A tab that joins later hears of it too.
    expect(two.host.notices().map((n) => n.kind)).toEqual(['reset-unreadable'])
    const blue = await player(one.host, 'blue-co')
    expect(blue.texts().length).toBeGreaterThan(0)
  })

  it('drops a closed follower tab’s sessions, so others see it leave', async () => {
    const browser = new FakeBrowser()
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

  it('logs and drops invalid messages from other tabs', async () => {
    const browser = new FakeBrowser()
    const logs: LogEntry[] = []
    const one = await tab(browser, undefined, { log: (e) => logs.push(e) })
    const rogue = new BroadcastChannel(browser.channelName(one.host.names.channel))
    rogue.postMessage({ k: 'up', to: one.host.tab, m: { k: 'c2s', tab: 'x', conn: 1 } })
    rogue.postMessage('hello')
    await vi.waitFor(() => {
      expect(logs.filter((l) => l.message.includes('invalid message'))).toHaveLength(2)
    })
    rogue.close()
    const blue = await player(one.host, 'blue-co')
    expect(blue.texts().length).toBeGreaterThan(0)
  })

  it('runs on its own, with a notice, without Web Locks or BroadcastChannel', async () => {
    const browser = new FakeBrowser()
    const t = browser.tab()
    const host = await connectMockTransport({
      environment: { ...t.environment, locks: undefined, openChannel: undefined },
      log: () => undefined,
    })
    open.push(host)
    expect(host.hosting).toBe('local')
    expect(host.notices().map((n) => n.kind)).toEqual(['not-shared'])
    const blue = await player(host, 'blue-co')
    expect(blue.texts().length).toBeGreaterThan(0)
  })

  it('falls back to a leader tab when the SharedWorker fails', async () => {
    const browser = new FakeBrowser()
    const t = browser.tab()
    const host = await connectMockTransport({
      environment: {
        ...t.environment,
        startWorker: () => {
          throw new Error('SharedWorker blocked')
        },
      },
      log: () => undefined,
    })
    open.push(host)
    expect(host.hosting).toBe('leader')
    await player(host, 'blue-co')
  })
})
