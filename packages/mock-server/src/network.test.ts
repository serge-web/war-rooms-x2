// The test controls (§11, limits of the guarantee): a controllable clock, injected latency,
// jitter and reordering, and disconnects, all on ManualTime so nothing waits for real.
import type { ConnectionStatus, Recovery, RoomMessage, Session } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { Channel, MockNetwork } from './network.ts'
import { MockServer } from './server.ts'
import { MockSession } from './session.ts'
import { ManualTime } from './time.ts'
import { MockTransport } from './transport.ts'

const domain = 'test.mock'
const ROOM = `ops@conference.${domain}`

describe('Channel', () => {
  it('keeps order under jitter, unless reordering is on', async () => {
    const time = new ManualTime()
    const delays = [30, 10, 20]
    let n = 0
    const network = new MockNetwork({ scheduler: time, random: () => (delays[n++ % 3] ?? 0) / 30 })
    network.set({ jitterMs: 30 })
    const got: number[] = []
    const channel = new Channel<number>(network, (i) => got.push(i))
    for (const i of [1, 2, 3]) channel.push(i)
    await time.advance(15)
    expect(got).toEqual([])
    await time.advance(20)
    expect(got).toEqual([1, 2, 3])

    network.set({ reorder: true })
    got.length = 0
    for (const i of [1, 2, 3]) channel.push(i)
    await time.advance(40)
    expect(got).toEqual([2, 3, 1])
  })

  it('holds frames while paused and drops them when closed', async () => {
    const time = new ManualTime()
    const network = new MockNetwork({ scheduler: time })
    const got: string[] = []
    const channel = new Channel<string>(network, (s) => got.push(s))
    channel.pause()
    channel.push('a')
    await time.advance(100)
    expect(got).toEqual([])
    channel.resume()
    expect(got).toEqual(['a'])
    channel.push('b')
    channel.close()
    await time.advance(100)
    expect(got).toEqual(['a'])
  })
})

function world(time: ManualTime) {
  const server = new MockServer({ domain, adminPassword: 'pw', clock: time })
  const network = new MockNetwork({ scheduler: time })
  const transport = new MockTransport(server, {
    network,
    reconnect: { initialMs: 100, maxMs: 400, maxAttempts: 3 },
  })
  const connect = (username: string) =>
    transport.connect({
      endpoint: { websocketUrl: '', domain },
      credentials: { kind: 'password', username, password: 'pw' },
    })
  const open = async (username: string): Promise<Session> => {
    const pending = connect(username)
    await time.advance(0)
    const result = await pending
    if (!result.ok) throw new Error(result.error.condition)
    return result.value
  }
  return { server, network, transport, connect, open }
}

/** Runs an operation to completion on manual time. */
async function run<T>(time: ManualTime, operation: Promise<T>, ms = 0): Promise<T> {
  await time.advance(ms)
  return operation
}

describe('injected latency (ManualTime)', () => {
  it('delays every frame each way, and the server stamps its own clock', async () => {
    const time = new ManualTime(Date.UTC(2026, 9, 24, 9, 0, 0))
    const { network, open } = world(time)
    const admin = await open('admin')
    await run(
      time,
      admin.muc.createRoom(ROOM, {
        name: 'Ops',
        membersOnly: true,
        moderated: true,
        persistent: true,
        public: false,
        whois: 'anyone',
        archive: true,
      }),
    )
    await run(time, admin.muc.join(ROOM, 'admin'))
    network.set({ latencyMs: 250 })
    const seen: RoomMessage[] = []
    admin.muc.onMessage(ROOM, (m) => seen.push(m))
    let done = false
    const sent = admin.muc.send(ROOM, 'slow').then((r) => {
      done = true
      return r
    })
    await time.advance(249)
    expect(done).toBe(false)
    await time.advance(1)
    // The server received it after one leg: its timestamp is 250 ms in.
    await time.advance(249)
    expect(done).toBe(false)
    await time.advance(1)
    expect((await sent).ok).toBe(true)
    expect(seen.map((m) => m.timestamp)).toEqual(['2026-10-24T09:00:00.250Z'])
  })
})

describe('injected disconnects', () => {
  it('a resumable drop holds traffic until the stream resumes', async () => {
    const time = new ManualTime()
    const { open } = world(time)
    const admin = await open('admin')
    const session = admin
    if (!(session instanceof MockSession)) throw new Error('not a mock session')
    const statuses: ConnectionStatus[] = []
    const recoveries: Recovery[] = []
    session.onStatus((s) => statuses.push(s))
    session.onRecovered((r) => recoveries.push(r))
    session.interrupt('resumable')
    let listed = false
    const listing = session.pubsub.listNodes().then((r) => {
      listed = r.ok
    })
    await time.advance(99)
    expect(listed).toBe(false)
    await time.advance(1)
    await listing
    expect(listed).toBe(true)
    expect(statuses).toEqual([{ state: 'reconnecting', attempt: 1 }, { state: 'online' }])
    expect(recoveries).toEqual(['resumed'])
  })

  it('while the network is offline, reconnection backs off and gives up as unreachable', async () => {
    const time = new ManualTime()
    const { network, open, connect, server } = world(time)
    const admin = await open('admin')
    if (!(admin instanceof MockSession)) throw new Error('not a mock session')
    const statuses: ConnectionStatus[] = []
    admin.onStatus((s) => statuses.push(s))
    network.set({ online: false })
    expect(await connect('admin')).toMatchObject({
      ok: false,
      error: { condition: 'disconnected' },
    })
    admin.interrupt('lost')
    await time.advance(100 + 200 + 400 + 1)
    expect(statuses).toEqual([
      { state: 'reconnecting', attempt: 1 },
      { state: 'reconnecting', attempt: 2 },
      { state: 'reconnecting', attempt: 3 },
      { state: 'ended', reason: 'unreachable', text: 'gave up after 3 attempts' },
    ])
    expect(server.sessions()).toEqual([])
  })

  it('a lost session comes back as a new one once the network is back', async () => {
    const time = new ManualTime()
    const { network, open, server } = world(time)
    const admin = await open('admin')
    if (!(admin instanceof MockSession)) throw new Error('not a mock session')
    const recoveries: Recovery[] = []
    admin.onRecovered((r) => recoveries.push(r))
    network.set({ online: false })
    admin.interrupt('lost')
    expect(server.sessions()).toEqual([])
    await time.advance(100)
    network.set({ online: true })
    await time.advance(200)
    expect(recoveries).toEqual(['reconnected'])
    expect(server.sessions()).toEqual([admin.jid])
  })
})
