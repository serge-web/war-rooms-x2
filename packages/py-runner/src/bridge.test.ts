import { ROOM, sampleWorldState } from '@wrx/schemas/fixtures'
import type { WorldState } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
import { ScriptBridge, checkedWorldState } from './bridge.ts'
import type { RunnerStore } from './bridge.ts'
import { fromWorkerSchema } from './protocol.ts'
import { OPERATION_ROLES, REQUESTS, SDK_OPERATIONS } from './sdk-ops.ts'
import type { ScriptRole } from './sdk-ops.ts'

const OTHER_ROOM = '30000000-0000-4000-8000-0000000000ff'

function fakeStore(): RunnerStore {
  const state = sampleWorldState()
  const message = {
    kind: 'message',
    id: 'm1',
    timestamp: '2026-11-06T10:00:00Z',
    sender: { loginName: 'blue-co', nick: 'Blue CO', isAdmin: false },
    body: { type: 'chat', schemaVersion: 1, content: { text: 'Morning all.' } },
  }
  const store = {
    me: () => ({ data: { rooms: [{ room: { id: ROOM.blueHq }, access: 'write' }] } }),
    worldState: (roomId: string) => ({ data: roomId === ROOM.map ? { state } : undefined }),
    roomView: (roomId: string) => ({
      data: roomId === ROOM.blueHq ? { historyLoaded: true, messages: [message] } : undefined,
    }),
    acquireRoom: () => () => undefined,
    subscribe: () => () => undefined,
  }
  return store as unknown as RunnerStore
}

function bridge(role: ScriptRole) {
  return new ScriptBridge({ role, store: fakeStore(), mapRoomId: ROOM.map })
}

describe('the bridge (PY-4)', () => {
  it('offers only the SDK operations, each to its roles (PD4, PD7)', async () => {
    expect([...SDK_OPERATIONS].sort()).toEqual(Object.keys(OPERATION_ROLES).sort())
    expect([...SDK_OPERATIONS].sort()).toEqual(Object.keys(REQUESTS).sort())
    const white = bridge('white-force')
    expect(await white.handle(1, 'writeDraft', JSON.stringify(sampleWorldState()))).toEqual({
      ok: false,
      error: 'writeDraft is not open to the white-force role',
    })
    for (const op of ['publishWorldState', 'constructor', '__proto__', 'toString', '']) {
      const result = await white.handle(1, op, 'null')
      expect(result.ok, op).toBe(false)
    }
    expect(white.takeDraft(1)).toBeUndefined()
  })

  it('reads the world state and the role’s own rooms only', async () => {
    const admin = bridge('admin')
    const read = await admin.handle(1, 'readWorldState', 'null')
    expect(read.ok && (read.value as WorldState).turn).toBe(sampleWorldState().turn)
    const messages = await admin.handle(
      1,
      'readRoomMessages',
      JSON.stringify({ roomId: ROOM.blueHq }),
    )
    expect(messages).toEqual({
      ok: true,
      value: [
        {
          id: 'm1',
          timestamp: '2026-11-06T10:00:00Z',
          sender: 'blue-co',
          isAdmin: false,
          body: { type: 'chat', schemaVersion: 1, content: { text: 'Morning all.' } },
        },
      ],
    })
    expect(
      await admin.handle(1, 'readRoomMessages', JSON.stringify({ roomId: OTHER_ROOM })),
    ).toEqual({ ok: false, error: 'not a room of this role' })
  })

  it('refuses a payload that is not JSON or not the request’s shape', async () => {
    const admin = bridge('admin')
    expect(await admin.handle(1, 'readWorldState', '{')).toEqual({
      ok: false,
      error: 'the payload is not JSON',
    })
    expect(await admin.handle(1, 'readWorldState', '{}')).toMatchObject({ ok: false })
    expect(
      await admin.handle(1, 'readRoomMessages', JSON.stringify({ roomId: ROOM.blueHq, extra: 1 })),
    ).toEqual({ ok: false, error: 'readRoomMessages: the request has the wrong shape' })
    expect(admin.calls.filter((c) => !c.ok)).toHaveLength(3)
  })

  it('holds the last valid draft write per run, validated as a publish is (PD9, PLY-53)', async () => {
    const admin = bridge('admin')
    const state = sampleWorldState()
    expect(await admin.handle(7, 'writeDraft', JSON.stringify(state))).toMatchObject({ ok: true })
    const bad = { ...state, turn: 0 }
    expect(await admin.handle(7, 'writeDraft', JSON.stringify(bad))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^invalid world state: turn/) as unknown,
    })
    expect(admin.takeDraft(8)).toBeUndefined()
    expect(admin.takeDraft(7)).toEqual(state)
    expect(admin.takeDraft(7)).toBeUndefined()
    await admin.handle(9, 'writeDraft', JSON.stringify(state))
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
    const result = checkedWorldState({ turn: 1, assets })
    expect(result).toMatchObject({
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
      { kind: 'call', runId: 1, callId: 1, op: 'readWorldState', payload: 'x'.repeat(1_000_001) },
      { kind: 'output', runId: 1.5, text: '' },
      { kind: 'apply-draft', state: sampleWorldState() },
    ]) {
      expect(fromWorkerSchema.safeParse(forged).success, JSON.stringify(forged).slice(0, 60)).toBe(
        false,
      )
    }
  })
})
