// The turn rules (D7, ADM-43, PLY-56; WP 5.4) and the store's phase control and send guard.
import { LIMITS } from '@wrx/schemas'
import { err, ok } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { flush, harness, sampleDocuments, tid } from './fixtures.ts'
import { nextGameState, phaseLabel, postingPaused, sameGameState } from './turns.ts'

const at = (turn: number, phase: 'planning' | 'adjudication') =>
  ({ schemaVersion: 1, turn, phase }) as const

describe('turn rules (D7, ADM-43)', () => {
  it('goes planning, adjudication, then the next turn’s planning', () => {
    expect(nextGameState(at(1, 'planning'))).toEqual(at(1, 'adjudication'))
    expect(nextGameState(at(1, 'adjudication'))).toEqual(at(2, 'planning'))
    expect(nextGameState(at(41, 'adjudication'))).toEqual(at(42, 'planning'))
  })

  it('has no next after the last turn’s adjudication', () => {
    expect(nextGameState(at(LIMITS.turnMax, 'planning'))).toEqual(
      at(LIMITS.turnMax, 'adjudication'),
    )
    expect(nextGameState(at(LIMITS.turnMax, 'adjudication'))).toBeUndefined()
  })

  it('compares turn and phase', () => {
    expect(sameGameState(at(2, 'planning'), at(2, 'planning'))).toBe(true)
    expect(sameGameState(at(2, 'planning'), at(2, 'adjudication'))).toBe(false)
    expect(sameGameState(at(2, 'planning'), undefined)).toBe(false)
    expect(phaseLabel('adjudication')).toBe('Adjudication')
  })

  it('pauses posting in adjudication for roles outside the White Force only (PLY-56)', () => {
    expect(postingPaused({ isUmpire: false }, at(3, 'adjudication'))).toBe(true)
    expect(postingPaused({ isUmpire: true }, at(3, 'adjudication'))).toBe(false)
    expect(postingPaused({ isUmpire: false }, at(3, 'planning'))).toBe(false)
    // Before a first publish there is no phase to pause.
    expect(postingPaused({ isUmpire: false }, undefined)).toBe(false)
  })
})

function docsAt(turn: number, phase: 'planning' | 'adjudication') {
  const docs = sampleDocuments()
  docs.set('game-state', [at(turn, phase)])
  return docs
}

describe('advancePhase (ADM-43)', () => {
  it('publishes the next phase to game-state as the admin, and reads it back live', async () => {
    const h = harness({ roleId: 'admin', docs: docsAt(2, 'planning') })
    await h.store.ready()
    const result = await h.store.advancePhase({ from: at(2, 'planning') })
    expect(result).toEqual(ok({ from: at(2, 'planning'), to: at(2, 'adjudication') }))
    const call = h.session.calls.find((c) => c.op === 'publish')
    expect(call?.args.slice(0, 2)).toEqual(['game-state', 'current'])
    expect(JSON.parse(String(call?.args[2]))).toEqual(at(2, 'adjudication'))
    // The server's notification is what moves the store's own copy.
    expect(h.store.gameState().data).toEqual(at(2, 'planning'))
    h.publish('game-state', at(2, 'adjudication'))
    expect(h.store.gameState().data).toEqual(at(2, 'adjudication'))
    expect(await h.store.advancePhase({ from: at(2, 'adjudication') })).toEqual(
      ok({ from: at(2, 'adjudication'), to: at(3, 'planning') }),
    )
  })

  it('is refused for every role before anything is sent', async () => {
    for (const roleId of ['blue-co', 'white-1', 'white-observer']) {
      const h = harness({ roleId, docs: docsAt(1, 'planning') })
      await h.store.ready()
      expect(await h.store.advancePhase({ from: at(1, 'planning') })).toMatchObject({
        ok: false,
        error: { code: 'not-permitted' },
      })
      expect(h.session.calls.some((c) => c.op === 'publish')).toBe(false)
    }
  })

  it('refuses a stale change, none published, and the last turn, sending nothing', async () => {
    const h = harness({ roleId: 'admin', docs: docsAt(3, 'adjudication') })
    await h.store.ready()
    // Another admin tab moved the game on since this one confirmed.
    expect(await h.store.advancePhase({ from: at(3, 'planning') })).toMatchObject({
      ok: false,
      error: { code: 'stale' },
    })
    const none = harness({ roleId: 'admin' })
    await none.store.ready()
    expect(await none.store.advancePhase({ from: at(1, 'planning') })).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    const last = harness({ roleId: 'admin', docs: docsAt(LIMITS.turnMax, 'adjudication') })
    await last.store.ready()
    expect(
      await last.store.advancePhase({ from: at(LIMITS.turnMax, 'adjudication') }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
    for (const each of [h, none, last]) {
      expect(each.session.calls.some((c) => c.op === 'publish')).toBe(false)
    }
  })

  it('reports a refusal by the server', async () => {
    const h = harness({ roleId: 'admin', docs: docsAt(1, 'planning') })
    await h.store.ready()
    h.session.stub('pubsub', 'publish', () => Promise.resolve(err('forbidden')))
    expect(await h.store.advancePhase({ from: at(1, 'planning') })).toMatchObject({
      ok: false,
      error: { code: 'not-permitted', cause: { condition: 'forbidden' } },
    })
  })
})

describe('the advisory send guard (PLY-56, R27)', () => {
  async function inBlueHq(roleId: string, phase: 'planning' | 'adjudication') {
    const h = harness({ roleId, docs: docsAt(2, phase) })
    await h.store.ready()
    const watch = await h.store.watchRoom(tid('blue-hq'))
    if (!watch.ok) throw new Error('join failed')
    await flush()
    return h
  }

  it('refuses posts from roles outside the White Force during adjudication, keeping them', async () => {
    const h = await inBlueHq('blue-co', 'adjudication')
    expect(await h.store.sendMessage(tid('blue-hq'), 'Moving now')).toMatchObject({
      ok: false,
      error: { code: 'paused', unsentText: 'Moving now' },
    })
    expect(h.store.roomView(tid('blue-hq')).data?.unsent?.text).toBe('Moving now')
    expect(
      await h.store.sendTemplateMessage(tid('blue-hq'), tid('sitrep'), { summary: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'paused', unsentValues: { summary: 'x' } } })
    expect(h.session.calls.some((c) => c.op === 'send')).toBe(false)

    // The next turn's planning: posting resumes.
    h.publish('game-state', at(3, 'planning'))
    expect((await h.store.sendMessage(tid('blue-hq'), 'Moving now')).ok).toBe(true)
  })

  it('lets the White Force and the admin post during adjudication', async () => {
    for (const roleId of ['white-1', 'admin']) {
      const h = await inBlueHq(roleId, 'adjudication')
      expect((await h.store.sendMessage(tid('blue-hq'), 'Ruling: the bridge holds.')).ok).toBe(true)
    }
  })

  it('lets everyone post during planning', async () => {
    const h = await inBlueHq('blue-co', 'planning')
    expect((await h.store.sendMessage(tid('blue-hq'), 'Plan A')).ok).toBe(true)
  })

  it('the turn state is a document every session holds (D7)', async () => {
    const h = harness({ docs: docsAt(4, 'adjudication') })
    await h.store.ready()
    expect(h.session.calls.some((c) => c.op === 'getItems' && c.args[0] === 'game-state')).toBe(
      true,
    )
    expect(h.store.gameState().data).toEqual(at(4, 'adjudication'))
  })
})
