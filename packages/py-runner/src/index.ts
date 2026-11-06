// The Python API's browser runner (SRD Annex C PD3, PY-4, PY-5; WP 6.2): `createRunner` gives
// the admin or a White Force role a Pyodide worker behind the bridge. This module is the entry
// of its own build (`py/runner.js` in the app's output, beside its worker and `py/pyodide/`):
// nothing in the app imports it, so the main bundle does not grow; a page loads it with
// `loadRunner` (`@wrx/py-runner/load`) when a script panel first opens (6.3).
//
// zod must not compile parsers with `new Function` under the policy (F7): first, as in main.tsx.
import '@wrx/schemas/jitless'
import { MAP_ROOM_TYPE } from '@wrx/schemas'
import type { WorldState } from '@wrx/schemas'
import { ScriptBridge } from './bridge.ts'
import type { CallRecord, RunnerStore } from './bridge.ts'
import { ScriptRunner } from './runner.ts'
import type { RunOutcome, StartResult } from './runner.ts'
import { SCRIPT_ROLES } from './sdk-ops.ts'
import type { ScriptRole } from './sdk-ops.ts'
import workerPath from './worker.ts?worker&url'

export type { CallRecord, RunnerStore } from './bridge.ts'
export type { RunOutcome, RunStatus, StartResult } from './runner.ts'
export type { Timings } from './protocol.ts'
export { OPERATION_ROLES, SCRIPT_ROLES, SDK_OPERATIONS } from './sdk-ops.ts'
export type { ScriptRole, SdkOperation } from './sdk-ops.ts'

/** Where a run's draft goes when it finishes well (PD9): the admin's world-state draft. */
export interface RunnerDraft {
  apply(state: WorldState): void
}

export interface RunnerOptions {
  /** The role the scripts run as; checked against the store's session (PD2, PD4). */
  readonly role: ScriptRole
  /** The logged-in session's store: what the bridge reads through. */
  readonly store: RunnerStore
  /** The admin's draft; required for the admin, refused for the White Force. */
  readonly draft?: RunnerDraft
  /** The game's map room; default, the map room among the role's rooms. */
  readonly mapRoomId?: string
  /** The folder holding `runner.js` and `pyodide/`; default, where this module was loaded. */
  readonly baseUrl?: string
  /** Shipped packages to load at start (lock-file names, e.g. `pandas`); default none. */
  readonly packages?: readonly string[]
  /** Give up on a worker that is not ready by then; default 60 s. */
  readonly startTimeoutMs?: number
  /** A run's time limit when `run` names none (PY-10); default 30 s. */
  readonly defaultTimeoutMs?: number
}

export interface RunOptions {
  /** This run's time limit (PY-10). */
  readonly timeoutMs?: number
}

export interface Runner {
  readonly role: ScriptRole
  /** A script is running. */
  readonly running: boolean
  /**
   * Starts the worker (Pyodide loads in about 2 s, S17): call it when the panel opens (PY-5).
   * Resolves with its timings; a second call returns the same start.
   */
  start(): Promise<StartResult>
  /** Runs a script, starting the worker first if it is not running. One run at a time. */
  run(code: string, options?: RunOptions): Promise<RunOutcome>
  /** Stops the running script: the worker is terminated and the next run starts a new one. */
  stop(): void
  /** The calls the bridge has handled, for diagnostics. */
  calls(): readonly CallRecord[]
  /** Worker messages that failed validation (none, unless a script escaped its sandbox). */
  rejected(): readonly unknown[]
  /** Ends the worker for good. */
  dispose(): void
}

/** The role a store's session may run scripts as, if any (PD4). */
export function scriptRoleOf(store: Pick<RunnerStore, 'me'>): ScriptRole | undefined {
  const me = store.me().data
  if (me.identity.anonymous) return undefined
  if (me.identity.isAdmin) return 'admin'
  return me.isUmpire && me.role !== undefined ? 'white-force' : undefined
}

const PYODIDE_FOLDER = 'pyodide/'

export function createRunner(options: RunnerOptions): Runner {
  const { role, store, draft } = options
  if (!SCRIPT_ROLES.includes(role)) throw new Error(`scripts do not run as ${role}`)
  const actual = scriptRoleOf(store)
  if (actual !== role) {
    throw new Error(
      actual === undefined
        ? 'only the admin and White Force roles run scripts (PD4)'
        : `this session is the ${actual} role, not ${role}`,
    )
  }
  if (role === 'admin' && draft === undefined) throw new Error('the admin runner needs a draft')
  if (role !== 'admin' && draft !== undefined) throw new Error('only the admin has a draft')
  const mapRoomId =
    options.mapRoomId ??
    store.me().data.rooms.find((r) => r.room.roomType === MAP_ROOM_TYPE)?.room.id ??
    ''
  const base = options.baseUrl ?? import.meta.url
  const workerUrl = new URL(workerPath, import.meta.url).href
  const indexURL = new URL(PYODIDE_FOLDER, base).href
  const bridge = new ScriptBridge({ role, store, mapRoomId })
  const runner = new ScriptRunner((state) => {
    draft?.apply(state)
  })
  let disposed = false
  const start = (): Promise<StartResult> => {
    if (disposed) return Promise.reject(new Error('the runner was disposed'))
    return runner.start({
      workerUrl,
      indexURL,
      packages: options.packages ?? [],
      timeoutMs: options.startTimeoutMs ?? 60_000,
    })
  }
  return {
    role,
    get running() {
      return runner.running
    },
    start,
    run: (code, runOptions) => {
      if (disposed) return Promise.reject(new Error('the runner was disposed'))
      // A failed start is reported by the run itself, as a failed outcome.
      start().catch(() => undefined)
      const me = store.me().data
      const context = {
        role,
        mapRoomId,
        rooms: me.rooms.map((r) => ({ id: r.room.id, name: r.room.name, access: r.access })),
      }
      return runner.run(
        bridge,
        code,
        context,
        runOptions?.timeoutMs ?? options.defaultTimeoutMs ?? 30_000,
      )
    },
    stop: () => {
      runner.stop()
    },
    calls: () => bridge.calls,
    rejected: () => runner.rejected,
    dispose: () => {
      disposed = true
      runner.stop()
      runner.terminate()
    },
  }
}
