// The panel's view of the runner (WP 6.2): what it needs, so a test can give a fake, and the
// default, which loads `py/runner.js` with `loadRunner` the first time the panel is shown (PY-5).
// The admin's runner writes into the world-state draft the map room shows (`draftTarget`): the
// draft is replaced by the script's state only when the run finishes cleanly (PD9).
import { diffWorldStates, parseWorldDraft, serialiseWorldDraft, worldDraftKey } from '@wrx/domain'
import type { ScriptRole, SessionStore, WorldStateDiff } from '@wrx/domain'
import type { RunOutcome, RunOptions } from '@wrx/py-runner'
import { loadRunner } from '@wrx/py-runner/load'
import type { WorldState } from '@wrx/schemas'
import type { WorldDraftStorage } from '../map/draft-storage.ts'

export interface PanelRunner {
  /** Starts Pyodide; resolves when it is ready. */
  start(): Promise<{ readonly totalMs: number }>
  run(code: string, options: RunOptions): Promise<RunOutcome>
  stop(): void
  dispose(): void
}

export interface RunnerRequest {
  readonly role: ScriptRole
  /** The admin's: where a clean run's world state goes. */
  readonly draft?: { apply(state: WorldState): void }
}

export type RunnerFactory = (request: RunnerRequest) => Promise<PanelRunner>

/**
 * Runners over `store`'s session: each loads the runner's own build (once; the module loader
 * keeps it) and makes a runner (PY-5). Nothing loads before a runner is asked for.
 */
export function loadPanelRunner(store: SessionStore): RunnerFactory {
  return async ({ role, draft }) => {
    const runner = await loadRunner()
    return runner.createRunner({ role, store, ...(draft === undefined ? {} : { draft }) })
  }
}

/** What putting a script's world state in the draft did. */
export type DraftWrite =
  | { readonly ok: true; readonly diff: WorldStateDiff }
  | { readonly ok: false; readonly error: string }

/**
 * Writes `state` as the admin's world-state draft for the game's map room (ADM-45), keeping the
 * draft's start if one is held (so the map's "newer state published" check stays right), else
 * starting it from the published state. Returns the change from the published state (ADM-46).
 */
export function writeScriptDraft(
  store: SessionStore,
  storage: WorldDraftStorage | undefined,
  mapRoomId: string | undefined,
  state: WorldState,
  now: string,
): DraftWrite {
  if (storage === undefined) {
    return { ok: false, error: 'this client keeps no world-state draft, so it was not kept' }
  }
  if (mapRoomId === undefined) {
    return { ok: false, error: 'the game has no map room, so there is no draft to write' }
  }
  const key = worldDraftKey(store.identity.domain, mapRoomId)
  const text = storage.snapshot(key).text
  const held = text === undefined ? undefined : parseWorldDraft(text)
  const published = store.worldState(mapRoomId).data
  const baseStanzaId = held?.ok === true ? held.value.baseStanzaId : published?.stanzaId
  const problem = storage.save(key, serialiseWorldDraft({ state, baseStanzaId, savedAt: now }))
  if (problem !== undefined) return { ok: false, error: problem }
  return { ok: true, diff: diffWorldStates(published?.state, state) }
}
