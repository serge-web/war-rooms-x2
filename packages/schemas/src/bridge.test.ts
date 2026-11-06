// The bridge protocol (WP 6.1, Annex C PY-4): calls are parsed as untrusted input, replies are
// checked against each operation's result schema, and every reply matches the envelope.
import { describe, expect, it } from 'vitest'
import {
  BRIDGE_LIMITS,
  BRIDGE_OPS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_REQUESTS,
  BRIDGE_RESULTS,
  bridgeError,
  bridgeOk,
  bridgeReplySchema,
  parseBridgeCall,
} from './bridge.ts'
import type { BridgeResult } from './bridge.ts'
import { FORCE, ROLE, ROOM, demoDesign, sampleWorldState } from './fixtures.ts'

function reply(text: string) {
  return bridgeReplySchema.parse(JSON.parse(text))
}

describe('bridge protocol (WP 6.1)', () => {
  it('has a request and a result schema for every operation, and nothing else', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(1)
    expect(Object.keys(BRIDGE_REQUESTS)).toEqual([...BRIDGE_OPS])
    expect(Object.keys(BRIDGE_RESULTS)).toEqual([...BRIDGE_OPS])
  })

  it('parses a call: defaults filled, unknown operations and bad requests refused', () => {
    const page = parseBridgeCall('readRoomMessages', JSON.stringify({ roomId: ROOM.blueHq }))
    expect(page).toEqual({
      ok: true,
      op: 'readRoomMessages',
      request: { roomId: ROOM.blueHq, limit: 100, order: 'oldest-first' },
    })
    expect(parseBridgeCall('readForces', '{}')).toEqual({
      ok: true,
      op: 'readForces',
      request: {},
    })
    const refused = (op: string, payload: string) => {
      const parsed = parseBridgeCall(op, payload)
      if (parsed.ok) throw new Error(`accepted ${op} ${payload}`)
      return reply(parsed.reply)
    }
    expect(refused('writeDraft', '{}')).toMatchObject({ ok: false, code: 'unknown-op' })
    expect(refused('constructor', '{}')).toMatchObject({ ok: false, code: 'unknown-op' })
    expect(refused('readForces', 'not json')).toMatchObject({ code: 'invalid-request' })
    expect(refused('readForces', '{"extra":1}')).toMatchObject({ code: 'invalid-request' })
    expect(refused('readForces', 'null')).toMatchObject({ code: 'invalid-request' })
    expect(refused('readRoomMessages', '{"roomId":"x"}')).toMatchObject({
      code: 'invalid-request',
      error: expect.stringContaining('roomId') as unknown,
    })
    expect(
      refused('readRoomMessages', JSON.stringify({ roomId: ROOM.blueHq, limit: 501 })),
    ).toMatchObject({ code: 'invalid-request' })
    expect(refused('readObjectives', 'x'.repeat(BRIDGE_LIMITS.requestChars + 1))).toMatchObject({
      code: 'invalid-request',
    })
  })

  it('checks a result before it goes back; a bad one is a failure, not data', () => {
    const design = demoDesign()
    expect(reply(bridgeOk('readForces', { forces: design.forces }))).toEqual({
      ok: true,
      value: { forces: design.forces },
    })
    const state = sampleWorldState()
    expect(
      reply(bridgeOk('readWorldState', { state, messageId: 'm1', sentAt: '2026-10-24T08:30:00Z' })),
    ).toMatchObject({ ok: true, value: { state } })
    expect(
      reply(
        bridgeOk('readContext', {
          protocolVersion: 1,
          isAdmin: false,
          roleId: ROLE.blueCo,
          forceId: FORCE.blue,
        }),
      ),
    ).toMatchObject({ ok: true })
    const bad = { forces: [{ ...design.forces[0], colour: 'blue' }] }
    expect(reply(bridgeOk('readForces', bad as never))).toMatchObject({
      ok: false,
      code: 'failed',
    })
  })

  it('carries room messages of each body type, with the sender from the stanza', () => {
    const value: BridgeResult<'readRoomMessages'> = {
      messages: [
        {
          id: 'stanza-1',
          roomId: ROOM.blueHq,
          sentAt: '2026-10-24T08:40:00.000Z',
          sender: { isAdmin: false, roleId: ROLE.blueCo, loginName: 'blue-co' },
          body: { type: 'chat', schemaVersion: 1, content: { text: 'Morning all.' } },
        },
        {
          id: 'stanza-2',
          roomId: ROOM.map,
          sentAt: '2026-10-24T08:30:00.000Z',
          sender: { isAdmin: true, roleId: null, loginName: 'admin' },
          body: { type: 'world-state', schemaVersion: 1, content: sampleWorldState() },
        },
      ],
      cursor: null,
    }
    expect(reply(bridgeOk('readRoomMessages', value))).toEqual({ ok: true, value })
  })

  it('caps an error reply', () => {
    expect(reply(bridgeError('failed', 'x'.repeat(5_000)))).toMatchObject({
      ok: false,
      code: 'failed',
      error: 'x'.repeat(BRIDGE_LIMITS.errorChars),
    })
  })
})
