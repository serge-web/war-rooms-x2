// The panel's view of the runner (WP 6.2): what it needs, so a test can give a fake, and the
// default, which loads `py/runner.js` with `loadRunner` the first time the panel is shown (PY-5).
//
// The admin's runner reads and writes the world-state draft the map room shows (ADM-45). A
// clean run's write is applied as the script's change on top of the draft as it is then (WP 6.4,
// `applyWorldChanges`), so hand edits made before or during the run survive; the panel then
// shows what the script changed in the draft and how the draft differs from the published state.
// With the script's `autoPublish` on (PD7, PY-9), the draft is then published at once, after the
// same checks as "Publish world state…" (PLY-53), and recorded (`recordScriptPublish`).
import {
  applyWorldChanges,
  diffWorldStates,
  isEmptyDiff,
  parseWorldDraft,
  serialiseWorldDraft,
  worldDraftKey,
} from '@wrx/domain'
import type { ScriptRole, SessionStore, WorldStateDiff } from '@wrx/domain'
import type { DraftWrite as RunnerDraftWrite, RunOutcome, RunOptions } from '@wrx/py-runner'
import { loadRunner } from '@wrx/py-runner/load'
import type { WorldAsset, WorldState } from '@wrx/schemas'
import type { WorldDraftStorage } from '../map/draft-storage.ts'
import { draftForTurn, sizeRefusal, worldPublishErrorText } from '../map/world-draft.tsx'

export interface PanelRunner {
  /** Starts Pyodide; resolves when it is ready. */
  start(): Promise<{ readonly totalMs: number }>
  run(code: string, options: RunOptions): Promise<RunOutcome>
  stop(): void
  dispose(): void
}

/** The admin's draft, as the runner reads and writes it. */
export interface PanelDraft {
  current(): WorldState | undefined
  apply(write: RunnerDraftWrite): void
}

export interface RunnerRequest {
  readonly role: ScriptRole
  /** The admin's: what `readDraft` reads, and where a clean run's write goes. */
  readonly draft?: PanelDraft
}

export type RunnerFactory = (request: RunnerRequest) => Promise<PanelRunner>

/** Why this build has no runner (a PR preview without `py/`, owner Nov 6, 2026), if it says. */
export class RunnerUnavailable extends Error {}

/**
 * Runners over `store`'s session: each loads the runner's own build (once; the module loader
 * keeps it) and makes a runner (PY-5). Nothing loads before a runner is asked for. A build made
 * without the runner ships a stub `py/runner.js` that says so (`unavailable`).
 */
export function loadPanelRunner(store: SessionStore): RunnerFactory {
  return async ({ role, draft }) => {
    const runner = await loadRunner()
    const unavailable = (runner as { unavailable?: unknown }).unavailable
    if (typeof unavailable === 'string') throw new RunnerUnavailable(unavailable)
    return runner.createRunner({ role, store, ...(draft === undefined ? {} : { draft }) })
  }
}

/** What putting a script's world state in the draft did. */
export type DraftWrite =
  | {
      readonly ok: true
      /** From the published state to the draft now (ADM-46). */
      readonly diff: WorldStateDiff
      /** What the script changed in the draft: from the draft before the run to now. */
      readonly changes: WorldStateDiff
      /** Assets edited in the draft since the script read it that the script also changed. */
      readonly overwritten: readonly WorldAsset[]
    }
  | { readonly ok: false; readonly error: string }

function draftKey(store: SessionStore, mapRoomId: string): string {
  return worldDraftKey(store.identity.domain, mapRoomId)
}

/** The draft this browser holds for the map room, if any (ADM-45). */
export function currentScriptDraft(
  store: SessionStore,
  storage: WorldDraftStorage | undefined,
  mapRoomId: string | undefined,
): WorldState | undefined {
  if (storage === undefined || mapRoomId === undefined) return undefined
  const text = storage.snapshot(draftKey(store, mapRoomId)).text
  const held = text === undefined ? undefined : parseWorldDraft(text)
  return held?.ok === true ? held.value.state : undefined
}

/**
 * Applies a clean run's draft write (ADM-45, WP 6.4): the script's change from what it was based
 * on, on top of the draft as it is now (or the published state when none is held). Keeps the
 * draft's start if one is held (so the map's "newer state published" check stays right), else
 * starts it from the published state.
 */
export function writeScriptDraft(
  store: SessionStore,
  storage: WorldDraftStorage | undefined,
  mapRoomId: string | undefined,
  write: RunnerDraftWrite,
  now: string,
): DraftWrite {
  if (storage === undefined) {
    return { ok: false, error: 'this client keeps no world-state draft, so it was not kept' }
  }
  if (mapRoomId === undefined) {
    return { ok: false, error: 'the game has no map room, so there is no draft to write' }
  }
  const key = draftKey(store, mapRoomId)
  const text = storage.snapshot(key).text
  const held = text === undefined ? undefined : parseWorldDraft(text)
  const published = store.worldState(mapRoomId).data
  const before = held?.ok === true ? held.value.state : published?.state
  const applied = applyWorldChanges(write.base, write.state, before)
  if (!applied.ok) return { ok: false, error: applied.error }
  const baseStanzaId = held?.ok === true ? held.value.baseStanzaId : published?.stanzaId
  const problem = storage.save(
    key,
    serialiseWorldDraft({ state: applied.value.state, baseStanzaId, savedAt: now }),
  )
  if (problem !== undefined) return { ok: false, error: problem }
  return {
    ok: true,
    diff: diffWorldStates(published?.state, applied.value.state),
    changes: diffWorldStates(before, applied.value.state),
    overwritten: applied.value.overwritten,
  }
}

/** What publishing the draft without review did (PD7, PY-9). */
export type AutoPublishOutcome =
  | {
      readonly status: 'published'
      readonly stanzaId: string
      readonly turn: number
      /** From the state published before to the one published now (ADM-46). */
      readonly diff: WorldStateDiff
    }
  /** The draft is the published state: nothing to publish (ADM-45). */
  | { readonly status: 'unchanged' }
  | { readonly status: 'failed'; readonly error: string }

/**
 * Publishes the admin's draft at once, as "Publish world state…" does after its summary (ADM-45,
 * PLY-53): only if it differs from the published state, stamped with the current turn, within
 * the 500 KB cap, through the store's `sendWorldState`; the draft is then cleared, as after a
 * manual publish. At any time, mid-phase included (PD7).
 */
export async function publishScriptDraft(
  store: SessionStore,
  storage: WorldDraftStorage | undefined,
  mapRoomId: string | undefined,
): Promise<AutoPublishOutcome> {
  if (storage === undefined || mapRoomId === undefined) {
    return { status: 'failed', error: 'there is no world-state draft here to publish' }
  }
  const key = draftKey(store, mapRoomId)
  const text = storage.snapshot(key).text
  const held = text === undefined ? undefined : parseWorldDraft(text)
  if (text === undefined || held?.ok !== true) {
    return { status: 'failed', error: 'there is no world-state draft to publish' }
  }
  const published = store.worldState(mapRoomId).data
  // As "Publish world state…" does (Phase 5 H1): never against a published state not found yet,
  // or one behind many other map-room posts, which would read as an empty map (Phase 6 review).
  if (published?.state === undefined && published?.none !== true) {
    return {
      status: 'failed',
      error:
        published?.unreached === true
          ? 'the latest world state is further back in the map room, behind other messages; open the Map room, choose “Look further back”, and publish from there'
          : 'the published world state has not loaded yet; publish from the Map room once it has',
    }
  }
  const diff = diffWorldStates(published.state, held.value.state)
  if (isEmptyDiff(diff)) return { status: 'unchanged' }
  const toPublish = draftForTurn(held.value, store.gameState().data?.turn)
  const tooLarge = sizeRefusal(toPublish)
  if (tooLarge !== undefined) return { status: 'failed', error: tooLarge }
  const sent = await store.sendWorldState(mapRoomId, toPublish)
  if (!sent.ok) return { status: 'failed', error: worldPublishErrorText(sent.error) }
  storage.published(key, text, toPublish, published.stanzaId)
  return { status: 'published', stanzaId: sent.value.stanzaId, turn: toPublish.turn, diff }
}
