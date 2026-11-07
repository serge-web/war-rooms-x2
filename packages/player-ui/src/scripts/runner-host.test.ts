// Publishing without review (PD7, PY-9) against the published state as the store sees it: never
// against a state not found yet or one behind many other map-room posts (Phase 5 H1), which the
// map room's own "Publish world state…" refuses too (Phase 6 security review, WP 6.5).
import { serialiseWorldDraft, worldDraftKey } from '@wrx/domain'
import type { SessionStore, WorldStateView } from '@wrx/domain'
import type { WorldState } from '@wrx/schemas'
import { ROOM, sampleWorldState } from '@wrx/schemas/fixtures'
import { describe, expect, it } from 'vitest'
import { memoryWorldDraftStorage } from '../map/draft-storage.ts'
import { publishScriptDraft } from './runner-host.ts'

const DOMAIN = 'wrx.test'

function view(partial: Partial<WorldStateView>): WorldStateView {
  return {
    roomId: ROOM.map,
    state: undefined,
    stanzaId: undefined,
    timestamp: undefined,
    searching: false,
    none: false,
    unreached: false,
    ignored: 0,
    ...partial,
  }
}

function setUp(published: WorldStateView) {
  const sent: WorldState[] = []
  const store = {
    identity: { domain: DOMAIN },
    worldState: () => ({ data: published, status: 'ready', error: undefined }),
    gameState: () => ({ data: { turn: 1, phase: 'planning' }, status: 'ready' }),
    sendWorldState: (_room: string, state: WorldState) => {
      sent.push(state)
      return Promise.resolve({ ok: true, value: { stanzaId: 'ws-2' } })
    },
  } as unknown as SessionStore
  const storage = memoryWorldDraftStorage()
  const draft = sampleWorldState()
  const tank = Object.values(draft.assets).find((a) => a.title === 'Tank Company')
  if (tank === undefined) throw new Error('no Tank Company in the sample')
  draft.assets[tank.id] = { ...tank, health: 40 }
  storage.save(
    worldDraftKey(DOMAIN, ROOM.map),
    serialiseWorldDraft({ state: draft, baseStanzaId: 'ws-1', savedAt: '2026-11-06T10:00:00Z' }),
  )
  return { store, storage, sent }
}

describe('publishing a script’s draft without review (PD7, PY-9)', () => {
  it('publishes a changed draft against the published state', async () => {
    const { store, storage, sent } = setUp(view({ state: sampleWorldState(), stanzaId: 'ws-1' }))
    const outcome = await publishScriptDraft(store, storage, ROOM.map)
    expect(outcome).toMatchObject({ status: 'published', stanzaId: 'ws-2', turn: 1 })
    expect(sent).toHaveLength(1)
  })

  it('refuses when the latest state is behind other map-room posts (Phase 5 H1)', async () => {
    const { store, storage, sent } = setUp(view({ unreached: true }))
    const outcome = await publishScriptDraft(store, storage, ROOM.map)
    expect(outcome).toMatchObject({ status: 'failed' })
    expect(outcome.status === 'failed' ? outcome.error : '').toMatch(/Look further back/)
    expect(sent).toEqual([])
  })

  it('refuses while the published state is still being looked for', async () => {
    const { store, storage, sent } = setUp(view({ searching: true }))
    expect(await publishScriptDraft(store, storage, ROOM.map)).toMatchObject({ status: 'failed' })
    expect(sent).toEqual([])
  })

  it('publishes into an empty map room, searched to its start (none)', async () => {
    const { store, storage, sent } = setUp(view({ none: true }))
    expect(await publishScriptDraft(store, storage, ROOM.map)).toMatchObject({
      status: 'published',
    })
    expect(sent).toHaveLength(1)
  })
})
