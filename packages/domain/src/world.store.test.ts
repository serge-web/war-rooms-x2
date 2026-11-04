// The store's turn state and map-room world state (D7, D25, PLY-53, PLY-58, PLY-59).
import { LIMITS, nodeName } from '@wrx/schemas'
import { sampleWorldState } from '@wrx/schemas/fixtures'
import type { WorldState } from '@wrx/schemas'
import type { RoomMessage } from '@wrx/transport'
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
    expect(h.warnings).toContain('Ignoring a world state not from the admin')
    expect(h.warnings).toContain('Ignoring a map-room message that is not a world state')
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

  it('gives up after the page limit, with a warning', async () => {
    const noise = Array.from({ length: 40 }, () => message('map', { body: chatBody('x') }))
    const h = await mapHarness([world(stateAt(1)), ...noise], { worldStatePageLimit: 3 })
    const release = h.store.acquireWorldState(tid('map'))
    await flush(30)
    expect(h.store.worldState(tid('map')).data).toMatchObject({ state: undefined, none: true })
    // The newest page, then three older ones.
    expect(queries(h)).toHaveLength(4)
    expect(h.warnings).toContain('No world state within the page limit')
    release()
  })

  it('looks once the room, already joined for another reason, is watched for it', async () => {
    const h = await mapHarness(
      [
        world(stateAt(1)),
        ...Array.from({ length: 6 }, () => message('map', { body: chatBody('x') })),
      ],
      { pageSize: 3 },
    )
    const plain = h.store.acquireRoom(tid('map'))
    await flush(20)
    expect(queries(h)).toHaveLength(1)
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
