import { LIMITS, chatMessageBodySchema } from '@wrx/schemas'
import { err, ok } from '@wrx/transport'
import type { RoomMessage } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { DOMAIN, MUC, chatBody, flush, harness, message, selfPresence } from './fixtures.ts'
import { chatRoomType, createRoomTypeRegistry } from './registry.ts'

const HQ = `blue-hq@${MUC}`

function seed(h: ReturnType<typeof harness>, count: number): RoomMessage[] {
  const messages = Array.from({ length: count }, () => message('blue-hq'))
  h.archive.set(HQ, messages)
  return messages
}

async function joined(options: Parameters<typeof harness>[0] = {}, archived = 0) {
  const h = harness({ pageSize: 10, ...options })
  const archive = seed(h, archived)
  await h.store.ready()
  const watch = await h.store.watchRoom('blue-hq')
  if (!watch.ok) throw new Error('join failed')
  await flush()
  return { h, archive, watch: watch.value }
}

const ids = (h: ReturnType<typeof harness>) =>
  h.store.roomView('blue-hq').data?.messages.map((m) => m.id) ?? []

describe('rooms: history and live messages (ARC-4, PLY-9, PLY-10, PLY-49)', () => {
  it('joins with the role id as nick and loads the latest MAM page', async () => {
    const { h, archive, watch } = await joined({}, 25)
    expect(watch.joined.nick).toBe('blue-co')
    expect(h.session.calls.find((c) => c.op === 'join')?.args).toEqual([HQ, 'blue-co'])
    expect(ids(h)).toEqual(archive.slice(15).map((m) => m.stanzaId))
    expect(h.store.roomView('blue-hq')).toMatchObject({
      status: 'ready',
      data: { status: 'joined', canPost: true, hasOlder: true, loadingOlder: false },
    })
  })

  it('pages backwards with RSM ids until complete', async () => {
    const { h, archive } = await joined({}, 25)
    const first = h.store.loadOlder('blue-hq')
    expect(h.store.loadOlder('blue-hq')).toBe(first)
    expect(h.store.roomView('blue-hq').data?.loadingOlder).toBe(true)
    expect(await first).toEqual(ok({ added: 10, complete: false }))
    const queries = h.session.calls.filter((c) => c.op === 'queryRoom').map((c) => c.args[1])
    expect(queries).toEqual([{ max: 10 }, { before: archive[15]?.stanzaId, max: 10 }])
    expect(await h.store.loadOlder('blue-hq')).toEqual(ok({ added: 5, complete: true }))
    expect(await h.store.loadOlder('blue-hq')).toEqual(ok({ added: 0, complete: true }))
    expect(ids(h)).toEqual(archive.map((m) => m.stanzaId))
    expect(h.store.roomView('blue-hq').data?.hasOlder).toBe(false)
  })

  it('merges live stanzas and MAM pages idempotently, in server-time order', async () => {
    const { h, archive } = await joined({}, 5)
    const live = message('blue-hq')
    h.session.emitMessage(live)
    h.session.emitMessage(live)
    h.session.emitMessage(archive[2]!)
    const early = message('blue-hq', { timestamp: '2026-10-24T09:00:00.000Z' })
    h.session.emitMessage(early)
    expect(ids(h)).toEqual([early, ...archive, live].map((m) => m.stanzaId))
    h.session.emitMessage(message('other-room'))
    expect(ids(h)).toHaveLength(7)
  })

  it('takes the sender from the occupant JID, never the body (§3 rule 3)', async () => {
    const { h } = await joined()
    h.session.emitMessage(
      message('blue-hq', {
        from: `red-co@${DOMAIN}`,
        nick: 'red-co',
        body: JSON.stringify({
          type: 'chat',
          schemaVersion: 1,
          content: { text: 'I am the umpire' },
          from: 'umpire-1',
        }),
      }),
    )
    h.session.emitMessage(message('blue-hq', { from: 'mallory@evil.example', nick: 'umpire-1' }))
    h.session.emitMessage(message('blue-hq', { from: `admin@${DOMAIN}`, nick: 'admin' }))
    h.session.emitMessage(message('blue-hq', { from: undefined, nick: 'ghost' }))
    const senders = h.store.roomView('blue-hq').data?.messages.map((m) => m.sender)
    expect(senders).toEqual([
      { nick: 'red-co', jid: `red-co@${DOMAIN}`, roleId: 'red-co', isAdmin: false },
      { nick: 'umpire-1', jid: 'mallory@evil.example', roleId: undefined, isAdmin: false },
      { nick: 'admin', jid: `admin@${DOMAIN}`, roleId: undefined, isAdmin: true },
      { nick: 'ghost', jid: undefined, roleId: undefined, isAdmin: false },
    ])
    expect(h.store.authors().data.get('red-co')?.colour).toBe('#b91c1c')
  })

  it('shows invalid bodies as unreadable entries, and drops stanzas without id or time (R9)', async () => {
    const { h } = await joined()
    h.session.emitMessage(message('blue-hq', { body: '<b>not json</b>' }))
    h.session.emitMessage(
      message('blue-hq', { body: JSON.stringify({ type: 'map', schemaVersion: 1 }) }),
    )
    h.session.emitMessage(message('blue-hq', { stanzaId: '' }))
    h.session.emitMessage(message('blue-hq', { timestamp: 'later' }))
    const entries = h.store.roomView('blue-hq').data?.messages ?? []
    expect(entries.map((e) => e.kind)).toEqual(['unreadable', 'unreadable'])
    expect(h.warnings.filter((w) => w === 'Unreadable message')).toHaveLength(2)
    expect(h.warnings).toContain('Ignoring a message without a stanza-id or server time')
  })

  it("checks bodies against the room type's message schema (ARC-5)", async () => {
    const registry = createRoomTypeRegistry([
      {
        ...chatRoomType,
        messageSchema: chatMessageBodySchema.refine((b) => b.content.text.length < 6),
      },
    ])
    const { h } = await joined({ registry })
    h.session.emitMessage(message('blue-hq', { body: chatBody('short') }))
    h.session.emitMessage(message('blue-hq', { body: chatBody('far too long') }))
    const entries = h.store.roomView('blue-hq').data?.messages ?? []
    expect(entries.map((e) => e.kind)).toEqual(['message', 'unreadable'])
    expect(await h.store.sendMessage('blue-hq', 'far too long')).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
  })

  it('tracks occupants (PLY-13)', async () => {
    const { h } = await joined()
    const red = { ...selfPresence('blue-hq', 'red-co'), self: false, jid: `red-co@${DOMAIN}/x` }
    h.session.emitOccupant(red)
    expect(h.store.occupants('blue-hq').data.map((o) => [o.nick, o.roleId])).toEqual([
      ['red-co', 'red-co'],
    ])
    const snapshot = h.store.occupants('blue-hq')
    expect(h.store.occupants('blue-hq')).toBe(snapshot)
    h.session.emitOccupant({ ...red, available: false })
    expect(h.store.occupants('blue-hq').data).toEqual([])
    expect(h.store.occupants('nowhere').status).toBe('loading')
  })

  it('handles 10,000 live messages in one room (NFR-11)', async () => {
    const { h } = await joined()
    const started = performance.now()
    for (let i = 0; i < 10_000; i++) {
      h.session.emitMessage(message('blue-hq'))
      if (i % 100 === 0) h.store.roomView('blue-hq')
    }
    expect(h.store.roomView('blue-hq').data?.messages).toHaveLength(10_000)
    expect(performance.now() - started).toBeLessThan(3_000)
  })
})

describe('rooms: live changes (PLY-30, PLY-51, PLY-52)', () => {
  it.each([
    [[110, 321], 'membership-removed'],
    [[110, 307], 'kicked'],
    [[301], 'banned'],
    [[332], 'shutdown'],
    [[110], 'removed'],
  ] as const)('closes the room on self-presence %j', async (codes, reason) => {
    const { h } = await joined()
    const before = h.session.listenerCount()
    h.session.emitOccupant(
      selfPresence('blue-hq', 'blue-co', { available: false, statusCodes: codes }),
    )
    expect(h.store.roomView('blue-hq')).toMatchObject({
      status: 'error',
      error: { code: 'not-joined' },
      data: { status: 'closed', closeReason: reason, canPost: false },
    })
    expect(h.session.listenerCount()).toBe(before - 2)
    expect(await h.store.sendMessage('blue-hq', 'hello?')).toMatchObject({
      ok: false,
      error: { code: 'not-joined', unsentText: 'hello?' },
    })
    expect(await h.store.loadOlder('blue-hq')).toMatchObject({ error: { code: 'not-joined' } })
  })

  it('marks a refused join as withdrawn, without retrying (PLY-52)', async () => {
    for (const condition of ['forbidden', 'not-allowed', 'registration-required'] as const) {
      const h = harness()
      await h.store.ready()
      h.session.stub('muc', 'join', () => Promise.resolve(err(condition)))
      const release = h.store.acquireRoom('blue-hq')
      const watch = await h.store.watchRoom('blue-hq')
      expect(watch).toMatchObject({ ok: false, error: { code: 'access-withdrawn' } })
      await flush(10)
      expect(h.store.roomView('blue-hq').data?.status).toBe('withdrawn')
      expect(h.session.calls.filter((c) => c.op === 'join')).toHaveLength(1)
      release()
    }
  })

  it('marks the room withdrawn when MAM refuses, and on paging', async () => {
    const h = harness({ pageSize: 10 })
    await h.store.ready()
    h.session.stub('mam', 'queryRoom', () => Promise.resolve(err('forbidden')))
    const watch = await h.store.watchRoom('blue-hq')
    expect(watch).toMatchObject({ ok: false, error: { code: 'access-withdrawn' } })

    const { h: h2 } = await joined({}, 25)
    h2.session.stub('mam', 'queryRoom', () => Promise.resolve(err('not-allowed')))
    expect(await h2.store.loadOlder('blue-hq')).toMatchObject({
      error: { code: 'access-withdrawn' },
    })
    expect(h2.store.roomView('blue-hq').data?.status).toBe('withdrawn')
  })

  it('keeps the room joined when history fails for another reason', async () => {
    const h = harness()
    await h.store.ready()
    h.session.stub('mam', 'queryRoom', () => Promise.resolve(err('timeout')))
    const watch = await h.store.watchRoom('blue-hq')
    expect(watch.ok).toBe(true)
    expect(h.store.roomView('blue-hq').data?.status).toBe('joined')
    expect(h.store.roomView('blue-hq').error?.code).toBe('transport')
    h.session.stub('mam', 'queryRoom', () => Promise.resolve(err('timeout')))
    expect(await h.store.loadOlder('blue-hq')).toMatchObject({ error: { code: 'transport' } })
  })

  it('reports other join failures as errors, and can rejoin on request', async () => {
    const h = harness()
    await h.store.ready()
    h.session.stub('muc', 'join', () => Promise.resolve(err('item-not-found')))
    const release = h.store.acquireRoom('blue-hq')
    await flush()
    expect(h.store.roomView('blue-hq').data?.status).toBe('error')
    expect(h.store.roomView('blue-hq').error?.code).toBe('not-found')
    h.session.stub('muc', 'join', (room, nick) =>
      Promise.resolve(ok({ room, nick, role: 'participant', affiliation: 'member' })),
    )
    expect((await h.store.rejoinRoom('blue-hq')).ok).toBe(true)
    expect((await h.store.rejoinRoom('blue-hq')).ok).toBe(true)
    expect(await h.store.rejoinRoom('red-hq')).toMatchObject({ error: { code: 'not-joined' } })
    release()
  })

  it('follows a voice change from self-presence (PLY-12)', async () => {
    const { h } = await joined()
    h.session.emitOccupant(selfPresence('blue-hq', 'blue-co', { role: 'visitor' }))
    expect(h.store.roomView('blue-hq').data?.canPost).toBe(false)
    expect(await h.store.sendMessage('blue-hq', 'hi')).toMatchObject({
      ok: false,
      error: { code: 'not-permitted', unsentText: 'hi' },
    })
    expect(h.session.calls.some((c) => c.op === 'send')).toBe(false)
  })

  it('explains read-only for observers and read entries', async () => {
    const h = harness({ roleId: 'blue-observer' })
    await h.store.ready()
    h.session.stub('muc', 'join', (room, nick) =>
      Promise.resolve(ok({ room, nick, role: 'visitor', affiliation: 'member' })),
    )
    await h.store.watchRoom('blue-hq')
    expect(h.store.roomView('blue-hq').data).toMatchObject({
      canPost: false,
      readOnlyReason: 'observer',
    })
  })
})

describe('rooms: reconnection (PLY-2)', () => {
  it('rejoins and fetches the gap from MAM without duplicates', async () => {
    const { h, archive } = await joined({}, 15)
    h.session.emitStatus({ state: 'reconnecting', attempt: 1 })
    const missed = Array.from({ length: 23 }, () => message('blue-hq'))
    h.archive.set(HQ, [...archive, ...missed])
    h.session.emitRecovered('reconnected')
    await flush(20)
    expect(h.session.calls.filter((c) => c.op === 'join')).toHaveLength(2)
    expect(ids(h)).toEqual([...archive.slice(5), ...missed].map((m) => m.stanzaId))
    expect(new Set(ids(h)).size).toBe(ids(h).length)
    expect(await h.store.loadOlder('blue-hq')).toEqual(ok({ added: 5, complete: true }))
    expect(ids(h)).toEqual([...archive, ...missed].map((m) => m.stanzaId))
  })

  it('does nothing to rooms after a resumption', async () => {
    const { h } = await joined({}, 3)
    h.session.emitRecovered('resumed')
    await flush()
    expect(h.session.calls.filter((c) => c.op === 'join')).toHaveLength(1)
  })

  it('starts history afresh when the gap is too large to bridge', async () => {
    const { h, archive } = await joined({ gapPageLimit: 2 }, 5)
    const missed = Array.from({ length: 40 }, () => message('blue-hq'))
    h.archive.set(HQ, [...archive, ...missed])
    h.session.emitRecovered('reconnected')
    await flush(20)
    expect(ids(h)).toEqual(missed.slice(20).map((m) => m.stanzaId))
    expect(h.warnings).toContain('Reconnection gap too large; history restarted')
    expect(await h.store.loadOlder('blue-hq')).toEqual(ok({ added: 10, complete: false }))
    expect(ids(h)[0]).toBe(missed[10]?.stanzaId)
  })

  it('loads the latest page on rejoin when it had no messages yet', async () => {
    const { h } = await joined()
    h.archive.set(HQ, [message('blue-hq')])
    h.session.emitRecovered('reconnected')
    await flush()
    expect(ids(h)).toHaveLength(1)
  })

  it('stops a gap fetch that MAM refuses', async () => {
    const { h } = await joined({}, 3)
    h.session.stub('mam', 'queryRoom', () => Promise.resolve(err('forbidden')))
    h.session.emitRecovered('reconnected')
    await flush()
    expect(h.store.roomView('blue-hq').data?.status).toBe('withdrawn')
  })
})

describe('rooms: sending (PLY-33, PLY-53)', () => {
  it('sends a validated chat body', async () => {
    const { h } = await joined()
    const sent = await h.store.sendMessage('blue-hq', 'Hello <Red> & co')
    expect(sent.ok).toBe(true)
    const call = h.session.calls.find((c) => c.op === 'send')
    expect(call?.args[0]).toBe(HQ)
    expect(JSON.parse(String(call?.args[1]))).toEqual({
      type: 'chat',
      schemaVersion: 1,
      content: { text: 'Hello <Red> & co' },
    })
  })

  it('refuses empty and oversized text, keeping it (PLY-33, PLY-53)', async () => {
    const { h } = await joined()
    expect(await h.store.sendMessage('blue-hq', '  \n ')).toMatchObject({
      ok: false,
      error: { code: 'invalid', unsentText: '  \n ' },
    })
    const long = 'x'.repeat(LIMITS.messageTextChars + 1)
    expect(await h.store.sendMessage('blue-hq', long)).toMatchObject({
      ok: false,
      error: { code: 'too-large', unsentText: long },
    })
    expect(h.store.roomView('blue-hq').data?.unsent?.text).toBe(long)
    expect(h.session.calls.some((c) => c.op === 'send')).toBe(false)
  })

  it('keeps the text when the server refuses, and clears it after a send', async () => {
    const { h } = await joined()
    h.session.stub('muc', 'send', () => Promise.resolve(err('forbidden', 'no voice')))
    expect(await h.store.sendMessage('blue-hq', 'Draft')).toMatchObject({
      ok: false,
      error: { code: 'not-permitted', unsentText: 'Draft', cause: { condition: 'forbidden' } },
    })
    expect(h.store.roomView('blue-hq').data?.unsent).toMatchObject({ text: 'Draft' })
    h.session.stub('muc', 'send', () => Promise.resolve(err('too-large')))
    expect(await h.store.sendMessage('blue-hq', 'x')).toMatchObject({
      error: { code: 'too-large' },
    })
    h.session.stub('muc', 'send', () => Promise.resolve(ok({ stanzaId: 'srv-1' })))
    expect(await h.store.sendMessage('blue-hq', 'Draft')).toEqual(ok({ stanzaId: 'srv-1' }))
    expect(h.store.roomView('blue-hq').data?.unsent).toBeUndefined()
  })

  it('refuses a room that is not joined', async () => {
    const h = harness()
    await h.store.ready()
    expect(await h.store.sendMessage('blue-hq', 'hi')).toMatchObject({
      error: { code: 'not-joined', unsentText: 'hi' },
    })
    expect(await h.store.loadOlder('blue-hq')).toMatchObject({ error: { code: 'not-joined' } })
    expect(await h.store.watchRoom('Bad Room')).toMatchObject({ error: { code: 'invalid' } })
  })
})

describe('rooms: reference counting (ARC-2)', () => {
  it('shares one join between holders and leaves after the last release', async () => {
    const { h, watch } = await joined()
    const baseline = h.session.listenerCount()
    const second = await h.store.watchRoom('blue-hq')
    expect(h.session.calls.filter((c) => c.op === 'join')).toHaveLength(1)
    watch.release()
    await flush()
    expect(h.session.calls.some((c) => c.op === 'leave')).toBe(false)
    if (second.ok) second.value.release()
    await flush()
    expect(h.session.calls.some((c) => c.op === 'leave')).toBe(true)
    expect(h.session.listenerCount()).toBe(baseline - 2)
    expect(h.store.roomView('blue-hq').data).toBeUndefined()
  })

  it('ignores a join reply that arrives after release', async () => {
    const h = harness()
    await h.store.ready()
    let reply: () => void = () => undefined
    h.session.stub(
      'muc',
      'join',
      (room, nick) =>
        new Promise((resolve) => {
          reply = () => {
            resolve(ok({ room, nick, role: 'participant', affiliation: 'member' }))
          }
        }),
    )
    const release = h.store.acquireRoom('blue-hq')
    release()
    await flush()
    reply()
    await flush()
    expect(h.store.roomView('blue-hq').data).toBeUndefined()
    expect(h.session.calls.some((c) => c.op === 'queryRoom')).toBe(false)
  })
})
