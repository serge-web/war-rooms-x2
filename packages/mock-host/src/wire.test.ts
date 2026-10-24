import { describe, expect, it } from 'vitest'
import {
  busMessageSchema,
  clientFrameSchema,
  parseMessage,
  serverFrameSchema,
  upMessageSchema,
} from './wire.ts'
import type { LogEntry } from './wire.ts'

describe('frame validation across tabs and the worker (NFR-19)', () => {
  it('accepts well-formed client frames', () => {
    const frames: unknown[] = [
      { t: 'login', credentials: { kind: 'anonymous' } },
      {
        t: 'login',
        credentials: { kind: 'password', username: 'blue-co', password: 'demo-blue-co' },
        resource: 'tab-1',
      },
      { t: 'request', id: 3, request: { op: 'muc.send', args: ['r@conference.x', 'hi'] } },
      { t: 'request', id: 4, request: { op: 'pubsub.getItems', args: ['n', undefined] } },
      { t: 'request', id: 5, request: { op: 'muc.listRooms', args: [] } },
      { t: 'logout' },
      { t: 'drop' },
    ]
    for (const frame of frames) expect(clientFrameSchema.safeParse(frame).success).toBe(true)
  })

  it('rejects malformed client frames', () => {
    const frames: unknown[] = [
      null,
      'login',
      { t: 'login' },
      { t: 'login', credentials: { kind: 'password', username: 'x' } },
      { t: 'request', id: -1, request: { op: 'muc.listRooms', args: [] } },
      { t: 'request', id: 1, request: { op: 'muc.nuke', args: [] } },
      { t: 'request', id: 1, request: { op: 'muc.send', args: ['room'] } },
      { t: 'request', id: 1, request: { op: 'muc.send', args: ['room', 42] } },
      { t: 'request', id: 1, request: { op: 'muc.setRole', args: ['r', 'n', 'god'] } },
      { t: 'shutdown' },
    ]
    for (const frame of frames) expect(clientFrameSchema.safeParse(frame).success).toBe(false)
  })

  it('accepts well-formed server frames and rejects malformed ones', () => {
    const good: unknown[] = [
      { t: 'bound', jid: 'a@x/r', anonymous: false, services: { muc: 'c.x', pubsub: 'p.x' } },
      { t: 'refused', error: { condition: 'not-authorized', type: 'auth', text: 'no' } },
      {
        t: 'reply',
        id: 1,
        reply: { op: 'admin.getPrivate', result: { ok: true, value: undefined } },
      },
      {
        t: 'reply',
        id: 2,
        reply: { op: 'muc.send', result: { ok: false, error: { condition: 'forbidden' } } },
      },
      {
        t: 'event',
        event: {
          kind: 'message',
          message: {
            room: 'r@c.x',
            stanzaId: '1',
            nick: 'n',
            from: undefined,
            timestamp: '2026-10-24T09:00:00.000Z',
            body: '{}',
          },
        },
      },
      { t: 'end', reason: 'session-ended' },
      { t: 'closed' },
      { t: 'dropped' },
    ]
    for (const frame of good) expect(serverFrameSchema.safeParse(frame).success).toBe(true)
    const bad: unknown[] = [
      { t: 'bound', jid: 'a@x/r' },
      { t: 'reply', id: 1, reply: { op: 'muc.send', result: { ok: true, value: 'x' } } },
      { t: 'reply', id: 1, reply: { op: 'muc.send', result: { ok: false, error: { c: 1 } } } },
      { t: 'event', event: { kind: 'telepathy' } },
      { t: 'end', reason: 'bored' },
    ]
    for (const frame of bad) expect(serverFrameSchema.safeParse(frame).success).toBe(false)
  })

  it('validates the host messages that carry frames', () => {
    const c2s = { k: 'c2s', tab: 't1', conn: 1, frame: { t: 'logout' } }
    expect(upMessageSchema.safeParse(c2s).success).toBe(true)
    expect(upMessageSchema.safeParse({ ...c2s, frame: { t: 'nope' } }).success).toBe(false)
    expect(upMessageSchema.safeParse({ ...c2s, tab: '' }).success).toBe(false)
    expect(busMessageSchema.safeParse({ k: 'up', to: 't2', m: c2s }).success).toBe(true)
    expect(busMessageSchema.safeParse({ k: 'leader', leader: 't2', notices: [] }).success).toBe(
      true,
    )
    expect(
      busMessageSchema.safeParse({ k: 'leader', leader: 't2', notices: [{ kind: 'x' }] }).success,
    ).toBe(false)
  })

  it('logs and drops an invalid message', () => {
    const logs: LogEntry[] = []
    const parsed = parseMessage(upMessageSchema, { k: 'c2s' }, 'test', (e) => logs.push(e))
    expect(parsed).toBeUndefined()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.message).toContain('dropped an invalid message (test)')
  })
})
