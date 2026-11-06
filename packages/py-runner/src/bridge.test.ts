import { FORCE, ROLE, ROOM, demoDesign, sampleWorldState } from '@wrx/schemas/fixtures'
import { BRIDGE_OPS } from '@wrx/schemas/bridge'
import type { GameState, WorldState } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
import { ScriptBridge, checkedWorldState } from './bridge.ts'
import type { RunnerStore } from './bridge.ts'
import { fromWorkerSchema } from './protocol.ts'
import { OPERATION_ROLES, SDK_OPERATIONS } from './sdk-ops.ts'
import type { ScriptRole } from './sdk-ops.ts'

const OTHER_ROOM = '30000000-0000-4000-8000-0000000000ff'
const BLUE_CO_ROLE = '30000000-0000-4000-8000-0000000000b1'
const ready = <T>(data: T) => ({ data, status: 'ready' as const, error: undefined })

function chat(id: string, text: string, login = 'blue-co') {
  return {
    kind: 'message',
    id,
    roomId: ROOM.blueHq,
    timestamp: `2026-11-06T10:00:0${id.slice(-1)}Z`,
    sender: { nick: login, jid: undefined, loginName: login, isAdmin: false },
    body: { type: 'chat', schemaVersion: 1, content: { text } },
  }
}

interface Fake {
  readonly store: RunnerStore
  readonly sent: { op: string; roomId: string; payload: unknown }[]
  readonly acquired: string[]
  readonly released: string[]
  setGameState(state: GameState | undefined): void
  addMessage(message: ReturnType<typeof chat>): void
}

function fakeStore(isAdmin = true): Fake {
  const design = demoDesign()
  const state = sampleWorldState()
  const messages: unknown[] = [
    chat('m1', 'Morning all.'),
    chat('m2', 'Second.'),
    // A body the protocol's schema refuses: left out of every page.
    { ...chat('m3', ''), body: { type: 'chat', schemaVersion: 1, content: { text: 42 } } },
    { kind: 'unreadable', id: 'm4', roomId: ROOM.blueHq, timestamp: '2026-11-06T10:00:04Z' },
    chat('m5', 'Third.'),
  ]
  const room = (id: string) => design.rooms.find((r) => r.id === id)
  const white = design.forces.find((f) => f.isUmpire)
  const cell = design.roles.find((r) => r.id === ROLE.whiteCell)
  let gameState: GameState | undefined
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const sent: Fake['sent'] = []
  const acquired: string[] = []
  const released: string[] = []
  const hold = (what: string) => {
    acquired.push(what)
    return () => {
      released.push(what)
    }
  }
  const store = {
    me: () =>
      ready({
        identity: { isAdmin, anonymous: false },
        role: isAdmin ? undefined : cell,
        force: isAdmin ? undefined : white,
        isUmpire: true,
        isObserver: false,
        rooms: [
          { room: room(ROOM.blueHq), access: 'write' },
          { room: room(ROOM.map), access: 'write' },
          { room: room(ROOM.negotiation), access: 'read' },
          { room: room(ROOM.umpire), access: 'write' },
        ],
      }),
    authors: () => ready(new Map([['blue-co', { roleId: BLUE_CO_ROLE }]])),
    gameSetup: () => ready(design.game),
    gameState: () => ready(gameState),
    forces: () => ready(design.forces),
    roles: () => ready(design.roles),
    objectives: () => ({
      data: undefined,
      status: 'error',
      error: { code: 'not-found', message: 'none' },
    }),
    acquire: (node: string) => hold(node),
    worldState: (roomId: string) =>
      ready(
        roomId === ROOM.map
          ? { state, stanzaId: 'ws-1', timestamp: '2026-11-06T09:00:00Z', searching: false }
          : undefined,
      ),
    acquireWorldState: () => () => undefined,
    roomView: (roomId: string) =>
      ready(
        roomId === OTHER_ROOM
          ? undefined
          : {
              status: 'joined',
              historyLoaded: true,
              hasOlder: false,
              messages: roomId === ROOM.blueHq ? messages : [],
            },
      ),
    acquireRoom: (roomId: string) => hold(`room:${roomId}`),
    loadOlder: () => Promise.resolve({ ok: true, value: { added: 0, complete: true } }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sendMessage: (roomId: string, text: string, options: unknown) => {
      sent.push({ op: 'sendMessage', roomId, payload: { text, options } })
      return Promise.resolve({ ok: true, value: { stanzaId: `s${sent.length}` } })
    },
    sendTemplateMessage: (roomId: string, templateId: string) => {
      sent.push({ op: 'sendTemplate', roomId, payload: templateId })
      return Promise.resolve({
        ok: false,
        error: { code: 'not-permitted', message: 'this room does not offer that template' },
      })
    },
    sendProposal: (roomId: string, proposal: unknown) => {
      sent.push({ op: 'postProposal', roomId, payload: proposal })
      return Promise.resolve({ ok: true, value: { stanzaId: 'p1' } })
    },
  }
  return {
    store: store as unknown as RunnerStore,
    sent,
    acquired,
    released,
    setGameState: (next) => {
      gameState = next
      notify()
    },
    addMessage: (message) => {
      messages.push(message)
      notify()
    },
  }
}

function bridge(role: ScriptRole, fake: Fake = fakeStore(role === 'admin'), draft?: WorldState) {
  const b = new ScriptBridge({
    role,
    store: fake.store,
    mapRoomId: ROOM.map,
    loadTimeoutMs: 500,
    ...(role === 'admin' ? { draft: { current: () => draft } } : {}),
  })
  const events: string[] = []
  b.beginRun(1, (event) => events.push(event))
  return Object.assign(b, { events })
}

async function call(b: ScriptBridge, op: string, request: unknown = {}, runId = 1) {
  return JSON.parse(await b.handle(runId, op, JSON.stringify(request))) as
    { ok: true; value: Record<string, unknown> } | { ok: false; code: string; error: string }
}

describe('the bridge answers protocol 2 (PY-4)', () => {
  it('offers the protocol’s operations, each to its roles (PD4, PD6, PD7)', async () => {
    expect([...SDK_OPERATIONS].sort()).toEqual([...BRIDGE_OPS].sort())
    expect(Object.keys(OPERATION_ROLES).sort()).toEqual([...SDK_OPERATIONS].sort())
    const white = bridge('white-force')
    expect(await call(white, 'writeDraft', { state: sampleWorldState() })).toEqual({
      ok: false,
      code: 'forbidden',
      error: 'writeDraft is not open to the white-force role',
    })
    expect(await call(white, 'readDraft')).toMatchObject({ ok: false, code: 'forbidden' })
    const admin = bridge('admin')
    expect(
      await call(admin, 'postProposal', { state: sampleWorldState(), summary: 'x' }),
    ).toMatchObject({ ok: false, code: 'forbidden' })
    for (const op of ['publishWorldState', 'constructor', '__proto__', 'toString', '']) {
      expect(await call(white, op), op).toMatchObject({ ok: false, code: 'unknown-op' })
    }
    expect(white.takeDraft(1)).toBeUndefined()
  })

  it('refuses a request that is not JSON, too long, or not the operation’s shape', async () => {
    const admin = bridge('admin')
    expect(JSON.parse(await admin.handle(1, 'readTurn', '{'))).toMatchObject({
      ok: false,
      code: 'invalid-request',
    })
    expect(JSON.parse(await admin.handle(1, 'readTurn', `"${'x'.repeat(10_001)}"`))).toMatchObject({
      code: 'invalid-request',
    })
    expect(await call(admin, 'readTurn', { extra: 1 })).toMatchObject({ code: 'invalid-request' })
    expect(
      await call(admin, 'readRoomMessages', { roomId: ROOM.blueHq, limit: 501 }),
    ).toMatchObject({
      code: 'invalid-request',
    })
    expect(admin.calls.filter((c) => !c.ok)).toHaveLength(4)
  })

  it('reads the context, setup, turn, forces, roles and the role’s rooms', async () => {
    const admin = bridge('admin')
    expect(await call(admin, 'readContext')).toEqual({
      ok: true,
      value: { protocolVersion: 2, isAdmin: true, roleId: null, forceId: null },
    })
    const white = bridge('white-force')
    const context = await call(white, 'readContext')
    expect(context.ok && context.value.forceId).toBe(FORCE.white)
    expect(await call(admin, 'readGameSetup')).toMatchObject({ ok: true })
    expect(await call(admin, 'readTurn')).toEqual({ ok: true, value: { state: null } })
    const forces = await call(admin, 'readForces')
    expect(forces.ok && (forces.value.forces as unknown[]).length).toBe(demoDesign().forces.length)
    const rooms = await call(admin, 'readRooms')
    expect(rooms.ok && (rooms.value.rooms as { id: string }[]).map((r) => r.id)).toEqual([
      ROOM.blueHq,
      ROOM.map,
      ROOM.negotiation,
      ROOM.umpire,
    ])
    expect(await call(admin, 'readObjectives', { forceId: FORCE.blue })).toEqual({
      ok: true,
      value: { objectives: null },
    })
    expect(await call(admin, 'readObjectives', { forceId: OTHER_ROOM })).toMatchObject({
      ok: false,
      code: 'not-found',
    })
  })

  it('reads the world state with its message id and time', async () => {
    const result = await call(bridge('white-force'), 'readWorldState')
    expect(result).toMatchObject({
      ok: true,
      value: { messageId: 'ws-1', sentAt: '2026-11-06T09:00:00Z' },
    })
    expect(result.ok && (result.value.state as { turn: number }).turn).toBe(sampleWorldState().turn)
  })

  it('pages a room’s messages with a cursor, leaving out invalid bodies (PD2)', async () => {
    const admin = bridge('admin')
    const first = await call(admin, 'readRoomMessages', { roomId: ROOM.blueHq, limit: 2 })
    if (!first.ok) throw new Error(first.error)
    const ids = (page: Record<string, unknown>) =>
      (page.messages as { id: string }[]).map((m) => m.id)
    expect(ids(first.value)).toEqual(['m1', 'm2'])
    expect(first.value.messages).toContainEqual(
      expect.objectContaining({
        sender: { isAdmin: false, roleId: BLUE_CO_ROLE, loginName: 'blue-co' },
        sentAt: '2026-11-06T10:00:01Z',
      }),
    )
    const second = await call(admin, 'readRoomMessages', {
      roomId: ROOM.blueHq,
      limit: 2,
      cursor: first.value.cursor,
    })
    expect(second).toMatchObject({ ok: true, value: { cursor: null } })
    expect(second.ok && ids(second.value)).toEqual(['m5'])

    const newest = await call(admin, 'readRoomMessages', {
      roomId: ROOM.blueHq,
      limit: 1,
      order: 'newest-first',
    })
    expect(newest.ok && ids(newest.value)).toEqual(['m5'])
    const wrongOrder = await call(admin, 'readRoomMessages', {
      roomId: ROOM.blueHq,
      cursor: newest.ok ? newest.value.cursor : '',
    })
    expect(wrongOrder).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await call(admin, 'readRoomMessages', { roomId: OTHER_ROOM })).toMatchObject({
      ok: false,
      code: 'not-found',
    })
  })

  it('refuses a world state over the 500 KB cap', () => {
    const template = Object.values(sampleWorldState().assets)[0]
    if (template === undefined) throw new Error('no asset')
    const assets = Object.fromEntries(
      Array.from({ length: 3000 }, (_, i) => {
        const id = `30000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
        return [id, { ...template, id }]
      }),
    )
    expect(checkedWorldState({ turn: 1, assets })).toMatchObject({
      ok: false,
      error: expect.stringMatching(
        /^the world state is \d+ bytes, over the 500000-byte cap$/,
      ) as unknown,
    })
  })
})

describe('the admin’s draft (PD7, PD9; WP 6.4)', () => {
  it('holds the last valid write per run, validated as a publish is (PLY-53)', async () => {
    const admin = bridge('admin')
    admin.beginRun(7, () => undefined)
    const state = sampleWorldState()
    expect(await call(admin, 'writeDraft', { state }, 7)).toMatchObject({ ok: true })
    expect(await call(admin, 'writeDraft', { state: { ...state, turn: 0 } }, 7)).toMatchObject({
      ok: false,
      code: 'invalid-request',
    })
    expect(admin.takeDraft(8)).toBeUndefined()
    // No draft read: the base is the published state at the run's start.
    expect(admin.takeDraft(7)).toEqual({ state, base: state })
    expect(admin.takeDraft(7)).toBeUndefined()
    admin.beginRun(9, () => undefined)
    await call(admin, 'writeDraft', { state }, 9)
    admin.discard(9)
    expect(admin.takeDraft(9)).toBeUndefined()
    // A run that has ended writes nothing.
    admin.endRun(9)
    expect(await call(admin, 'writeDraft', { state }, 9)).toMatchObject({ code: 'unavailable' })
  })

  it('reads the draft held, else the published state; the first read is the write’s base', async () => {
    const published = sampleWorldState()
    const held = { ...published, turn: 2 }
    const admin = bridge('admin', fakeStore(true), held)
    expect(await call(admin, 'readDraft')).toEqual({ ok: true, value: { state: held, held: true } })
    const written = { ...held, turn: 3 }
    await call(admin, 'writeDraft', { state: written })
    expect(admin.takeDraft(1)).toEqual({ state: written, base: held })
    const none = bridge('admin')
    expect(await call(none, 'readDraft')).toEqual({
      ok: true,
      value: { state: published, held: false },
    })
  })
})

describe('acting (PY-2; WP 6.4)', () => {
  it('sends to a room the role writes in, quietly, holding it joined until the run ends', async () => {
    const fake = fakeStore(false)
    const white = bridge('white-force', fake)
    expect(await call(white, 'sendMessage', { roomId: ROOM.blueHq, text: 'Hello' })).toEqual({
      ok: true,
      value: { stanzaId: 's1' },
    })
    expect(fake.sent[0]).toEqual({
      op: 'sendMessage',
      roomId: ROOM.blueHq,
      payload: { text: 'Hello', options: { quiet: true } },
    })
    expect(fake.acquired).toContain(`room:${ROOM.blueHq}`)
    white.endRun(1)
    expect(fake.released).toContain(`room:${ROOM.blueHq}`)
  })

  it('refuses a room the role only reads, one it is not in, and a template the room refuses', async () => {
    const admin = bridge('admin')
    expect(await call(admin, 'sendMessage', { roomId: ROOM.negotiation, text: 'x' })).toMatchObject(
      { ok: false, code: 'forbidden' },
    )
    expect(await call(admin, 'sendMessage', { roomId: OTHER_ROOM, text: 'x' })).toMatchObject({
      ok: false,
      code: 'not-found',
    })
    expect(
      await call(admin, 'sendTemplate', {
        roomId: ROOM.blueHq,
        templateId: OTHER_ROOM,
        values: {},
      }),
    ).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('keeps the adjudication pause for a role outside the White Force (PLY-56)', async () => {
    const fake = fakeStore(false)
    // A player outside the White Force: the same session, its force not the umpire's.
    const store: RunnerStore = {
      ...fake.store,
      me: () => {
        const me = fake.store.me()
        return { ...me, data: { ...me.data, isUmpire: false } }
      },
    }
    const player = new ScriptBridge({ role: 'white-force', store, mapRoomId: ROOM.map })
    player.beginRun(1, () => undefined)
    fake.setGameState({ schemaVersion: 1, turn: 1, phase: 'adjudication' })
    expect(await call(player, 'sendMessage', { roomId: ROOM.blueHq, text: 'x' })).toMatchObject({
      ok: false,
      code: 'paused',
    })
    // The White Force is exempt.
    const white = bridge('white-force', fake)
    expect(await call(white, 'sendMessage', { roomId: ROOM.blueHq, text: 'x' })).toMatchObject({
      ok: true,
    })
  })

  it('posts a White Force proposal to the umpire room, checked first (PD6, PY-8)', async () => {
    const fake = fakeStore(false)
    const white = bridge('white-force', fake)
    const state = sampleWorldState()
    expect(await call(white, 'postProposal', { state, summary: 'Resupplied.' })).toEqual({
      ok: true,
      value: { stanzaId: 'p1' },
    })
    expect(fake.sent[0]).toEqual({
      op: 'postProposal',
      roomId: ROOM.umpire,
      payload: { state, summary: 'Resupplied.' },
    })
    expect(
      await call(white, 'postProposal', { state: { ...state, turn: 0 }, summary: 'x' }),
    ).toMatchObject({ ok: false, code: 'invalid-request' })
  })
})

describe('events (PY-2; WP 6.4)', () => {
  it('sends each new message in a subscribed room, and nothing after the run ends', async () => {
    const fake = fakeStore(false)
    const white = bridge('white-force', fake)
    expect(await call(white, 'subscribeMessages', { roomId: ROOM.blueHq })).toEqual({
      ok: true,
      value: {},
    })
    expect(white.events).toEqual([])
    fake.addMessage(chat('m6', 'New.'))
    expect(white.events).toHaveLength(1)
    expect(JSON.parse(white.events[0] ?? '')).toMatchObject({
      type: 'message',
      message: { id: 'm6', roomId: ROOM.blueHq, body: { content: { text: 'New.' } } },
    })
    white.endRun(1)
    fake.addMessage(chat('m7', 'Later.'))
    expect(white.events).toHaveLength(1)
    expect(await call(white, 'subscribeMessages', { roomId: OTHER_ROOM }, 2)).toMatchObject({
      ok: false,
    })
  })

  it('sends the turn state when it changes', async () => {
    const fake = fakeStore(true)
    const admin = bridge('admin', fake)
    expect(await call(admin, 'subscribePhase')).toMatchObject({ ok: true })
    fake.setGameState({ schemaVersion: 1, turn: 1, phase: 'planning' })
    fake.setGameState({ schemaVersion: 1, turn: 1, phase: 'planning' })
    fake.setGameState({ schemaVersion: 1, turn: 1, phase: 'adjudication' })
    expect(admin.events.map((e) => (JSON.parse(e) as { state: GameState }).state.phase)).toEqual([
      'planning',
      'adjudication',
    ])
  })
})

describe('worker messages (PY-4)', () => {
  it('are parsed strictly: a forged or oversized message is refused', () => {
    expect(fromWorkerSchema.safeParse({ kind: 'hello' }).success).toBe(true)
    expect(fromWorkerSchema.safeParse({ kind: 'started', runId: 1 }).success).toBe(true)
    for (const forged of [
      'forged',
      { kind: 'done', runId: 1, ok: true },
      { kind: 'hello', extra: 1 },
      { kind: 'call', runId: 1, callId: 1, op: 'readTurn', payload: 'x'.repeat(1_000_001) },
      { kind: 'output', runId: 1.5, text: '' },
      { kind: 'apply-draft', state: sampleWorldState() },
    ]) {
      expect(fromWorkerSchema.safeParse(forged).success, JSON.stringify(forged).slice(0, 60)).toBe(
        false,
      )
    }
  })
})
