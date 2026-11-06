// The bridge on the page (PY-4): the only way a script reaches the game. It answers the bridge
// protocol (`@wrx/schemas/bridge`, version 2, through sdk-ops.ts) from the logged-in session's
// store, and nothing else: every call is parsed as untrusted input (`parseBridgeCall`), checked
// against the role the script runs as (PD2, PD4), and every result is checked against its
// schema before it goes back (`bridgeOk`). Every read and send is scoped to what this session
// may do, through the store's own send paths (the composer's checks, PLY-56's pause).
//
// Per run (WP 6.4): draft writes are held and handed to the runner, which applies them only when
// the run finishes well (PD9), with the state the script based them on (`readDraft`, else the
// published state at the run's start), so the change lands on top of the draft. Subscriptions
// send the script events while the run lasts, and every room and node a run holds is released
// when it ends.
import { postingPaused, safeNodeName, sameGameState, worldStateSize } from '@wrx/domain'
import type { DomainError, SessionStore, Snapshot, TimelineEntry } from '@wrx/domain'
import { SINGLETON_NODES, UMPIRE_ROOM_TYPE, worldStateSchema } from '@wrx/schemas'
import type { GameState, WorldState } from '@wrx/schemas'
import { bridgeEventSchema, roomMessageSchema } from '@wrx/schemas/bridge'
import {
  BRIDGE_PROTOCOL_VERSION,
  OPERATION_ROLES,
  bridgeError,
  bridgeOk,
  parseBridgeCall,
} from './sdk-ops.ts'
import type {
  BridgeErrorCode,
  BridgeEvent,
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
  | 'sendMessage'
  | 'sendTemplateMessage'
  | 'sendProposal'
>

/** The admin's world-state draft, as the bridge sees it (ADM-45). */
export interface DraftAccess {
  /** The draft held now; undefined when none is (the published state is then the draft). */
  current(): WorldState | undefined
}

/** A run's draft write, for the runner to apply when the run finishes well (PD9). */
export interface DraftWrite {
  /** The state the script wrote. */
  readonly state: WorldState
  /**
   * What it was based on: the draft (or published state) its first `readDraft` returned, else
   * the published state when the run started; undefined if there was none.
   */
  readonly base: WorldState | undefined
}

export interface BridgeContext {
  readonly role: ScriptRole
  readonly store: RunnerStore
  /** The game's map room, whose world state the script reads (D25). */
  readonly mapRoomId: string
  /** The admin's draft: `readDraft` reads it. */
  readonly draft?: DraftAccess
  /** How long a read waits for the store to load what it asks for. Default 20 s. */
  readonly loadTimeoutMs?: number
}

/** What a run holds on the page while it lasts (WP 6.4). */
interface RunState {
  /** Sends an event to the run's script, as JSON text. */
  readonly emit: (event: string) => void
  /** The published state when the run started: a draft write's base if it read no draft. */
  readonly publishedAtStart: WorldState | undefined
  /** The first `readDraft`'s state, the base of the run's draft write. */
  readBase?: { readonly state: WorldState | undefined }
  draft?: WorldState | undefined
  /** Rooms, nodes and subscriptions to let go when the run ends. */
  readonly releases: (() => void)[]
  /** Rooms already subscribed, so a second subscription adds nothing. */
  readonly subscribed: Set<string>
  phase: boolean
  /** Rooms this run joined to send in (kept until it ends). */
  readonly held: Set<string>
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

/** A store's refusal of a send, as the protocol's error. */
function refusalOf(error: DomainError): Refusal {
  const code: BridgeErrorCode =
    error.code === 'paused'
      ? 'paused'
      : error.code === 'invalid' || error.code === 'too-large'
        ? 'invalid-request'
        : error.code === 'not-joined'
          ? 'unavailable'
          : codeOf(error)
  return new Refusal(code, error.message)
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
  /** Each active run's state: its draft write, subscriptions and held rooms (PD9, WP 6.4). */
  private readonly runs = new Map<number, RunState>()
  /** Every call and its outcome, newest last (bounded): for diagnostics and the tests. */
  readonly calls: CallRecord[] = []

  constructor(private readonly context: BridgeContext) {}

  get role(): ScriptRole {
    return this.context.role
  }

  /**
   * A run starts: events for it go to `emit`. The published state is noted as its draft write's
   * base, should the script not read the draft.
   */
  beginRun(runId: number, emit: (event: string) => void): void {
    this.endRun(runId)
    const { store, mapRoomId } = this.context
    const published = mapRoomId === '' ? undefined : store.worldState(mapRoomId).data?.state
    this.runs.set(runId, {
      emit,
      publishedAtStart: published,
      releases: [],
      subscribed: new Set(),
      phase: false,
      held: new Set(),
    })
  }

  /** A run ends: its subscriptions stop and what it held is released; its draft is dropped. */
  endRun(runId: number): void {
    const run = this.runs.get(runId)
    if (run === undefined) return
    this.runs.delete(runId)
    for (const release of run.releases.splice(0)) {
      try {
        release()
      } catch {
        // One release failing must not keep the others.
      }
    }
  }

  /** The run's draft write, removed: the runner applies it on success, drops it otherwise. */
  takeDraft(runId: number): DraftWrite | undefined {
    const run = this.runs.get(runId)
    const state = run?.draft
    if (run === undefined || state === undefined) return undefined
    run.draft = undefined
    return { state, base: run.readBase === undefined ? run.publishedAtStart : run.readBase.state }
  }

  /** Drops the run's draft write (Stop, the time limit, a failure: PD9). */
  discard(runId: number): void {
    const run = this.runs.get(runId)
    if (run !== undefined) run.draft = undefined
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

  private run(runId: number): RunState {
    const run = this.runs.get(runId)
    if (run === undefined) throw new Refusal('unavailable', 'the run has ended')
    return run
  }

  private async dispatch(runId: number, op: string, payload: string): Promise<string> {
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
      case 'sendMessage': {
        const { roomId, text } = call.request
        await this.writable(runId, roomId)
        const sent = await store.sendMessage(roomId, text, { quiet: true })
        if (!sent.ok) throw refusalOf(sent.error)
        return bridgeOk('sendMessage', { stanzaId: sent.value.stanzaId })
      }
      case 'sendTemplate': {
        const { roomId, templateId, values } = call.request
        await this.writable(runId, roomId)
        const sent = await store.sendTemplateMessage(roomId, templateId, values, { quiet: true })
        if (!sent.ok) throw refusalOf(sent.error)
        return bridgeOk('sendTemplate', { stanzaId: sent.value.stanzaId })
      }
      case 'readDraft': {
        const run = this.run(runId)
        const held = this.context.draft?.current()
        const state = held ?? (await this.worldState()).state ?? undefined
        // The run's draft write is based on what it read first (WP 6.4).
        run.readBase ??= { state }
        return bridgeOk('readDraft', { state: state ?? null, held: held !== undefined })
      }
      case 'writeDraft': {
        const run = this.run(runId)
        const state = checkedWorldState(call.request.state)
        if (!state.ok) throw new Refusal('invalid-request', state.error)
        run.draft = state.value
        return bridgeOk('writeDraft', { assets: Object.keys(state.value.assets).length })
      }
      case 'postProposal': {
        const state = checkedWorldState(call.request.state)
        if (!state.ok) throw new Refusal('invalid-request', state.error)
        const room = store.me().data.rooms.find((r) => r.room.roomType === UMPIRE_ROOM_TYPE)
        if (room === undefined) throw new Refusal('not-found', 'this game has no umpire room')
        await this.joined(runId, room.room.id)
        // Not paused: the White Force is exempt (PLY-56), and only it posts proposals.
        const sent = await store.sendProposal(room.room.id, {
          state: state.value,
          summary: call.request.summary,
        })
        if (!sent.ok) throw refusalOf(sent.error)
        return bridgeOk('postProposal', { stanzaId: sent.value.stanzaId })
      }
      case 'subscribeMessages':
        await this.subscribeMessages(runId, call.request.roomId)
        return bridgeOk('subscribeMessages', {})
      case 'subscribePhase':
        await this.subscribePhase(runId)
        return bridgeOk('subscribePhase', {})
    }
  }

  /** Sends an event to a run, if it is still active; checked against the protocol first. */
  private emit(runId: number, event: BridgeEvent): void {
    const run = this.runs.get(runId)
    if (run === undefined) return
    const checked = bridgeEventSchema.safeParse(event)
    if (checked.success) run.emit(JSON.stringify(checked.data))
  }

  /** Holds `roomId` joined for the rest of the run, and waits until it is (or refuses). */
  private async joined(runId: number, roomId: string): Promise<void> {
    const run = this.run(runId)
    const { store } = this.context
    if (!run.held.has(roomId)) {
      run.held.add(roomId)
      run.releases.push(store.acquireRoom(roomId))
    }
    await this.until(() => {
      const status = store.roomView(roomId).data?.status
      return status !== undefined && status !== 'joining'
    }, 'the room')
    const view = store.roomView(roomId).data
    if (view?.status !== 'joined') {
      throw new Refusal(
        view?.status === 'withdrawn' ? 'forbidden' : 'unavailable',
        'the room could not be joined',
      )
    }
  }

  /**
   * A room the role can write in (PD2): one of its rooms with write access, joined, and not
   * paused for it (PLY-56, White Force exempt). The store checks again as it sends.
   */
  private async writable(runId: number, roomId: string): Promise<void> {
    const { store } = this.context
    const mine = store.me().data.rooms.find((r) => r.room.id === roomId)
    if (mine === undefined) throw new Refusal('not-found', 'not a room of this role')
    if (mine.access !== 'write') {
      throw new Refusal('forbidden', 'this role can only read this room')
    }
    const state = await this.node(SINGLETON_NODES.gameState, () => store.gameState(), true)
    if (postingPaused(store.me().data, state)) {
      throw new Refusal(
        'paused',
        'posting is paused for this role during adjudication (PLY-56); the White Force is exempt',
      )
    }
    await this.joined(runId, roomId)
  }

  private async subscribeMessages(runId: number, roomId: string): Promise<void> {
    const run = this.run(runId)
    const { store } = this.context
    if (!store.me().data.rooms.some((r) => r.room.id === roomId)) {
      throw new Refusal('not-found', 'not a room of this role')
    }
    if (run.subscribed.has(roomId)) return
    run.subscribed.add(roomId)
    run.releases.push(store.acquireRoom(roomId))
    await this.until(() => store.roomView(roomId).data?.historyLoaded === true, 'the room')
    // Only what arrives from now on: every message loaded so far counts as seen.
    const seen = new Set((store.roomView(roomId).data?.messages ?? []).map((m) => m.id))
    const check = () => {
      if (!this.runs.has(runId)) return
      const view = store.roomView(roomId).data
      if (view === undefined) return
      for (const entry of view.messages) {
        if (seen.has(entry.id)) continue
        seen.add(entry.id)
        const message = this.toMessage(roomId, entry)
        if (message !== undefined) this.emit(runId, { type: 'message', message })
      }
    }
    run.releases.push(store.subscribe(check))
  }

  private async subscribePhase(runId: number): Promise<void> {
    const run = this.run(runId)
    const { store } = this.context
    if (run.phase) return
    run.phase = true
    run.releases.push(store.acquire(SINGLETON_NODES.gameState))
    await this.until(() => store.gameState().status !== 'loading', 'the turn')
    let last: GameState | undefined = store.gameState().data
    run.releases.push(
      store.subscribe(() => {
        const now = store.gameState().data
        if (now === undefined || sameGameState(now, last)) return
        last = now
        this.emit(runId, { type: 'phase', state: now })
      }),
    )
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

  /** A timeline entry as the protocol's message; undefined for one clients show unreadable. */
  private toMessage(roomId: string, entry: TimelineEntry): Message | undefined {
    if (entry.kind !== 'message') return undefined
    const authors = this.context.store.authors().data
    const loginName = entry.sender.isAdmin ? 'admin' : (entry.sender.loginName ?? null)
    const author = loginName === null || entry.sender.isAdmin ? undefined : authors.get(loginName)
    const message = roomMessageSchema.safeParse({
      id: entry.id,
      roomId,
      sentAt: entry.timestamp,
      sender: { isAdmin: entry.sender.isAdmin, roleId: author?.roleId ?? null, loginName },
      body: entry.body,
    })
    return message.success ? message.data : undefined
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
      const all: Message[] = []
      for (const entry of view.messages) {
        const message = this.toMessage(roomId, entry)
        if (message !== undefined) all.push(message)
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
