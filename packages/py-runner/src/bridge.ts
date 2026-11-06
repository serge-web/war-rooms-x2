// The bridge on the page (PY-4), from S17: the only way a script reaches the game. It offers the
// SDK's operations (sdk-ops.ts) and nothing else, checks each against the role the script runs
// as (PD2, PD4), and validates every payload as untrusted input. Draft writes are held per run
// and handed to the runner, which applies them only when the run finishes well (PD9).
import { worldStateSize } from '@wrx/domain'
import type { SessionStore } from '@wrx/domain'
import { worldStateSchema } from '@wrx/schemas'
import type { WorldState } from '@wrx/schemas'
import { OPERATION_ROLES, REQUESTS, isSdkOperation } from './sdk-ops.ts'
import type { CallResult, ScriptRole } from './sdk-ops.ts'

/** What the runner needs of the logged-in session's store: reads only, and room handles. */
export type RunnerStore = Pick<
  SessionStore,
  'me' | 'worldState' | 'roomView' | 'acquireRoom' | 'subscribe'
>

export interface BridgeContext {
  readonly role: ScriptRole
  readonly store: RunnerStore
  /** The game's map room, whose world state the script reads (D25). */
  readonly mapRoomId: string
}

export interface CallRecord {
  readonly op: string
  readonly ok: boolean
  readonly error?: string
}

function parseJson(payload: string): CallResult {
  try {
    return { ok: true, value: JSON.parse(payload) as unknown }
  } catch {
    return { ok: false, error: 'the payload is not JSON' }
  }
}

/** A world state as a publish would check it: the schema, then the 500 KB cap (PLY-53). */
export function checkedWorldState(
  value: unknown,
): { ok: true; value: WorldState } | { ok: false; error: string } {
  const parsed = worldStateSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.join('.') ?? ''
    return { ok: false, error: `invalid world state: ${where} ${issue?.message ?? ''}`.trim() }
  }
  const size = worldStateSize(parsed.data)
  if (!size.ok) {
    return {
      ok: false,
      error: `the world state is ${size.bytes} bytes, over the ${size.limitBytes}-byte cap`,
    }
  }
  return { ok: true, value: parsed.data }
}

/** Resolves once the store's view of a room has loaded its history. */
function roomLoaded(store: RunnerStore, roomId: string, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error('the room did not load in time'))
    }, timeoutMs)
    const check = () => {
      if (store.roomView(roomId).data?.historyLoaded === true) {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    }
    unsubscribe = store.subscribe(check)
    check()
  })
}

export class ScriptBridge {
  /** The last draft each run wrote; the runner takes it when the run ends (PD9). */
  private readonly drafts = new Map<number, WorldState>()
  /** Every call and its outcome, newest last (bounded): for diagnostics and the tests. */
  readonly calls: CallRecord[] = []

  constructor(private readonly context: BridgeContext) {}

  get role(): ScriptRole {
    return this.context.role
  }

  /** The run's draft, removed: the runner applies it on success and drops it otherwise. */
  takeDraft(runId: number): WorldState | undefined {
    const draft = this.drafts.get(runId)
    this.drafts.delete(runId)
    return draft
  }

  discard(runId: number): void {
    this.drafts.delete(runId)
  }

  async handle(runId: number, op: string, payload: string): Promise<CallResult> {
    const result = await this.dispatch(runId, op, payload).catch((error: unknown): CallResult => ({
      ok: false,
      error: String(error),
    }))
    if (this.calls.length >= 1000) this.calls.shift()
    this.calls.push(result.ok ? { op, ok: true } : { op, ok: false, error: result.error })
    return result
  }

  private async dispatch(runId: number, op: string, payload: string): Promise<CallResult> {
    if (!isSdkOperation(op)) return { ok: false, error: `no operation ${op.slice(0, 100)}` }
    const { role, store, mapRoomId } = this.context
    if (!OPERATION_ROLES[op].includes(role)) {
      return { ok: false, error: `${op} is not open to the ${role} role` }
    }
    const json = parseJson(payload)
    if (!json.ok) return json
    const request = REQUESTS[op].safeParse(json.value)
    if (!request.success) return { ok: false, error: `${op}: the request has the wrong shape` }
    switch (op) {
      case 'readWorldState':
        return { ok: true, value: store.worldState(mapRoomId).data?.state ?? null }
      case 'readRoomMessages': {
        const { roomId } = REQUESTS.readRoomMessages.parse(request.data)
        // The role's own rooms only, as the store's access matrix gives them (PD2).
        if (!store.me().data.rooms.some((r) => r.room.id === roomId)) {
          return { ok: false, error: 'not a room of this role' }
        }
        const release = store.acquireRoom(roomId)
        try {
          await roomLoaded(store, roomId)
          const messages = store.roomView(roomId).data?.messages ?? []
          return {
            ok: true,
            value: messages.map((m) => ({
              id: m.id,
              timestamp: m.timestamp,
              sender: m.sender.loginName ?? m.sender.nick,
              isAdmin: m.sender.isAdmin,
              body: m.kind === 'message' ? m.body : null,
            })),
          }
        } finally {
          release()
        }
      }
      case 'writeDraft': {
        const state = checkedWorldState(request.data)
        if (!state.ok) return state
        this.drafts.set(runId, state.value)
        return { ok: true, value: { assets: Object.keys(state.value.assets).length } }
      }
    }
  }
}
