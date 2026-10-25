import { describe, expect, expectTypeOf, it } from 'vitest'
import { err, isXmppCondition, ok } from './errors.ts'
import type { Outcome, TransportError } from './errors.ts'
import { FakeSession } from './fake.ts'
import type { RoomMessage } from './muc.ts'
import type { Session, Unsubscribe } from './session.ts'

const room = 'blue-hq@conference.wrx.test'
const message: RoomMessage = {
  room,
  stanzaId: 'a1',
  nick: 'Blue CO',
  from: 'blue-co@wrx.test',
  timestamp: '2026-10-24T09:00:00Z',
  body: '{"type":"chat","schemaVersion":1,"content":{"text":"hi"}}',
}

describe('result shapes (ARC-14)', () => {
  it('builds ok and error results', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 })
    expect(err('forbidden', 'no voice', 'auth')).toEqual({
      ok: false,
      error: { condition: 'forbidden', text: 'no voice', type: 'auth' },
    })
    expect(err('timeout')).toEqual({ ok: false, error: { condition: 'timeout' } })
  })

  it('recognises XMPP conditions', () => {
    expect(isXmppCondition('not-allowed')).toBe(true)
    expect(isXmppCondition('timeout')).toBe(false)
  })

  it('types every operation as an Outcome and every event as an Unsubscribe', () => {
    expectTypeOf<Session['muc']['send']>().returns.toEqualTypeOf<
      Outcome<{ readonly stanzaId: string }>
    >()
    expectTypeOf<Session['muc']['onMessage']>().returns.toEqualTypeOf<Unsubscribe>()
    expectTypeOf<Session['pubsub']['onItems']>().returns.toEqualTypeOf<Unsubscribe>()
    expectTypeOf<Awaited<Outcome<number>>>().toEqualTypeOf<
      | { readonly ok: true; readonly value: number }
      | { readonly ok: false; readonly error: TransportError }
    >()
  })
})

describe('FakeSession (NFR-15)', () => {
  it('delivers events to listeners for the right room, and unsubscribes', () => {
    const session = new FakeSession()
    const seen: string[] = []
    const off = session.muc.onMessage(room, (m) => seen.push(m.stanzaId))
    session.muc.onMessage('other@conference.wrx.test', () => seen.push('wrong room'))
    session.emitMessage(message)
    off()
    session.emitMessage({ ...message, stanzaId: 'a2' })
    expect(seen).toEqual(['a1'])
    expect(session.listenerCount()).toBe(1)
  })

  it('records calls and returns defaults or stubs', async () => {
    const session = new FakeSession()
    expect(await session.muc.join(room, 'Blue CO')).toEqual({
      ok: true,
      value: { room, nick: 'Blue CO', role: 'participant', affiliation: 'member' },
    })
    session.stub('muc', 'send', () => Promise.resolve(err('forbidden', 'visitor')))
    expect(await session.muc.send(room, 'x')).toEqual(err('forbidden', 'visitor'))
    expect(session.calls.map((c) => `${c.api}.${c.op}`)).toEqual(['muc.join', 'muc.send'])
  })

  it('tracks occupants from presence events', () => {
    const session = new FakeSession()
    const occupant = {
      room,
      nick: 'Red CO',
      jid: 'red-co@wrx.test',
      role: 'participant' as const,
      affiliation: 'member' as const,
      available: true,
      self: false,
      statusCodes: [],
    }
    session.emitOccupant(occupant)
    expect(session.muc.occupants(room)).toEqual([occupant])
    session.emitOccupant({ ...occupant, available: false })
    expect(session.muc.occupants(room)).toEqual([])
  })

  it('reports status changes, recovery and logout', async () => {
    const session = new FakeSession()
    const states: string[] = []
    const recoveries: string[] = []
    session.onStatus((s) => states.push(s.state))
    session.onRecovered((r) => recoveries.push(r))
    session.emitStatus({ state: 'reconnecting', attempt: 1 })
    session.emitRecovered('reconnected')
    await session.disconnect()
    expect(states).toEqual(['reconnecting', 'online', 'ended'])
    expect(recoveries).toEqual(['reconnected'])
    expect(session.status()).toEqual({ state: 'ended', reason: 'logout' })
  })
})
