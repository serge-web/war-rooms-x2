// Unit tests for the server's internals where the contract suite does not reach: stanza-ids,
// archive edges, join history, state export and import, reset, and the behaviour marked "not
// covered by contract" in muc.ts and pubsub.ts.
import type {
  RoomConfig,
  ConnectionStatus,
  ItemsEvent,
  OccupantEvent,
  Recovery,
  RoomMessage,
  Session,
} from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { MockServer } from './server.ts'
import { MockSession } from './session.ts'
import { parseMockState } from './state.ts'
import { ManualTime } from './time.ts'
import { MockTransport } from './transport.ts'

const domain = 'test.mock'
const ROOM = `ops@conference.${domain}`
const GAME_ROOM: RoomConfig = {
  name: 'Ops',
  membersOnly: true,
  moderated: true,
  persistent: true,
  public: false,
  whois: 'anyone',
  archive: true,
}
const NODE = {
  accessModel: 'whitelist' as const,
  publishModel: 'publishers' as const,
  maxItems: 5,
  notifyRetract: true,
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

function setup(clock?: ManualTime) {
  const server = new MockServer({
    domain,
    adminPassword: 'pw',
    ...(clock === undefined ? {} : { clock }),
  })
  const transport = new MockTransport(server, { reconnect: { initialMs: 5 } })
  const endpoint = { websocketUrl: 'mock://', domain }
  const login = async (username: string, password = 'pw', resource?: string): Promise<Session> =>
    unwrap(
      await transport.connect({
        endpoint,
        credentials: { kind: 'password', username, password },
        ...(resource === undefined ? {} : { resource }),
      }),
    )
  const users = async (admin: Session, ...names: string[]) => {
    for (const name of names) unwrap(await admin.admin.addUser(`${name}@${domain}`, 'pw'))
  }
  return { server, transport, login, users }
}

/** An admin, a room with members `a` and `b`, both logged in and joined. */
async function room(config = GAME_ROOM) {
  const env = setup()
  const admin = await env.login('admin')
  await env.users(admin, 'a', 'b')
  unwrap(await admin.muc.createRoom(ROOM, config))
  unwrap(
    await admin.muc.setAffiliations(ROOM, [
      { jid: `a@${domain}`, affiliation: 'member' },
      { jid: `b@${domain}`, affiliation: 'member' },
    ]),
  )
  const a = await env.login('a')
  const b = await env.login('b')
  unwrap(await a.muc.join(ROOM, 'a'))
  unwrap(await b.muc.join(ROOM, 'b'))
  return { ...env, admin, a, b }
}

function collect<E>(subscribe: (l: (e: E) => void) => unknown): E[] {
  const events: E[] = []
  subscribe((e) => events.push(e))
  return events
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('stanza-ids (XEP-0359, spike S5)', () => {
  it('are the server time in microseconds, strictly increasing within one millisecond', async () => {
    const time = new ManualTime(Date.UTC(2026, 9, 24, 9, 0, 0))
    const env = setup(time)
    const admin = await env.login('admin')
    unwrap(await admin.muc.createRoom(ROOM, GAME_ROOM))
    unwrap(await admin.muc.join(ROOM, 'admin'))
    const ids = []
    for (let i = 0; i < 3; i++) ids.push(unwrap(await admin.muc.send(ROOM, `m${i}`)).stanzaId)
    expect(ids).toEqual(['1792832400000000', '1792832400000001', '1792832400000002'])
    const page = unwrap(await admin.mam.queryRoom(ROOM, { max: 10 }))
    expect(page.messages.map((m) => m.timestamp)).toEqual(Array(3).fill('2026-10-24T09:00:00.000Z'))
    time.set(Date.UTC(2026, 9, 24, 9, 0, 1) + 0.5)
    expect(unwrap(await admin.muc.send(ROOM, 'later')).stanzaId).toBe('1792832401000500')
  })
})

describe('MAM edges (XEP-0313, XEP-0059)', () => {
  it('an empty archive is one complete page with no edges', async () => {
    const { admin } = await room()
    expect(unwrap(await admin.mam.queryRoom(ROOM, { max: 5 }))).toEqual({
      messages: [],
      first: undefined,
      last: undefined,
      complete: true,
    })
  })

  it('a page that reaches the oldest message is complete, even when exactly full', async () => {
    const { a } = await room()
    for (let i = 0; i < 4; i++) unwrap(await a.muc.send(ROOM, `m${i}`))
    const latest = unwrap(await a.mam.queryRoom(ROOM, { max: 2 }))
    expect(latest.messages.map((m) => m.body)).toEqual(['m2', 'm3'])
    expect(latest.complete).toBe(false)
    const older = unwrap(await a.mam.queryRoom(ROOM, { max: 2, before: latest.first ?? '' }))
    expect(older.messages.map((m) => m.body)).toEqual(['m0', 'm1'])
    expect(older.complete).toBe(true)
  })

  it('caps a page at 250 messages', async () => {
    const { a } = await room()
    for (let i = 0; i < 260; i++) unwrap(await a.muc.send(ROOM, `m${i}`))
    const page = unwrap(await a.mam.queryRoom(ROOM, { max: 1000 }))
    expect(page.messages).toHaveLength(250)
    expect(page.complete).toBe(false)
  })

  it('a room with archiving off delivers live but archives nothing', async () => {
    const { a, b } = await room({ ...GAME_ROOM, archive: false })
    const seen = collect<RoomMessage>((l) => b.muc.onMessage(ROOM, l))
    unwrap(await a.muc.send(ROOM, 'live only'))
    await settle()
    expect(seen.map((m) => m.body)).toEqual(['live only'])
    expect(unwrap(await a.mam.queryRoom(ROOM, { max: 5 })).messages).toEqual([])
  })
})

describe('join history (XEP-0045 §7.2.15)', () => {
  it('replays the last 20 messages, which do not survive export and import', async () => {
    const { a, server, login } = await room()
    for (let i = 0; i < 25; i++) unwrap(await a.muc.send(ROOM, `m${i}`))
    const c = await login('b', 'pw', 'second')
    const seen = collect<RoomMessage>((l) => c.muc.onMessage(ROOM, l))
    unwrap(await c.muc.join(ROOM, 'b'))
    await settle()
    expect(seen.map((m) => m.body)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i + 5}`))

    server.importState(server.exportState())
    const d = await login('b', 'pw', 'third')
    const after = collect<RoomMessage>((l) => d.muc.onMessage(ROOM, l))
    unwrap(await d.muc.join(ROOM, 'b'))
    await settle()
    expect(after).toEqual([])
    expect(unwrap(await d.mam.queryRoom(ROOM, { max: 50 })).messages).toHaveLength(25)
  })
})

describe('state export, import and reset (PLY-21, PLY-34)', () => {
  it('round-trips through JSON and validates what it reads', async () => {
    const { server, admin, a } = await room()
    unwrap(await a.muc.send(ROOM, 'kept'))
    unwrap(await admin.pubsub.createNode('n', NODE))
    unwrap(await admin.pubsub.publish('n', 'current', '{"v":1}'))
    unwrap(await a.admin.setPrivate('k', 'secret'))
    const exported = server.exportState()
    const parsed = parseMockState(JSON.stringify(exported))
    expect(parsed).toEqual({ ok: true, value: exported })
    const copy = new MockServer({ seed: unwrap(parsed) })
    expect(copy.exportState()).toEqual(exported)

    expect(parseMockState('{').ok).toBe(false)
    expect(parseMockState({ ...exported, version: 2 }).ok).toBe(false)
    expect(parseMockState({ ...exported, lastStanzaId: 'x' }).ok).toBe(false)
  })

  it('keeps stanza-ids increasing after an import', async () => {
    const { server, a } = await room()
    const first = unwrap(await a.muc.send(ROOM, 'one')).stanzaId
    const state = server.exportState()
    const time = new ManualTime(0)
    const copy = new MockServer({ seed: state, clock: time })
    const transport = new MockTransport(copy)
    const s = unwrap(
      await transport.connect({
        endpoint: { websocketUrl: '', domain },
        credentials: { kind: 'password', username: 'a', password: 'pw' },
      }),
    )
    unwrap(await s.muc.join(ROOM, 'a'))
    const next = unwrap(await s.muc.send(ROOM, 'two')).stanzaId
    expect(BigInt(next)).toBe(BigInt(first) + 1n)
  })

  it('reset drops every session, which reconnects to the seed as a new session', async () => {
    const { server, a } = await room()
    const statuses = collect<ConnectionStatus>((l) => a.onStatus(l))
    const recoveries = collect<Recovery>((l) => a.onRecovered(l))
    server.setSeed(server.exportState())
    unwrap(await a.muc.send(ROOM, 'after the seed'))
    server.reset()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(recoveries).toEqual(['reconnected'])
    expect(statuses[0]).toEqual({ state: 'reconnecting', attempt: 1 })
    expect(a.status()).toEqual({ state: 'online' })
    expect(a.muc.occupants(ROOM)).toEqual([])
    const page = unwrap(await a.mam.queryRoom(ROOM, { max: 5 }))
    expect(page.messages.map((m) => m.body)).not.toContain('after the seed')
  })
})

describe('MUC behaviour not covered by contract', () => {
  it('a semi-anonymous room shows real JIDs to moderators only', async () => {
    const { a, admin } = await room({ ...GAME_ROOM, whois: 'moderators' })
    const toA = collect<RoomMessage>((l) => a.muc.onMessage(ROOM, l))
    unwrap(await admin.muc.join(ROOM, 'admin'))
    expect(admin.muc.occupants(ROOM).find((o) => o.nick === 'a')?.jid).toBe(`a@${domain}`)
    expect(a.muc.occupants(ROOM).find((o) => o.nick === 'b')?.jid).toBeUndefined()
    unwrap(await admin.muc.send(ROOM, 'hello'))
    await settle()
    expect(toA.find((m) => m.body === 'hello')?.from).toBeUndefined()
  })

  it('a kick (role none) ejects every session with 307 and is not stored', async () => {
    const { a, admin } = await room()
    const events = collect<OccupantEvent>((l) => a.muc.onOccupant(ROOM, l))
    unwrap(await admin.muc.join(ROOM, 'admin'))
    unwrap(await admin.muc.setRole(ROOM, 'a', 'none'))
    await settle()
    const self = events.find((e) => e.self && !e.available)
    expect(self?.statusCodes).toEqual([110, 307])
    expect(a.muc.occupants(ROOM)).toEqual([])
    expect(unwrap(await a.muc.join(ROOM, 'a')).role).toBe('participant')
  })

  it('a nick taken by another account is conflict; a nick change is refused', async () => {
    const { a, b } = await room()
    const err = await b.muc.join(ROOM, 'a')
    expect(err.ok).toBe(false)
    expect(err.ok ? undefined : err.error.condition).toBe('not-allowed')
    unwrap(await a.muc.leave(ROOM))
    unwrap(await b.muc.leave(ROOM))
    unwrap(await a.muc.join(ROOM, 'x'))
    const taken = await b.muc.join(ROOM, 'x')
    expect(taken.ok ? undefined : taken.error.condition).toBe('conflict')
  })

  it('a ban ejects a present occupant with 301', async () => {
    const { a, admin } = await room()
    const events = collect<OccupantEvent>((l) => a.muc.onOccupant(ROOM, l))
    unwrap(await admin.muc.setAffiliations(ROOM, [{ jid: `a@${domain}`, affiliation: 'outcast' }]))
    await settle()
    expect(events.find((e) => e.self && !e.available)).toMatchObject({
      affiliation: 'outcast',
      role: 'none',
      statusCodes: [110, 301],
    })
  })

  it('destroying a room tells its occupants', async () => {
    const { a, admin } = await room()
    const events = collect<OccupantEvent>((l) => a.muc.onOccupant(ROOM, l))
    unwrap(await admin.muc.destroyRoom(ROOM))
    await settle()
    expect(events.find((e) => e.self && !e.available)).toBeDefined()
    expect(a.muc.occupants(ROOM)).toEqual([])
  })

  it('a second stream on the same full JID replaces the first (ejabberd acceptnew)', async () => {
    const env = setup()
    const admin = await env.login('admin')
    await env.users(admin, 'a')
    const first = await env.login('a', 'pw', 'tab')
    const ended = collect<ConnectionStatus>((l) => first.onStatus(l))
    await env.login('a', 'pw', 'tab')
    await settle()
    expect(ended.at(-1)).toMatchObject({ state: 'ended', reason: 'account-removed' })
    expect(env.server.sessions().filter((j) => j === `a@${domain}/tab`)).toHaveLength(1)
  })
})

describe('PubSub behaviour not covered by contract', () => {
  it('an auto-created node has ejabberd defaults: open, 1000 items, no publisher, silent delete', async () => {
    const env = setup()
    const admin = await env.login('admin')
    unwrap(await admin.pubsub.publish('auto', 'x', '{"a":1}'))
    expect(unwrap(await admin.pubsub.getNodeConfig('auto'))).toEqual({
      accessModel: 'open',
      publishModel: 'publishers',
      maxItems: 1000,
      notifyRetract: true,
    })
    expect(unwrap(await admin.pubsub.getItems('auto'))).toEqual([
      { id: 'x', payload: '{"a":1}', publisher: undefined },
    ])
    unwrap(await admin.pubsub.subscribe('auto'))
    const events = collect<ItemsEvent>((l) => admin.pubsub.onItems('auto', l))
    unwrap(await admin.pubsub.deleteNode('auto'))
    await settle()
    expect(events).toEqual([])
  })

  it('R-A: a subscribed reader whose affiliation is revoked keeps receiving events', async () => {
    const env = setup()
    const admin = await env.login('admin')
    await env.users(admin, 'r')
    unwrap(await admin.pubsub.createNode('n', NODE))
    unwrap(await admin.pubsub.setAffiliations('n', [{ jid: `r@${domain}`, affiliation: 'member' }]))
    const reader = await env.login('r')
    unwrap(await reader.pubsub.subscribe('n'))
    unwrap(await admin.pubsub.setAffiliations('n', [{ jid: `r@${domain}`, affiliation: 'none' }]))
    const events = collect<ItemsEvent>((l) => reader.pubsub.onItems('n', l))
    unwrap(await admin.pubsub.publish('n', 'leak', '{}'))
    await settle()
    expect(events.map((e) => e.items.map((i) => i.id))).toEqual([['leak']])
  })

  it('keeps max items, newest first, and an overwrite moves the item to newest', async () => {
    const env = setup()
    const admin = await env.login('admin')
    unwrap(await admin.pubsub.createNode('n', { ...NODE, maxItems: 2 }))
    for (const id of ['a', 'b', 'c']) unwrap(await admin.pubsub.publish('n', id, '{}'))
    expect(unwrap(await admin.pubsub.getItems('n')).map((i) => i.id)).toEqual(['c', 'b'])
    unwrap(await admin.pubsub.publish('n', 'b', '{"again":true}'))
    expect(unwrap(await admin.pubsub.getItems('n', { max: 1 })).map((i) => i.id)).toEqual(['b'])
  })

  it('unsubscribing without a subscription is unexpected-request', async () => {
    const env = setup()
    const admin = await env.login('admin')
    unwrap(await admin.pubsub.createNode('n', NODE))
    const r = await admin.pubsub.unsubscribe('n')
    expect(r.ok ? undefined : r.error.condition).toBe('unexpected-request')
  })

  it('deleting an account removes its node affiliations and private storage', async () => {
    const env = setup()
    const admin = await env.login('admin')
    await env.users(admin, 'r')
    unwrap(await admin.pubsub.createNode('n', NODE))
    unwrap(await admin.pubsub.setAffiliations('n', [{ jid: `r@${domain}`, affiliation: 'member' }]))
    const r = await env.login('r')
    unwrap(await r.admin.setPrivate('k', 'v'))
    await r.disconnect()
    unwrap(await admin.admin.deleteUser(`r@${domain}`))
    unwrap(await admin.admin.addUser(`r@${domain}`, 'pw'))
    expect(unwrap(await admin.pubsub.getAffiliations('n')).map((e) => e.jid)).toEqual([
      `admin@${domain}`,
    ])
    const again = await env.login('r')
    expect(unwrap(await again.admin.getPrivate('k'))).toBeUndefined()
  })
})

describe('the transport side', () => {
  it('is kind mock, and refuses a bad private key before sending', async () => {
    const env = setup()
    expect(env.transport.kind).toBe('mock')
    const admin = await env.login('admin')
    expect(admin).toBeInstanceOf(MockSession)
    const r = await admin.admin.setPrivate('Bad Key', 'x')
    expect(r.ok ? undefined : r.error.condition).toBe('bad-request')
  })
})
