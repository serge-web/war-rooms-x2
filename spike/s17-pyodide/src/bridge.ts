// The bridge on the page (PY-4): the only way a script reaches the game. It offers the SDK's
// operations and nothing else, checks each against the role the script runs as (PD2, PD4), and
// validates every payload as untrusted input. Draft writes are held per run and applied only when
// the run finishes (PD9); the runner discards them when a run is stopped, times out or fails.
import { worldStateSize } from '../../../packages/domain/src/index.ts'
import type { SessionStore } from '../../../packages/domain/src/index.ts'
import { worldStateSchema } from '../../../packages/schemas/src/index.ts'
import type { WorldState } from '../../../packages/schemas/src/index.ts'
import { z } from 'zod'
import { BRIDGE_OPS } from './protocol.ts'
import type { BridgeOp } from './protocol.ts'

export type ScriptRole = 'admin' | 'white'

/** Which role may call which operation (PD4, PD6, PD7). */
const ALLOWED: Readonly<Record<ScriptRole, readonly BridgeOp[]>> = {
  admin: ['readWorldState', 'readRoomMessages', 'writeDraft'],
  white: ['readWorldState', 'readRoomMessages', 'postProposal'],
}

/** A proposal's marker in the chat text: S17 has no dedicated message type yet (PY-8). */
export const PROPOSAL_PREFIX = 'wrx-proposal:'

export interface BridgeContext {
  readonly role: ScriptRole
  readonly store: SessionStore
  readonly mapRoomId: string
  readonly umpireRoomId: string
}

export type CallResult = { ok: true; value: unknown } | { ok: false; error: string }

const roomRequest = z.object({ roomId: z.string().max(100) }).strict()
const proposalRequest = z
  .object({ state: z.unknown(), note: z.string().max(500) })
  .strict()

function parseJson(payload: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(payload) as unknown }
  } catch {
    return { ok: false, error: 'the payload is not JSON' }
  }
}

function checkedState(value: unknown): { ok: true; value: WorldState } | { ok: false; error: string } {
  const parsed = worldStateSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `invalid world state: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}` }
  }
  const size = worldStateSize(parsed.data)
  if (!size.ok) return { ok: false, error: `the world state is ${size.bytes} bytes, over ${size.limitBytes}` }
  return { ok: true, value: parsed.data }
}

/** Resolves once the store's view of a room has loaded its history. */
function roomLoaded(store: SessionStore, roomId: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (store.roomView(roomId).data?.historyLoaded === true) {
        unsubscribe()
        resolve()
      }
    }
    const unsubscribe = store.subscribe(check)
    check()
  })
}

export class ScriptBridge {
  /** The last draft a run wrote, by run id; applied when that run finishes well (PD9). */
  private readonly drafts = new Map<number, WorldState>()
  readonly calls: { op: string; ok: boolean; error?: string }[] = []

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
    const result = await this.dispatch(runId, op, payload).catch(
      (error: unknown): CallResult => ({ ok: false, error: String(error) }),
    )
    this.calls.push(result.ok ? { op, ok: true } : { op, ok: false, error: result.error })
    return result
  }

  private async dispatch(runId: number, op: string, payload: string): Promise<CallResult> {
    if (!(BRIDGE_OPS as readonly string[]).includes(op)) return { ok: false, error: `no operation ${op}` }
    if (!ALLOWED[this.context.role].includes(op as BridgeOp)) {
      return { ok: false, error: `${op} is not open to the ${this.context.role} role` }
    }
    const json = parseJson(payload)
    if (!json.ok) return json
    const { store, mapRoomId, umpireRoomId } = this.context
    switch (op as BridgeOp) {
      case 'readWorldState':
        return { ok: true, value: store.worldState(mapRoomId).data?.state ?? null }
      case 'readRoomMessages': {
        const request = roomRequest.safeParse(json.value)
        if (!request.success) return { ok: false, error: 'readRoomMessages takes {roomId}' }
        const { roomId } = request.data
        // The role's own rooms only, as the store's access matrix gives them (PD2).
        const mine = store.me().data.rooms.some((r) => r.room.id === roomId)
        if (!mine) return { ok: false, error: 'not a room of this role' }
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
        const state = checkedState(json.value)
        if (!state.ok) return state
        this.drafts.set(runId, state.value)
        return { ok: true, value: { assets: Object.keys(state.value.assets).length } }
      }
      case 'postProposal': {
        const request = proposalRequest.safeParse(json.value)
        if (!request.success) return { ok: false, error: 'postProposal takes {state, note}' }
        const state = checkedState(request.data.state)
        if (!state.ok) return state
        const text = PROPOSAL_PREFIX + JSON.stringify({ note: request.data.note, state: state.value })
        const release = store.acquireRoom(umpireRoomId)
        try {
          await roomLoaded(store, umpireRoomId)
          const sent = await store.sendMessage(umpireRoomId, text)
          if (!sent.ok) return { ok: false, error: `not posted: ${JSON.stringify(sent.error).slice(0, 300)}` }
          return { ok: true, value: { stanzaId: sent.value.stanzaId } }
        } finally {
          release()
        }
      }
    }
  }
}
