// The bridge on the page (PY-4): the only way a script reaches the game. It answers WP 6.1's
// bridge protocol (`@wrx/schemas/bridge`, through sdk-ops.ts) from the logged-in session's
// store, and nothing else: every call is parsed as untrusted input (`parseBridgeCall`), checked
// against the role the script runs as (PD2, PD4), and every result is checked against its
// schema before it goes back (`bridgeOk`). Every read is scoped to what this session may see.
// Draft writes are held per run and handed to the runner, which applies them only when the run
// finishes well (PD9).
import { safeNodeName, worldStateSize } from '@wrx/domain'
import type { DomainError, SessionStore, Snapshot } from '@wrx/domain'
import { SINGLETON_NODES, worldStateSchema } from '@wrx/schemas'
import type { WorldState } from '@wrx/schemas'
import { roomMessageSchema } from '@wrx/schemas/bridge'
import {
  BRIDGE_PROTOCOL_VERSION,
  DRAFT_PAYLOAD_CHARS,
  OPERATION_ROLES,
  bridgeError,
  bridgeOk,
  draftOk,
  isRunnerOp,
  parseBridgeCall,
} from './sdk-ops.ts'
import type {
  BridgeErrorCode,
  BridgeRequest,
  BridgeResult,
  ScriptRole,
  SdkOperation,
} from './sdk-ops.ts'

/** What the runner needs of the logged-in session's store: reads, and node and room handles. */
export type RunnerStore = Pick<
  SessionStore,
  | 'me'
  | 'authors'
  | 'gameSetup'
  | 'gameState'
  | 'forces'
  | 'roles'
  | 'objectives'
  | 'acquire'
  | 'worldState'
  | 'acquireWorldState'
  | 'roomView'
  | 'acquireRoom'
  | 'loadOlder'
  | 'subscribe'
>

export interface BridgeContext {
  readonly role: ScriptRole
  readonly store: RunnerStore
  /** The game's map room, whose world state the script reads (D25). */
  readonly mapRoomId: string
  /** How long a read waits for the store to load what it asks for. Default 20 s. */
  readonly loadTimeoutMs?: number
}

export interface CallRecord {
  readonly op: string
  readonly ok: boolean
  readonly code?: string
  readonly error?: string
}

/** A refusal or fault inside an operation, turned into the protocol's error reply. */
class Refusal extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message)
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

/** The protocol's code for a store error. */
function codeOf(error: DomainError | undefined): BridgeErrorCode {
  if (error === undefined) return 'unavailable'
  if (error.code === 'access-withdrawn' || error.code === 'not-permitted') return 'forbidden'
  if (error.code === 'not-found') return 'not-found'
  if (error.code === 'transport' || error.code === 'session-ended') return 'unavailable'
  return 'failed'
}

/** The paging cursor: the order and the id of the last message given. Opaque to the SDK. */
function cursorOf(order: string, id: string): string {
  return `${order === 'newest-first' ? 'n' : 'o'}:${id}`
}

type Message = BridgeResult<'readRoomMessages'>['messages'][number]

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

  /** Answers one call with the reply's JSON text: `{ok, value}` or `{ok: false, code, error}`. */
  async handle(runId: number, op: string, payload: string): Promise<string> {
    const reply = await this.dispatch(runId, op, payload).catch((error: unknown) =>
      error instanceof Refusal
        ? bridgeError(error.code, error.message)
        : bridgeError('failed', String(error)),
    )
    if (this.calls.length >= 1000) this.calls.shift()
    const parsed = JSON.parse(reply) as { ok: boolean; code?: string; error?: string }
    this.calls.push(
      parsed.ok
        ? { op, ok: true }
        : { op, ok: false, code: parsed.code ?? 'failed', error: parsed.error ?? '' },
    )
    return reply
  }

  private refusedFor(op: SdkOperation): string | undefined {
    if (OPERATION_ROLES[op].includes(this.context.role)) return undefined
    return bridgeError('forbidden', `${op} is not open to the ${this.context.role} role`)
  }

  private async dispatch(runId: number, op: string, payload: string): Promise<string> {
    if (isRunnerOp(op)) return this.refusedFor(op) ?? this.writeDraft(runId, payload)
    const call = parseBridgeCall(op, payload)
    if (!call.ok) return call.reply
    const refused = this.refusedFor(call.op)
    if (refused !== undefined) return refused
    const { store } = this.context
    switch (call.op) {
      case 'readContext': {
        const me = store.me().data
        const admin = me.identity.isAdmin
        return bridgeOk('readContext', {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          isAdmin: admin,
          roleId: admin ? null : (me.role?.id ?? null),
          forceId: admin ? null : (me.force?.id ?? null),
        })
      }
      case 'readGameSetup': {
        const setup = await this.node(SINGLETON_NODES.gameSetup, () => store.gameSetup())
        if (setup === undefined) throw new Refusal('unavailable', 'no game setup is published')
        return bridgeOk('readGameSetup', { setup })
      }
      case 'readTurn': {
        const state = await this.node(SINGLETON_NODES.gameState, () => store.gameState(), true)
        return bridgeOk('readTurn', { state: state ?? null })
      }
      case 'readForces':
        return bridgeOk('readForces', { forces: [...store.forces().data] })
      case 'readRoles':
        return bridgeOk('readRoles', { roles: [...store.roles().data] })
      case 'readRooms':
        // The role's own rooms, as the store's access matrix gives them (PD2).
        return bridgeOk('readRooms', { rooms: store.me().data.rooms.map((r) => r.room) })
      case 'readRoomMessages':
        return bridgeOk('readRoomMessages', await this.roomMessages(call.request))
      case 'readWorldState':
        return bridgeOk('readWorldState', await this.worldState())
      case 'readObjectives': {
        const { forceId } = call.request
        const node = safeNodeName('objectives', forceId)
        if (node === undefined || !store.forces().data.some((f) => f.id === forceId)) {
          throw new Refusal('not-found', 'no such force for this role')
        }
        const objectives = await this.node(node, () => store.objectives(forceId), true)
        return bridgeOk('readObjectives', { objectives: objectives ?? null })
      }
    }
  }

  private writeDraft(runId: number, payload: string): string {
    if (payload.length > DRAFT_PAYLOAD_CHARS) {
      return bridgeError('invalid-request', 'the request is too long')
    }
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      return bridgeError('invalid-request', 'the request is not JSON')
    }
    const state = checkedWorldState(json)
    if (!state.ok) return bridgeError('invalid-request', state.error)
    this.drafts.set(runId, state.value)
    return draftOk(Object.keys(state.value.assets).length)
  }

  /** Resolves when `ready` holds, or refuses as unavailable after the load timeout. */
  private until(ready: () => boolean, what: string): Promise<void> {
    const { store, loadTimeoutMs = 20_000 } = this.context
    return new Promise((resolve, reject) => {
      let unsubscribe: () => void = () => undefined
      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Refusal('unavailable', `${what} did not load in time`))
      }, loadTimeoutMs)
      const check = () => {
        if (!ready()) return
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
      unsubscribe = store.subscribe(check)
      check()
    })
  }

  /** Reads a PubSub document: holds its node until it has loaded, then releases it. */
  private async node<T>(
    node: string,
    read: () => Snapshot<T | undefined>,
    missingIsNone = false,
  ): Promise<T | undefined> {
    const release = this.context.store.acquire(node)
    try {
      await this.until(() => read().status !== 'loading', node)
      const snapshot = read()
      if (snapshot.status === 'error') {
        const code = codeOf(snapshot.error)
        if (code === 'not-found' && missingIsNone) return undefined
        throw new Refusal(code, snapshot.error?.message ?? `${node} could not be read`)
      }
      return snapshot.data
    } finally {
      release()
    }
  }

  private async worldState(): Promise<BridgeResult<'readWorldState'>> {
    const { store, mapRoomId } = this.context
    const none = { state: null, messageId: null, sentAt: null }
    if (!store.me().data.rooms.some((r) => r.room.id === mapRoomId)) return none
    const release = store.acquireWorldState(mapRoomId)
    try {
      await this.until(() => {
        const view = store.worldState(mapRoomId).data
        return view !== undefined && (view.state !== undefined || !view.searching)
      }, 'the world state')
      const view = store.worldState(mapRoomId).data
      if (view?.state === undefined) return none
      return { state: view.state, messageId: view.stanzaId ?? null, sentAt: view.timestamp ?? null }
    } finally {
      release()
    }
  }

  /**
   * One page of a room's messages, as this session sees them (PD2): the role's own rooms only,
   * the archive paged in from the server as needed, and messages whose body fails the
   * protocol's schema left out, as clients show them unreadable.
   */
  private async roomMessages(
    request: BridgeRequest<'readRoomMessages'>,
  ): Promise<BridgeResult<'readRoomMessages'>> {
    const { store } = this.context
    const { roomId, limit, order, cursor } = request
    if (!store.me().data.rooms.some((r) => r.room.id === roomId)) {
      throw new Refusal('not-found', 'not a room of this role')
    }
    let anchor: string | undefined
    if (cursor !== undefined) {
      const prefix = cursorOf(order, '')
      if (!cursor.startsWith(prefix)) {
        throw new Refusal('invalid-request', 'the cursor is of the other order')
      }
      anchor = cursor.slice(prefix.length)
    }
    const release = store.acquireRoom(roomId)
    try {
      await this.until(() => store.roomView(roomId).data?.historyLoaded === true, 'the room')
      // Page in the archive: all of it for oldest first; for newest first, enough of it.
      for (let pages = 0; pages < 1000; pages++) {
        const view = store.roomView(roomId).data
        if (!view?.hasOlder) break
        if (order === 'newest-first') {
          // Messages loaded that are older than the anchor (oldest first, so its index).
          const older =
            anchor === undefined
              ? view.messages.length
              : view.messages.findIndex((m) => m.id === anchor)
          if (older >= limit) break
        }
        const older = await store.loadOlder(roomId)
        if (!older.ok) throw new Refusal(codeOf(older.error), older.error.message)
        if (older.value.complete) break
      }
      const view = store.roomView(roomId).data
      if (view === undefined) throw new Refusal('unavailable', 'the room is not loaded')
      const authors = store.authors().data
      const all: Message[] = []
      for (const entry of view.messages) {
        if (entry.kind !== 'message') continue
        const loginName = entry.sender.isAdmin ? 'admin' : (entry.sender.loginName ?? null)
        const author =
          loginName === null || entry.sender.isAdmin ? undefined : authors.get(loginName)
        const message = roomMessageSchema.safeParse({
          id: entry.id,
          roomId,
          sentAt: entry.timestamp,
          sender: { isAdmin: entry.sender.isAdmin, roleId: author?.roleId ?? null, loginName },
          body: entry.body,
        })
        if (message.success) all.push(message.data)
      }
      const ordered = order === 'newest-first' ? all.reverse() : all
      let start = 0
      if (anchor !== undefined) {
        const at = ordered.findIndex((m) => m.id === anchor)
        if (at < 0) throw new Refusal('invalid-request', 'the cursor is no longer valid')
        start = at + 1
      }
      const messages = ordered.slice(start, start + limit)
      const last = messages.at(-1)
      const more = start + messages.length < ordered.length
      return { messages, cursor: more && last !== undefined ? cursorOf(order, last.id) : null }
    } finally {
      release()
    }
  }
}
