// The store's turn state and map-room world state (D7, D25, PLY-53, PLY-58, PLY-59).
import { LIMITS, nodeName } from '@wrx/schemas'
import { sampleWorldState } from '@wrx/schemas/fixtures'
import type { WorldState } from '@wrx/schemas'
import type { RoomMessage } from '@wrx/transport'
import { err } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import {
  DOMAIN,
  MUC,
  chatBody,
  flush,
  harness,
  message,
  room,
  sampleDocuments,
  tid,
} from './fixtures.ts'
import type { HarnessOptions } from './fixtures.ts'

const MAP = `${tid('map')}@${MUC}`

function worldBody(state: WorldState): string {
  return JSON.stringify({ type: 'world-state', schemaVersion: 1, content: state })
}

function stateAt(turn: number): WorldState {
  return { ...sampleWorldState(), turn }
}

/** A world-state message in the map room, by default from the admin's real JID. */
function world(state: WorldState, extra: Partial<RoomMessage> = {}): RoomMessage {
  return message('map', {
    nick: 'admin',
    from: `admin@${DOMAIN}/admin-1`,
    body: worldBody(state),
    ...extra,
  })
}

/** The sample documents with the map room (§3 rule 18: every force, read only). */
function mapDocuments(): Map<string, unknown[]> {
  const docs = sampleDocuments()
  const map = room(
    'map',
    [
      { kind: 'force', id: 'blue', access: 'read' },
      { kind: 'force', id: 'red', access: 'read' },
      { kind: 'force', id: 'white', access: 'read' },
    ],
    { roomType: 'map', order: 3 },
  )
  docs.set(nodeName.room(map.id), [map])
  return docs
}

async function mapHarness(archive: RoomMessage[], options: HarnessOptions = {}) {
  const h = harness({ docs: mapDocuments(), ...options })
  h.archive.set(MAP, archive)
  await h.store.ready()
  return h
}

const queries = (h: ReturnType<typeof harness>) =>
  h.session.calls.filter((c) => c.op === 'queryRoom' && c.args[0] === MAP)

describe('turn state (D7, PLY-55)', () => {
  it('reads game-state live, and has none before a first publish', async () => {
    const h = harness()
    await h.store.ready()
    expect(h.store.gameState()).toMatchObject({ data: undefined })
    h.publish('game-state', { schemaVersion: 1, turn: 1, phase: 'planning' })
    expect(h.store.gameState().data).toEqual({ schemaVersion: 1, turn: 1, phase: 'planning' })
    const before = h.store.gameState()
    h.publish('game-state', { schemaVersion: 1, turn: 1, phase: 'adjudication' })
    expect(h.store.gameState().data?.phase).toBe('adjudication')
    expect(h.store.gameState()).not.toBe(before)
    expect(h.store.gameState()).toBe(h.store.gameState())
  })

  it('reads it at login, and ignores an invalid one (NFR-5)', async () => {
    const docs = sampleDocuments()
    docs.set('game-state', [{ schemaVersion: 1, turn: 4, phase: 'adjudication' }])
    const h = harness({ docs })
    await h.store.ready()
    expect(h.store.gameState().data).toMatchObject({ turn: 4, phase: 'adjudication' })
    h.publish('game-state', { schemaVersion: 1, turn: 0, phase: 'planning' })
    expect(h.warnings).toContain('Ignoring an invalid item')
  })

  it('is not read by an anonymous session (D20)', async () => {
    const docs = sampleDocuments()
    docs.set('game-state', [{ schemaVersion: 1, turn: 1, phase: 'planning' }])
    const h = harness({ docs, fake: { anonymous: true, jid: 'anon-1@wrx.test/x' } })
    await h.store.ready()
    expect(h.session.calls.some((c) => c.op === 'getItems' && c.args[0] === 'game-state')).toBe(
      false,
    )
  })
})

describe('world state (D25, PLY-58, PLY-59)', () => {
  it('pages back in small pages to the newest valid world state from the admin', async () => {
    const noise = Array.from({ length: 12 }, () => message('map', { body: chatBody('chatter') }))
    const forged = world(stateAt(9), { nick: 'red-co', from: `red-co@${DOMAIN}/r` })
    const h = await mapHarness([world(stateAt(1)), world(stateAt(2)), forged, ...noise])
    const release = h.store.acquireWorldState(tid('map'))
    await flush(30)
    const snapshot = h.store.worldState(tid('map'))
    expect(snapshot.status).toBe('ready')
    expect(snapshot.data?.state?.turn).toBe(2)
    expect(snapshot.data?.searching).toBe(false)
    expect(snapshot.data?.none).toBe(false)
    expect(snapshot.data?.ignored).toBe(13)
    // 15 messages in pages of 5: the newest page, then two more.
    expect(queries(h).map((c) => (c.args[1] as { max: number }).max)).toEqual([5, 5, 5])
    expect(h.warnings).toContain('Ignoring a map-room message not from the admin')
    expect(
      h.warnings.filter((w) => w === 'Ignoring a map-room message not from the admin'),
    ).toHaveLength(13)
    release()
  })

  it('takes later world states from the admin live, and ignores anyone else’s', async () => {
    const h = await mapHarness([world(stateAt(1))])
    const release = h.store.acquireWorldState(tid('map'))
    await flush(20)
    expect(h.store.worldState(tid('map')).data?.state?.turn).toBe(1)
    h.session.emitMessage(world(stateAt(3), { nick: 'white-1', from: `white-1@${DOMAIN}/w` }))
    expect(h.store.worldState(tid('map')).data?.state?.turn).toBe(1)
    // An `admin` on another domain is not this server's admin.
    h.session.emitMessage(world(stateAt(4), { from: 'admin@elsewhere.test/x' }))
    expect(h.store.worldState(tid('map')).data?.state?.turn).toBe(1)
    // No real JID at all.
    h.session.emitMessage(world(stateAt(5), { from: undefined }))
    expect(h.store.worldState(tid('map')).data?.state?.turn).toBe(1)
    const later = world(stateAt(2))
    h.session.emitMessage(later)
    expect(h.store.worldState(tid('map')).data).toMatchObject({
      state: { turn: 2 },
      stanzaId: later.stanzaId,
      timestamp: later.timestamp,
    })
    release()
  })

  it('ignores an invalid world state from the admin', async () => {
    const bad = {
      ...stateAt(7),
      assets: { [tid('elsewhere')]: Object.values(stateAt(7).assets)[0] },
    }
    const h = await mapHarness([
      world(stateAt(1)),
      message('map', {
        nick: 'admin',
        from: `admin@${DOMAIN}/a`,
        body: worldBody(bad as WorldState),
      }),
    ])
    const release = h.store.acquireWorldState(tid('map'))
    await flush(20)
    expect(h.store.worldState(tid('map')).data?.state?.turn).toBe(1)
    release()
  })

  it('says there is none when the archive holds no valid one', async () => {
    const h = await mapHarness([message('map', { body: chatBody('hello') })])
    const release = h.store.acquireWorldState(tid('map'))
    expect(h.store.worldState(tid('map')).status).toBe('loading')
    await flush(20)
    expect(h.store.worldState(tid('map'))).toMatchObject({
      status: 'ready',
      data: { state: undefined, none: true, searching: false, ignored: 1 },
    })
    release()
  })

  it('stops at the page limit, with a warning, as unreached rather than none, and looks further on request (WP 5.7 review)', async () => {
    // A modified client's posts after the admin's state: the newest 40 messages are noise.
    const noise = Array.from({ length: 40 }, () => message('map', { body: chatBody('x') }))
    const h = await mapHarness([world(stateAt(1)), ...noise], { worldStatePageLimit: 3 })
    const release = h.store.acquireWorldState(tid('map'))
    await flush(30)
    expect(h.store.worldState(tid('map')).data).toMatchObject({
      state: undefined,
      none: false,
      unreached: true,
    })
    // The newest page, then three older ones.
    expect(queries(h)).toHaveLength(4)
    expect(h.warnings).toContain('No world state within the page limit')
    // Looking further goes on from where it stopped, until the admin's state is found.
    await h.store.searchWorldStateFurther(tid('map'))
    await flush(30)
    expect(queries(h)).toHaveLength(7)
    expect(h.store.worldState(tid('map')).data).toMatchObject({ unreached: true })
    await h.store.searchWorldStateFurther(tid('map'))
    await flush(30)
    expect(h.store.worldState(tid('map')).data).toMatchObject({
      state: stateAt(1),
      none: false,
      unreached: false,
    })
    release()
  })

  it('keeps only the newest accepted world state in memory (R26)', async () => {
    const forged = world(stateAt(9), { nick: 'red-co', from: `red-co@${DOMAIN}/r` })
    const h = await mapHarness([world(stateAt(1)), forged, world(stateAt(2))])
    const release = h.store.acquireWorldState(tid('map'))
    await flush(20)
    const held = () => h.store.roomView(tid('map')).data?.messages ?? []
    expect(held()).toHaveLength(1)
    expect(h.store.worldState(tid('map')).data).toMatchObject({ state: { turn: 2 }, ignored: 1 })

    // A modified client's post, then a newer state: each is dropped once it is not the newest.
    h.session.emitMessage(world(stateAt(8), { nick: 'red-co', from: `red-co@${DOMAIN}/r` }))
    expect(held()).toHaveLength(1)
    expect(h.store.worldState(tid('map')).data).toMatchObject({ state: { turn: 2 }, ignored: 2 })
    const third = world(stateAt(3))
    h.session.emitMessage(third)
    expect(held().map((m) => m.id)).toEqual([third.stanzaId])
    expect(h.store.worldState(tid('map')).data).toMatchObject({ state: { turn: 3 }, ignored: 2 })
    // A dropped message delivered again (a MAM page, a reconnection) is not taken back.
    h.session.emitMessage(forged)
    expect(held()).toHaveLength(1)
    release()
  })

  it('watches a map room for its world state from its first join, whoever joins it (WP 5.9)', async () => {
    const h = await mapHarness(
      [
        world(stateAt(1)),
        ...Array.from({ length: 6 }, () => message('map', { body: chatBody('x') })),
      ],
      { pageSize: 50, worldStatePageSize: 3 },
    )
    // Joined for another reason (the online list joins every room): small pages, and the search.
    const plain = h.store.acquireRoom(tid('map'))
    await flush(20)
    expect(queries(h).length).toBeGreaterThan(1)
    expect(h.store.worldState(tid('map')).data?.state?.turn).toBe(1)
    const watched = h.store.acquireWorldState(tid('map'))
    await flush(20)
    expect(h.store.worldState(tid('map')).data?.state?.turn).toBe(1)
    watched()
    plain()
  })
})

describe('sending the world state (D25, PLY-53)', () => {
  async function joinedAsAdmin(roleId = 'admin') {
    const h = await mapHarness([], { roleId })
    const release = h.store.acquireWorldState(tid('map'))
    await flush(20)
    return { h, release }
  }

  const sends = (h: ReturnType<typeof harness>) => h.session.calls.filter((c) => c.op === 'send')

  it('sends the full state as the admin, with the map-room cap', async () => {
    const { h, release } = await joinedAsAdmin()
    const sent = await h.store.sendWorldState(tid('map'), sampleWorldState())
    expect(sent.ok).toBe(true)
    const [call] = sends(h)
    expect(call?.args[0]).toBe(MAP)
    expect(JSON.parse(String(call?.args[1]))).toEqual({
      type: 'world-state',
      schemaVersion: 1,
      content: sampleWorldState(),
    })
    expect(call?.args[2]).toEqual({ maxBytes: LIMITS.worldStateStanzaBytes })
    release()
  })

  it('takes a state just under 500,000 bytes and refuses one over, before sending', async () => {
    const { h, release } = await joinedAsAdmin()
    const base = Object.values(sampleWorldState().assets)[0]
    if (base === undefined) throw new Error('fixture')
    const assets = (n: number) =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => {
          const id = `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
          return [id, { ...base, id, title: `Unit ${i}` }]
        }),
      )
    // About 270 bytes an asset: 1,700 fit, 2,000 do not.
    const fits = await h.store.sendWorldState(tid('map'), { turn: 1, assets: assets(1_700) })
    expect(fits.ok).toBe(true)
    expect(String(sends(h)[0]?.args[1]).length).toBeGreaterThan(LIMITS.messageStanzaBytes * 6)
    const over = await h.store.sendWorldState(tid('map'), { turn: 1, assets: assets(2_000) })
    expect(over.ok || over.error.code).toBe('too-large')
    expect(sends(h)).toHaveLength(1)
    release()
  })

  it('refuses anyone but the admin, an invalid state and a room that is not the map', async () => {
    const asRole = await joinedAsAdmin('white-1')
    const refused = await asRole.h.store.sendWorldState(tid('map'), sampleWorldState())
    expect(refused.ok || refused.error.code).toBe('not-permitted')
    asRole.release()

    const { h, release } = await joinedAsAdmin()
    const invalid = await h.store.sendWorldState(tid('map'), { turn: 0, assets: {} })
    expect(invalid.ok || invalid.error.code).toBe('invalid')
    const chat = h.store.acquireRoom(tid('blue-hq'))
    await flush(10)
    const wrong = await h.store.sendWorldState(tid('blue-hq'), sampleWorldState())
    expect(wrong.ok || wrong.error.code).toBe('invalid')
    expect(sends(h)).toHaveLength(0)
    chat()
    release()
  })

  it('keeps chat at 64 KiB, and refuses chat text in the map room', async () => {
    const { h, release } = await joinedAsAdmin()
    const text = await h.store.sendMessage(tid('map'), 'hello')
    expect(text.ok || text.error.code).toBe('invalid')
    expect(sends(h)).toHaveLength(0)
    release()
  })
})

describe('a phase change with the world state (ADM-45, WP 5.6)', () => {
  const at = (turn: number, phase: 'planning' | 'adjudication') =>
    ({ schemaVersion: 1, turn, phase }) as const

  async function adminAt(turn: number, phase: 'planning' | 'adjudication') {
    const docs = mapDocuments()
    docs.set('game-state', [at(turn, phase)])
    const h = harness({ docs, roleId: 'admin' })
    await h.store.ready()
    const release = h.store.acquireWorldState(tid('map'))
    await flush(20)
    return { h, release }
  }

  const writes = (h: ReturnType<typeof harness>) =>
    h.session.calls.filter((c) => c.op === 'send' || c.op === 'publish')

  it('sends the world state first, then moves the phase', async () => {
    const { h, release } = await adminAt(1, 'adjudication')
    const state = stateAt(2)
    const result = await h.store.advancePhase({
      from: at(1, 'adjudication'),
      worldState: { roomId: tid('map'), state },
    })
    expect(result.ok).toBe(true)
    const ops = writes(h)
    expect(ops.map((c) => c.op)).toEqual(['send', 'publish'])
    expect((JSON.parse(String(ops[0]?.args[1])) as { content: unknown }).content).toEqual(state)
    expect(JSON.parse(String(ops[1]?.args[2]))).toEqual(at(2, 'planning'))
    release()
  })

  it('says the world state went out when only the phase change then fails (L3, WP 5.9)', async () => {
    const { h, release } = await adminAt(1, 'adjudication')
    h.session.stub('pubsub', 'publish', () => Promise.resolve(err('forbidden')))
    const state = stateAt(2)
    const result = await h.store.advancePhase({
      from: at(1, 'adjudication'),
      worldState: { roomId: tid('map'), state },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-permitted')
    expect(result.error.message).toMatch(/the world state was published, but the phase did not/)
    expect(result.error.worldStateSent?.state).toEqual(state)
    expect(typeof result.error.worldStateSent?.stanzaId).toBe('string')
    expect(writes(h).map((c) => c.op)).toEqual(['send', 'publish'])
    // Without a world state, a failed change carries none.
    const plain = await h.store.advancePhase({ from: at(1, 'adjudication') })
    expect(plain.ok || plain.error.worldStateSent).toBeUndefined()
    release()
  })

  it('does not move the phase when the world state is refused, nor send it when stale', async () => {
    const { h, release } = await adminAt(1, 'planning')
    const refused = await h.store.advancePhase({
      from: at(1, 'planning'),
      worldState: { roomId: tid('map'), state: { turn: 0, assets: {} } },
    })
    expect(refused.ok || refused.error.code).toBe('invalid')
    expect(refused.ok || refused.error.message).toMatch(/the phase did not change/)
    const stale = await h.store.advancePhase({
      from: at(3, 'planning'),
      worldState: { roomId: tid('map'), state: sampleWorldState() },
    })
    expect(stale.ok || stale.error.code).toBe('stale')
    expect(writes(h)).toEqual([])
    release()
  })
})

describe('White Force proposals on receipt (PY-8, PD6; Phase 6 review)', () => {
  const UMPIRE = `${tid('umpires')}@${MUC}`
  const proposal = (summary: string) =>
    JSON.stringify({
      type: 'world-proposal',
      schemaVersion: 1,
      content: { state: stateAt(1), summary },
    })
  const from = (login: string) => ({ nick: login, from: `${login}@${DOMAIN}/x` })

  it('counts only from the admin or a White Force role that is not an observer', async () => {
    const docs = sampleDocuments()
    const umpires = room('umpires', [{ kind: 'force', id: 'white', access: 'write' }], {
      roomType: 'umpire',
      order: 4,
    })
    docs.set(nodeName.room(umpires.id), [umpires])
    const h = harness({ docs })
    h.archive.set(UMPIRE, [
      message('umpires', { ...from('white-1'), body: proposal('from White 1') }),
      // An observer is read-only through the vault only; a modified client, or a moment with
      // its voice not yet revoked, must not make its post count as a proposal.
      message('umpires', { ...from('white-observer'), body: proposal('from the observer') }),
      message('umpires', { ...from('red-co'), body: proposal('from Red') }),
      message('umpires', { nick: 'admin', from: `admin@${DOMAIN}/a`, body: proposal('admin') }),
    ])
    await h.store.ready()
    const release = h.store.acquireRoom(tid('umpires'))
    await flush(20)
    const entries = h.store.roomView(tid('umpires')).data?.messages ?? []
    expect(entries.map((e) => [e.sender.loginName ?? 'admin', e.kind])).toEqual([
      ['white-1', 'message'],
      ['white-observer', 'unreadable'],
      ['red-co', 'unreadable'],
      ['admin', 'message'],
    ])
    expect(
      h.warnings.filter((w) => w === 'Ignoring a proposal not from the White Force'),
    ).toHaveLength(2)
    release()
  })
})
