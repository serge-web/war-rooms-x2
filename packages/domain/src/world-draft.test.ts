// The admin's world-state draft (ADM-44–46, R25; WP 5.6): edits, the change summary, the size
// check and the stored form.
import { LIMITS } from '@wrx/schemas'
import { sampleWorldState } from '@wrx/schemas/fixtures'
import type { WorldAsset, WorldState } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
import {
  addWorldAsset,
  applyWorldChanges,
  diffSize,
  diffWorldStates,
  emptyWorldState,
  formatKilobytes,
  isEmptyDiff,
  moveWorldAsset,
  normalisePosition,
  parseWorldDraft,
  removeWorldAsset,
  serialiseWorldDraft,
  updateWorldAsset,
  worldDraftKey,
  worldStateSize,
} from './world-draft.ts'

const NEW_ID = 'a5600000-0000-4000-8000-000000000001'

function first(state: WorldState): WorldAsset {
  const [asset] = Object.values(state.assets)
  if (asset === undefined) throw new Error('fixture')
  return asset
}

function unwrap(result: { ok: true; value: WorldState } | { ok: false; error: string }) {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function many(base: WorldAsset, n: number): WorldState {
  return {
    turn: 1,
    assets: Object.fromEntries(
      Array.from({ length: n }, (_, i) => {
        const id = `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
        return [id, { ...base, id, title: `Unit ${i}` }]
      }),
    ),
  }
}

describe('world-state edits (ADM-44)', () => {
  it('adds, moves, updates and removes, leaving the input untouched', () => {
    const start = sampleWorldState()
    const frozen = JSON.stringify(start)
    const base = first(start)
    const added = unwrap(addWorldAsset(start, { ...base, id: NEW_ID, title: 'Bridging Troop' }))
    expect(added.assets[NEW_ID]?.title).toBe('Bridging Troop')
    const moved = unwrap(moveWorldAsset(added, NEW_ID, 52.1234567891, 1.5))
    expect(moved.assets[NEW_ID]).toMatchObject({ lat: 52.123457, lon: 1.5 })
    const updated = unwrap(updateWorldAsset(moved, base.id, { health: 40, state: 'damaged' }))
    expect(updated.assets[base.id]).toMatchObject({ health: 40, state: 'damaged', id: base.id })
    const removed = unwrap(removeWorldAsset(updated, base.id))
    expect(removed.assets[base.id]).toBeUndefined()
    expect(JSON.stringify(start)).toBe(frozen)
  })

  it('refuses an invalid field, a taken id, an unknown id and a full state', () => {
    const start = sampleWorldState()
    const base = first(start)
    expect(updateWorldAsset(start, base.id, { sidc: 'not a code' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^sidc: /) as unknown,
    })
    expect(updateWorldAsset(start, base.id, { health: 101 }).ok).toBe(false)
    expect(updateWorldAsset(start, base.id, { lat: 91 }).ok).toBe(false)
    expect(updateWorldAsset(start, base.id, { title: '' }).ok).toBe(false)
    expect(addWorldAsset(start, base)).toEqual({ ok: false, error: 'the id is taken' })
    expect(removeWorldAsset(start, NEW_ID).ok).toBe(false)
    expect(moveWorldAsset(start, NEW_ID, 0, 0).ok).toBe(false)
    const full = many(base, LIMITS.worldStateAssets)
    expect(addWorldAsset(full, { ...base, id: NEW_ID }).ok).toBe(false)
  })

  it('wraps a dragged longitude and clamps the latitude', () => {
    expect(normalisePosition(95, 190)).toEqual({ lat: 90, lon: -170 })
    expect(normalisePosition(-10, -200)).toEqual({ lat: -10, lon: 160 })
    expect(normalisePosition(1, 180)).toEqual({ lat: 1, lon: -180 })
  })
})

describe('the change summary (ADM-46)', () => {
  it('lists added, removed and changed assets, with the changed fields, by title', () => {
    const published = sampleWorldState()
    const base = first(published)
    let draft = unwrap(addWorldAsset(published, { ...base, id: NEW_ID, title: 'Bridging Troop' }))
    draft = unwrap(moveWorldAsset(draft, base.id, base.lat + 0.01, base.lon))
    draft = unwrap(updateWorldAsset(draft, base.id, { health: 10 }))
    const gone = Object.values(published.assets)[1]
    if (gone === undefined) throw new Error('fixture')
    draft = unwrap(removeWorldAsset(draft, gone.id))
    const diff = diffWorldStates(published, draft)
    expect(diff.added.map((a) => a.title)).toEqual(['Bridging Troop'])
    expect(diff.removed.map((a) => a.id)).toEqual([gone.id])
    expect(diff.changed).toEqual([
      { before: base, after: draft.assets[base.id], fields: ['lat', 'health'] },
    ])
    expect(diffSize(diff)).toBe(3)
  })

  it('compares assets only: a new turn alone is no change', () => {
    const published = sampleWorldState()
    expect(isEmptyDiff(diffWorldStates(published, { ...published, turn: 7 }))).toBe(true)
  })

  it('counts every asset as added when nothing is published', () => {
    const draft = sampleWorldState()
    expect(diffWorldStates(undefined, draft).added).toHaveLength(Object.keys(draft.assets).length)
    expect(isEmptyDiff(diffWorldStates(undefined, emptyWorldState()))).toBe(true)
  })
})

describe('the size check (PLY-53)', () => {
  it('measures the message against the 500 KB map-room cap', () => {
    const small = worldStateSize(sampleWorldState())
    expect(small).toMatchObject({ ok: true, limitBytes: LIMITS.worldStateStanzaBytes })
    const size = worldStateSize(many(first(sampleWorldState()), 2_000))
    expect(size.ok).toBe(false)
    expect(size.bytes).toBeGreaterThan(LIMITS.worldStateStanzaBytes)
    expect(formatKilobytes(512_345)).toBe('512 KB')
    expect(formatKilobytes(1_234)).toBe('1.2 KB')
  })
})

describe('the stored draft (ADM-45, R25)', () => {
  it('round-trips, and refuses what is not a valid draft', () => {
    const draft = {
      state: sampleWorldState(),
      baseStanzaId: 's-1',
      savedAt: '2026-11-04T10:00:00Z',
    }
    expect(parseWorldDraft(serialiseWorldDraft(draft))).toEqual({ ok: true, value: draft })
    const none = { ...draft, baseStanzaId: undefined }
    expect(parseWorldDraft(serialiseWorldDraft(none))).toEqual({ ok: true, value: none })
    expect(parseWorldDraft('{').ok).toBe(false)
    const other = JSON.stringify({ format: 'wrx1-world-draft', schemaVersion: 2 })
    expect(parseWorldDraft(other).ok).toBe(false)
    const bad = JSON.parse(serialiseWorldDraft(draft)) as { state: WorldState }
    bad.state.turn = 0
    expect(parseWorldDraft(JSON.stringify(bad)).ok).toBe(false)
  })

  it('is keyed by server and map room', () => {
    expect(worldDraftKey('wrx.test', 'm-1')).toBe('world-draft:v1:wrx.test:m-1')
  })
})

describe('a script’s write on top of the draft (WP 6.4)', () => {
  const base = sampleWorldState()
  const ids = Object.keys(base.assets)
  const [a, b, c] = [ids[0] ?? '', ids[1] ?? '', ids[2] ?? '']
  const edit = (state: WorldState, id: string, patch: Partial<WorldAsset>): WorldState => {
    const next = updateWorldAsset(state, id, patch)
    if (!next.ok) throw new Error(next.error)
    return next.value
  }

  it('applies only what the script changed, so hand edits survive', () => {
    const hand = edit(base, b, { lat: 10 })
    const removed = removeWorldAsset(edit(base, a, { fuel: 5 }), c)
    if (!removed.ok) throw new Error(removed.error)
    const applied = applyWorldChanges(base, removed.value, hand)
    if (!applied.ok) throw new Error(applied.error)
    expect(applied.value.state.assets[a]?.fuel).toBe(5)
    expect(applied.value.state.assets[b]?.lat).toBe(10)
    expect(applied.value.state.assets[c]).toBeUndefined()
    expect(applied.value.overwritten).toEqual([])
    expect(diffSize(applied.value.changes)).toBe(2)
  })

  it('reports an asset both sides changed; the script wins', () => {
    const applied = applyWorldChanges(
      base,
      edit(base, a, { fuel: 2 }),
      edit(base, a, { health: 1 }),
    )
    if (!applied.ok) throw new Error(applied.error)
    expect(applied.value.state.assets[a]?.fuel).toBe(2)
    expect(applied.value.state.assets[a]?.health).toBe(100)
    expect(applied.value.overwritten.map((x) => x.id)).toEqual([a])
  })

  it('with no draft held, the base is the draft; with nothing at all, an empty state', () => {
    const applied = applyWorldChanges(undefined, base, undefined)
    if (!applied.ok) throw new Error(applied.error)
    expect(applied.value.state).toEqual(base)
    expect(applied.value.changes.added).toHaveLength(ids.length)
  })

  it('takes the script’s turn only when it changed it', () => {
    const later = { ...base, turn: 3 }
    const kept = applyWorldChanges(base, base, later)
    const moved = applyWorldChanges(base, { ...base, turn: 4 }, later)
    expect(kept.ok && kept.value.state.turn).toBe(3)
    expect(moved.ok && moved.value.state.turn).toBe(4)
  })
})
