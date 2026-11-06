import { FORCE, ROOM, demoDesign, sampleWorldState } from '@wrx/schemas/fixtures'
import { BRIDGE_OPS } from '@wrx/schemas/bridge'
import { describe, expect, it } from 'vitest'
import { ScriptBridge, checkedWorldState } from './bridge.ts'
import type { RunnerStore } from './bridge.ts'
import { fromWorkerSchema } from './protocol.ts'
import { OPERATION_ROLES, RUNNER_OPS, SDK_OPERATIONS } from './sdk-ops.ts'
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

function fakeStore(isAdmin = true): RunnerStore {
  const design = demoDesign()
  const state = sampleWorldState()
  const messages = [
    chat('m1', 'Morning all.'),
    chat('m2', 'Second.'),
    // A body the protocol's schema refuses: left out of every page.
    { ...chat('m3', ''), body: { type: 'chat', schemaVersion: 1, content: { text: 42 } } },
    { kind: 'unreadable', id: 'm4', roomId: ROOM.blueHq, timestamp: '2026-11-06T10:00:04Z' },
    chat('m5', 'Third.'),
  ]
  const blueHq = design.rooms.find((r) => r.id === ROOM.blueHq)
  const map = design.rooms.find((r) => r.id === ROOM.map)
  const store = {
    me: () =>
      ready({
        identity: { isAdmin, anonymous: false },
        role: isAdmin ? undefined : design.roles[0],
        force: isAdmin ? undefined : design.forces[0],
        rooms: [blueHq, map].map((room) => ({ room, access: 'write' })),
      }),
    authors: () => ready(new Map([['blue-co', { roleId: BLUE_CO_ROLE }]])),
    gameSetup: () => ready(design.game),
    gameState: () => ready(undefined),
    forces: () => ready(design.forces),
    roles: () => ready(design.roles),
    objectives: () => ({
      data: undefined,
      status: 'error',
      error: { code: 'not-found', message: 'none' },
    }),
    acquire: () => () => undefined,
    worldState: (roomId: string) =>
      ready(
        roomId === ROOM.map
          ? { state, stanzaId: 'ws-1', timestamp: '2026-11-06T09:00:00Z', searching: false }
          : undefined,
      ),
    acquireWorldState: () => () => undefined,
    roomView: (roomId: string) =>
      ready(
        roomId === ROOM.blueHq ? { historyLoaded: true, hasOlder: false, messages } : undefined,
      ),
    acquireRoom: () => () => undefined,
    loadOlder: () => Promise.resolve({ ok: true, value: { added: 0, complete: true } }),
    subscribe: () => () => undefined,
  }
  return store as unknown as RunnerStore
}

function bridge(role: ScriptRole) {
  return new ScriptBridge({
    role,
    store: fakeStore(role === 'admin'),
    mapRoomId: ROOM.map,
    loadTimeoutMs: 500,
  })
}

async function call(b: ScriptBridge, op: string, request: unknown = {}, runId = 1) {
  return JSON.parse(await b.handle(runId, op, JSON.stringify(request))) as
    { ok: true; value: Record<string, unknown> } | { ok: false; code: string; error: string }
}

describe('the bridge answers protocol 1 (PY-4)', () => {
  it('offers the protocol’s operations and the runner’s draft write, each to its roles (PD4)', async () => {
    expect([...SDK_OPERATIONS].sort()).toEqual([...BRIDGE_OPS, ...RUNNER_OPS].sort())
    expect(Object.keys(OPERATION_ROLES).sort()).toEqual([...SDK_OPERATIONS].sort())
    const white = bridge('white-force')
    expect(await call(white, 'writeDraft', sampleWorldState())).toEqual({
      ok: false,
      code: 'forbidden',
      error: 'writeDraft is not open to the white-force role',
    })
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
      value: { protocolVersion: 1, isAdmin: true, roleId: null, forceId: null },
    })
    const white = bridge('white-force')
    const context = await call(white, 'readContext')
    expect(context.ok && context.value.forceId).toBe(demoDesign().forces[0]?.id)
    expect(await call(admin, 'readGameSetup')).toMatchObject({ ok: true })
    expect(await call(admin, 'readTurn')).toEqual({ ok: true, value: { state: null } })
    const forces = await call(admin, 'readForces')
    expect(forces.ok && (forces.value.forces as unknown[]).length).toBe(demoDesign().forces.length)
    const rooms = await call(admin, 'readRooms')
    expect(rooms.ok && (rooms.value.rooms as { id: string }[]).map((r) => r.id)).toEqual([
      ROOM.blueHq,
      ROOM.map,
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

  it('holds the last valid draft write per run, validated as a publish is (PD9, PLY-53)', async () => {
    const admin = bridge('admin')
    const state = sampleWorldState()
    expect(await call(admin, 'writeDraft', state, 7)).toMatchObject({ ok: true })
    expect(await call(admin, 'writeDraft', { ...state, turn: 0 }, 7)).toMatchObject({
      ok: false,
      code: 'invalid-request',
      error: expect.stringMatching(/^invalid world state: turn/) as unknown,
    })
    expect(admin.takeDraft(8)).toBeUndefined()
    expect(admin.takeDraft(7)).toEqual(state)
    expect(admin.takeDraft(7)).toBeUndefined()
    await call(admin, 'writeDraft', state, 9)
    admin.discard(9)
    expect(admin.takeDraft(9)).toBeUndefined()
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

describe('worker messages (PY-4)', () => {
  it('are parsed strictly: a forged or oversized message is refused', () => {
    expect(fromWorkerSchema.safeParse({ kind: 'hello' }).success).toBe(true)
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
