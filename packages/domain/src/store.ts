// The per-pane session store (ARC-2): live, validated domain state over one transport Session.
//
// - One store per pane; everything lives on the instance, nothing at module level (D15).
// - `status()` is explicit: `starting` until the session's documents have loaded, then `ready`.
// - PubSub nodes and rooms are reference-counted: `acquire(node)` and `acquireRoom(roomId)`
//   return a release function. The last release tears down after a microtask, so React
//   StrictMode's mount-unmount-mount does not churn the network (ARC-3).
// - Every payload is validated; invalid items are logged and ignored (NFR-5).
// - Getters return frozen snapshots that keep their identity until something they depend on
//   changes, so they can be passed straight to `useSyncExternalStore`.
import { LIMITS, SINGLETON_NODES, checkItemSize, parseDocument } from '@wrx/schemas'
import type { Announcement, Asset, Force, GameSetup, Objectives, Role, Room } from '@wrx/schemas'
import type {
  ConnectionStatus,
  EndReason,
  Joined,
  MucAffiliation,
  MucRole,
  OccupantEvent,
  Recovery,
  RoomMessage,
  Session,
  Unsubscribe,
} from '@wrx/transport'
import { byOrderThenId, effectiveAccess, roomsForRole } from './access.ts'
import type { AccessMatrix } from './access.ts'
import { DOCUMENT_ITEM_ID, documentValue, nodeSpec, parseItem, safeNodeName } from './documents.ts'
import type { DocumentValues, LiveDocument, NodeSpec } from './documents.ts'
import { domainErr, domainOk, fromTransport } from './errors.ts'
import type { DomainError, DomainResult } from './errors.ts'
import { bareJid, domainpart, localpart, roomJid } from './jid.ts'
import { consoleLogger } from './logger.ts'
import type { Logger } from './logger.ts'
import { defaultRoomTypes } from './registry.ts'
import type { RoomTypeRegistry } from './registry.ts'
import { fitsInStanza } from './size.ts'
import { Timeline, timeKey } from './timeline.ts'
import type { Sender, TimelineEntry } from './timeline.ts'

export type Release = () => void

/** Why the store ended: the transport's reasons, plus `deleted` when the role was (PLY-29). */
export type SessionEndReason = EndReason | 'deleted'

export type StoreStatus =
  | { readonly state: 'starting' }
  | { readonly state: 'ready' }
  /** The transport is reconnecting (PLY-2); documents and messages stay visible. */
  | { readonly state: 'reconnecting'; readonly attempt: number }
  | { readonly state: 'ended'; readonly reason: SessionEndReason; readonly text?: string }

export type LoadStatus = 'loading' | 'ready' | 'error'

/** What every getter returns, and every hook passes on (ARC-3). */
export interface Snapshot<T> {
  readonly data: T
  readonly status: LoadStatus
  readonly error: DomainError | undefined
}

export interface Identity {
  /** This session's full JID. */
  readonly jid: string
  readonly bareJid: string
  readonly domain: string
  /** The role id (the JID's local part), or `undefined` for the admin and anonymous sessions. */
  readonly roleId: string | undefined
  /** The server's `admin` account (D3). The server, not this flag, enforces admin rights. */
  readonly isAdmin: boolean
  readonly anonymous: boolean
}

export interface Me {
  readonly identity: Identity
  readonly role: Role | undefined
  /** The role's force; for the admin, the umpire, the White Force (glossary, D8). */
  readonly force: Force | undefined
  /** In the White Force (the force with the umpire flag): true for the admin too. */
  readonly isUmpire: boolean
  readonly isObserver: boolean
  /**
   * May edit every force's objectives: the admin and White Force roles that are not observers
   * (PLY-35, §3 rule 14). White Force observers read them only.
   */
  readonly canEditObjectives: boolean
  /**
   * The rooms this role can see, in display order, from effective access (PLY-4). The admin,
   * owner of every room, sees every room with write access.
   */
  readonly rooms: readonly { readonly room: Room; readonly access: 'write' | 'read' }[]
}

/**
 * Display data for a message author, resolved live from role and force documents (§3 rule 6).
 * The admin is listed under ADMIN_AUTHOR_ID as the umpire, in the White Force.
 */
export interface Author {
  readonly roleId: string
  readonly name: string
  readonly forceId: string
  readonly forceName: string | undefined
  readonly colour: string | undefined
}

export interface AnnouncementEntry {
  readonly id: string
  readonly announcement: Announcement
  /** Arrived by notification after the first load, so the UI can highlight it (PLY-38). */
  readonly live: boolean
}

export type RoomStatus = 'joining' | 'joined' | 'closed' | 'withdrawn' | 'error'

/** Why the server removed this session from a room (PLY-51). */
export type RoomCloseReason =
  | 'kicked' // 307
  | 'banned' // 301
  | 'membership-removed' // 321: an affiliation change, e.g. the role lost access (PLY-30)
  | 'shutdown' // 332
  | 'removed' // unavailable self-presence with no known code, e.g. the room was destroyed

export interface UnsentMessage {
  readonly text: string
  readonly error: DomainError
}

export interface RoomView {
  readonly roomId: string
  readonly status: RoomStatus
  readonly closeReason: RoomCloseReason | undefined
  /** The server gave this session voice. `false` for MUC visitors (PLY-12, PLY-39). */
  readonly canPost: boolean
  /** Why the documents make this role read-only here, for the composer's explanation. */
  readonly readOnlyReason: 'observer' | 'read-only' | undefined
  /** Oldest first. */
  readonly messages: readonly TimelineEntry[]
  readonly hasOlder: boolean
  readonly loadingOlder: boolean
  /**
   * The first history query has finished (merged, or failed), so `messages` is no longer
   * waiting for it. Stays true across rejoins. Lets a UI tell "no messages" from "loading",
   * and treat the history present at first load as already read (PLY-11).
   */
  readonly historyLoaded: boolean
  /** The last refused post, kept so it can be copied (PLY-33). */
  readonly unsent: UnsentMessage | undefined
}

export interface Occupant {
  readonly nick: string
  readonly jid: string | undefined
  readonly roleId: string | undefined
  /** The server's `admin` account, the umpire, from the occupant JID (§3 rule 3). */
  readonly isAdmin: boolean
  readonly role: MucRole
  readonly affiliation: MucAffiliation
  readonly self: boolean
}

export interface SendError extends DomainError {
  /** The text that was not sent, for the composer to keep (PLY-33). */
  readonly unsentText: string
}

export interface RoomWatch {
  readonly joined: Joined
  readonly release: Release
}

export interface SessionStoreOptions {
  readonly session: Session
  readonly logger?: Logger
  /** Room types, for validating message bodies per room. Defaults to {@link defaultRoomTypes}. */
  readonly registry?: RoomTypeRegistry
  /** MAM page size. Default 50. */
  readonly pageSize?: number
  /** Most MAM pages fetched to bridge a reconnection gap before starting afresh. Default 20. */
  readonly gapPageLimit?: number
  /** The client clock, used only for `announcement.postedAt` (display only). */
  readonly now?: () => string
  /** Item ids for new announcements. */
  readonly newId?: () => string
  /** Runs a deferred release. Default `queueMicrotask`. */
  readonly defer?: (task: () => void) => void
}

export interface SessionStore {
  readonly session: Session
  readonly identity: Identity
  /** Called after any change; read the getters for what changed. */
  subscribe(listener: () => void): Unsubscribe
  status(): StoreStatus
  /** The status as a snapshot: `loading` while starting, else `ready`, with the detail in data. */
  sessionStatus(): Snapshot<StoreStatus>
  /** Resolves once the store is ready, or has ended. */
  ready(): Promise<StoreStatus>

  /** Reference-counted interest in a PubSub node: subscribe and fetch on first, drop on last. */
  acquire(node: string): Release
  /** The newest valid document in a node. */
  document(node: string): Snapshot<LiveDocument | undefined>
  gameSetup(): Snapshot<GameSetup | undefined>
  forces(): Snapshot<readonly Force[]>
  roles(): Snapshot<readonly Role[]>
  rooms(): Snapshot<readonly Room[]>
  force(forceId: string): Snapshot<Force | undefined>
  role(roleId: string): Snapshot<Role | undefined>
  room(roomId: string): Snapshot<Room | undefined>
  objectives(forceId: string): Snapshot<Objectives | undefined>
  asset(assetId: string): Snapshot<Asset | undefined>
  /** Oldest first (PLY-38). */
  announcements(): Snapshot<readonly AnnouncementEntry[]>
  access(): Snapshot<AccessMatrix>
  me(): Snapshot<Me>
  authors(): Snapshot<ReadonlyMap<string, Author>>

  /** Reference-counted room membership: join and load history on first, leave on last. */
  acquireRoom(roomId: string): Release
  roomView(roomId: string): Snapshot<RoomView | undefined>
  occupants(roomId: string): Snapshot<readonly Occupant[]>

  /** Joins (or shares the existing join of) a room; resolves once joined. */
  watchRoom(roomId: string): Promise<DomainResult<RoomWatch>>
  /** Pages one MAM page further back (PLY-49). Concurrent calls share one query. */
  loadOlder(roomId: string): Promise<DomainResult<{ added: number; complete: boolean }>>
  /** Posts a chat message. On refusal the text comes back in the error (PLY-33). */
  sendMessage(
    roomId: string,
    text: string,
  ): Promise<{ ok: true; value: { stanzaId: string } } | { ok: false; error: SendError }>
  /** Tries a closed or withdrawn room once more, on the user's request. */
  rejoinRoom(roomId: string): Promise<DomainResult<Joined>>
  /** The admin and White Force roles that are not observers only (PLY-35, §3 rule 14). */
  publishObjectives(forceId: string, markdown: string): Promise<DomainResult<void>>
  /** The admin only (PLY-37). */
  postAnnouncement(text: string): Promise<DomainResult<void>>
  /** Re-lists nodes and retries failed ones; run after a design change and on reconnection. */
  refresh(): Promise<void>
  /** Leaves rooms, releases subscriptions, clears data and disconnects (PLY-3). Idempotent. */
  logout(): Promise<DomainResult<void>>
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  return new Store(options)
}

interface NodeItem {
  readonly id: string
  readonly doc: LiveDocument
  readonly live: boolean
}

interface NodeEntry {
  readonly node: string
  readonly spec: NodeSpec | undefined
  refs: number
  alive: boolean
  status: LoadStatus
  error: DomainError | undefined
  items: Map<string, NodeItem>
  version: number
  off: Unsubscribe | undefined
  subscribed: boolean
  /** Item ids changed by notifications during the current fetch; the fetch does not undo them. */
  touched: Set<string> | undefined
  loading: Promise<void> | undefined
}

interface RoomEntry {
  readonly roomId: string
  readonly jid: string
  refs: number
  status: RoomStatus
  closeReason: RoomCloseReason | undefined
  error: DomainError | undefined
  joined: Joined | undefined
  readonly timeline: Timeline
  olderCursor: string | undefined
  hasOlder: boolean
  historyLoaded: boolean
  older: Promise<DomainResult<{ added: number; complete: boolean }>> | undefined
  readonly occupants: Map<string, Occupant>
  occupantsVersion: number
  version: number
  offMessage: Unsubscribe | undefined
  offOccupant: Unsubscribe | undefined
  joining: Promise<DomainResult<Joined>> | undefined
  /** Bumped by every join, close and teardown, so late replies are ignored. */
  generation: number
  unsent: UnsentMessage | undefined
}

const LOADING: Snapshot<undefined> = Object.freeze({
  data: undefined,
  status: 'loading',
  error: undefined,
})

const INVALID_ID: Snapshot<undefined> = Object.freeze({
  data: undefined,
  status: 'error',
  error: Object.freeze({ code: 'invalid', message: 'not a valid id' }),
})

const CLOSE_CODES: readonly (readonly [number, RoomCloseReason])[] = Object.freeze([
  [307, 'kicked'],
  [301, 'banned'],
  [321, 'membership-removed'],
  [332, 'shutdown'],
] as const)

class Store implements SessionStore {
  readonly session: Session
  readonly identity: Identity
  private readonly logger: Logger
  private readonly registry: RoomTypeRegistry
  private readonly pageSize: number
  private readonly gapPageLimit: number
  private readonly now: () => string
  private readonly newId: () => string
  private readonly defer: (task: () => void) => void

  private readonly listeners = new Set<() => void>()
  private readonly nodes = new Map<string, NodeEntry>()
  private readonly roomEntries = new Map<string, RoomEntry>()
  private readonly core = new Map<string, Release>()
  private readonly memos = new Map<string, { deps: readonly unknown[]; value: unknown }>()
  private readonly offSession: Unsubscribe[] = []
  private readonly readyWaiters: ((status: StoreStatus) => void)[] = []
  private listed = new Set<string>()
  private currentStatus: StoreStatus = { state: 'starting' }
  /** The first load has finished; until then, coming back online means `starting` again. */
  private booted = false
  private docsVersion = 0
  private designVersion: number | undefined
  private ending: Promise<DomainResult<void>> | undefined

  constructor(options: SessionStoreOptions) {
    this.session = options.session
    this.logger = options.logger ?? consoleLogger()
    this.registry = options.registry ?? defaultRoomTypes()
    this.pageSize = options.pageSize ?? 50
    this.gapPageLimit = options.gapPageLimit ?? 20
    this.now = options.now ?? (() => new Date().toISOString())
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID())
    // Wrapped: an unbound queueMicrotask throws "Illegal invocation" in browsers.
    this.defer =
      options.defer ??
      ((task) => {
        queueMicrotask(task)
      })

    const bare = bareJid(this.session.jid)
    const local = localpart(bare)
    const isAdmin = !this.session.anonymous && local === 'admin'
    this.identity = Object.freeze({
      jid: this.session.jid,
      bareJid: bare,
      domain: domainpart(bare),
      roleId: this.session.anonymous || isAdmin ? undefined : local,
      isAdmin,
      anonymous: this.session.anonymous,
    })

    this.offSession.push(
      this.session.onStatus((status) => {
        this.onConnection(status)
      }),
      this.session.onRecovered((recovery) => {
        this.onRecovered(recovery)
      }),
    )
    const initial = this.session.status()
    if (initial.state === 'ended') this.endLocal(initial.reason, initial.text)
    else void this.start()
  }

  // ---- Change notification and status ---------------------------------------------------

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }

  status(): StoreStatus {
    return this.currentStatus
  }

  sessionStatus(): Snapshot<StoreStatus> {
    const status = this.currentStatus
    return this.memo('session-status', [status], () =>
      Object.freeze({
        data: status,
        status: status.state === 'starting' ? 'loading' : 'ready',
        error: undefined,
      }),
    )
  }

  ready(): Promise<StoreStatus> {
    if (this.booted || this.isEnded()) return Promise.resolve(this.currentStatus)
    return new Promise((resolve) => this.readyWaiters.push(resolve))
  }

  private setStatus(status: StoreStatus): void {
    this.currentStatus = status
    if (status.state === 'ready' || status.state === 'ended') {
      for (const resolve of this.readyWaiters.splice(0)) resolve(status)
    }
    this.emit()
  }

  private isEnded(): boolean {
    return this.currentStatus.state === 'ended'
  }

  private async start(): Promise<void> {
    if (!this.identity.anonymous) await this.listNodes()
    // Each pass may reveal nodes to add: the role's force, then that force's objectives.
    for (let pass = 0; pass < 4 && !this.isEnded(); pass++) {
      const before = this.core.size
      this.reconcileCore()
      await this.settle()
      if (this.core.size === before && pass > 0) break
    }
    if (this.isEnded()) return
    this.booted = true
    if (this.currentStatus.state === 'starting') this.setStatus({ state: 'ready' })
  }

  private onConnection(status: ConnectionStatus): void {
    if (this.isEnded()) return
    if (status.state === 'ended') {
      this.endLocal(status.reason, status.text)
    } else if (status.state === 'reconnecting') {
      this.setStatus({ state: 'reconnecting', attempt: status.attempt })
    } else if (this.currentStatus.state === 'reconnecting') {
      this.setStatus(this.booted ? { state: 'ready' } : { state: 'starting' })
    }
  }

  private onRecovered(recovery: Recovery): void {
    if (this.isEnded() || recovery === 'resumed') return
    // A new session (PLY-2): subscriptions and room membership must be re-established, and
    // whatever was missed fetched again.
    for (const entry of this.nodes.values()) {
      if (entry.spec !== undefined) void this.loadNode(entry)
    }
    void this.refresh()
    for (const room of this.roomEntries.values()) {
      if (room.status === 'joined' || room.status === 'joining') void this.join(room, 'gap')
    }
  }

  // ---- Memoisation ------------------------------------------------------------------------

  private memo<T>(key: string, deps: readonly unknown[], compute: () => T): T {
    const hit = this.memos.get(key)
    if (hit !== undefined && sameDeps(hit.deps, deps)) {
      // The cache is keyed by getter; each key only ever stores what its compute returns.
      return hit.value as T
    }
    const value = compute()
    this.memos.set(key, { deps, value })
    return value
  }

  private collectionStatus<T>(data: T): Snapshot<T> {
    const status = this.currentStatus
    if (status.state === 'ended') {
      return { data, status: 'error', error: endedError(status.reason) }
    }
    return { data, status: status.state === 'starting' ? 'loading' : 'ready', error: undefined }
  }

  // ---- PubSub nodes -----------------------------------------------------------------------

  acquire(node: string): Release {
    if (this.isEnded()) return noop
    let entry = this.nodes.get(node)
    if (entry === undefined) {
      entry = this.createNode(node)
      this.nodes.set(node, entry)
      this.startNode(entry)
    }
    entry.refs++
    const held = entry
    let released = false
    return () => {
      if (released) return
      released = true
      held.refs--
      if (held.refs > 0) return
      this.defer(() => {
        if (held.refs === 0 && this.nodes.get(node) === held) this.teardownNode(held)
      })
    }
  }

  private createNode(node: string): NodeEntry {
    return {
      node,
      spec: nodeSpec(node),
      refs: 0,
      alive: true,
      status: 'loading',
      error: undefined,
      items: new Map(),
      version: 0,
      off: undefined,
      subscribed: false,
      touched: undefined,
      loading: undefined,
    }
  }

  private startNode(entry: NodeEntry): void {
    if (entry.spec === undefined) {
      entry.status = 'error'
      entry.error = { code: 'invalid', message: `"${entry.node}" is not a WRX1 node` }
      this.logger.warn('Ignoring an unknown node', { node: entry.node })
      return
    }
    entry.off = this.session.pubsub.onItems(entry.node, (event) => {
      this.onItems(entry, event.items, event.retracted, event.deleted)
    })
    void this.loadNode(entry)
  }

  /** Subscribes (idempotently) and fetches the node's items. */
  private loadNode(entry: NodeEntry): Promise<void> {
    const spec = entry.spec
    if (spec === undefined) return Promise.resolve()
    const touched = new Set<string>()
    entry.touched = touched
    const run = async () => {
      const [subscribed, fetched] = await Promise.all([
        this.session.pubsub.subscribe(entry.node),
        this.session.pubsub.getItems(entry.node),
      ])
      if (!entry.alive || entry.touched !== touched) return
      entry.touched = undefined
      entry.subscribed = subscribed.ok
      if (!subscribed.ok) {
        this.logger.debug('Subscription refused', { node: entry.node, error: subscribed.error })
      }
      if (!fetched.ok) {
        const error = fromTransport(fetched.error, `Reading ${entry.node}`)
        entry.status = 'error'
        entry.error = error
        if (error.code === 'access-withdrawn' || error.code === 'not-found') entry.items.clear()
        this.logger.debug('Node unavailable', { node: entry.node, condition: error.code })
        this.nodeChanged(entry)
        return
      }
      const next = new Map<string, NodeItem>()
      for (const item of fetched.value) {
        if (touched.has(item.id)) continue
        const doc = this.parseNodeItem(entry, spec, item.id, item.payload)
        if (doc !== undefined) next.set(item.id, { id: item.id, doc, live: false })
      }
      for (const [id, item] of entry.items) if (touched.has(id)) next.set(id, item)
      entry.items = next
      entry.status = 'ready'
      entry.error = undefined
      this.nodeChanged(entry)
    }
    const loading = run().finally(() => {
      if (entry.loading === loading) entry.loading = undefined
    })
    entry.loading = loading
    return loading
  }

  private parseNodeItem(
    entry: NodeEntry,
    spec: NodeSpec,
    itemId: string,
    payload: string,
  ): LiveDocument | undefined {
    const parsed = parseItem(spec, payload)
    if (parsed.ok) return parsed.value
    this.logger.warn('Ignoring an invalid item', {
      node: entry.node,
      itemId,
      code: parsed.error.code,
      message: parsed.error.message,
    })
    return undefined
  }

  private onItems(
    entry: NodeEntry,
    items: readonly { readonly id: string; readonly payload: string }[],
    retracted: readonly string[],
    deleted: boolean,
  ): void {
    const spec = entry.spec
    if (!entry.alive || spec === undefined) return
    if (deleted) {
      entry.items.clear()
      entry.touched?.clear()
      entry.touched = undefined
      entry.status = 'error'
      entry.error = { code: 'not-found', message: `${entry.node} was deleted` }
      this.nodeChanged(entry)
      if (this.isOwnRoleNode(entry.node)) void this.endSession('deleted')
      return
    }
    let changed = false
    for (const id of retracted) {
      entry.touched?.add(id)
      changed = entry.items.delete(id) || changed
    }
    for (const item of items) {
      const doc = this.parseNodeItem(entry, spec, item.id, item.payload)
      if (doc === undefined) continue
      entry.touched?.add(item.id)
      // Delete first so the newest item is last in the map's order.
      entry.items.delete(item.id)
      entry.items.set(item.id, { id: item.id, doc, live: true })
      changed = true
    }
    if (!changed) return
    if (entry.status === 'error' && entry.items.size > 0) {
      entry.status = 'ready'
      entry.error = undefined
    }
    this.nodeChanged(entry)
  }

  private nodeChanged(entry: NodeEntry): void {
    entry.version++
    this.docsVersion++
    const doc = latest(entry)
    if (doc?.kind === 'game-setup') {
      const version = doc.value.designVersion
      // Publishing bumps designVersion whenever the design changes (rule 8): the signal to look
      // for new forces, roles and rooms, since PubSub does not announce new nodes.
      if (this.designVersion !== undefined && version !== this.designVersion) void this.refresh()
      this.designVersion = version
    }
    if (!this.isEnded() && this.currentStatus.state !== 'starting') this.reconcileCore()
    this.emit()
  }

  private teardownNode(entry: NodeEntry): void {
    entry.alive = false
    entry.off?.()
    if (entry.subscribed && !this.isEnded()) void this.session.pubsub.unsubscribe(entry.node)
    this.nodes.delete(entry.node)
    this.docsVersion++
    this.emit()
  }

  private isOwnRoleNode(node: string): boolean {
    const roleId = this.identity.roleId
    return roleId !== undefined && node === safeNodeName('role', roleId)
  }

  private async listNodes(): Promise<void> {
    const listed = await this.session.pubsub.listNodes()
    if (!listed.ok) {
      this.logger.warn('Could not list nodes', { error: listed.error })
      return
    }
    this.listed = new Set(listed.value)
  }

  /** The nodes the store itself holds: everything the session's documents need. */
  private desiredCore(): Set<string> {
    const desired = new Set<string>([SINGLETON_NODES.gameSetup])
    if (this.identity.anonymous) return desired
    desired.add(SINGLETON_NODES.announcements)
    const roleId = this.identity.roleId
    const role = roleId === undefined ? undefined : this.docOf('role', roleId)
    const force = role === undefined ? undefined : this.docOf('force', role.forceId)
    const allObjectives = this.identity.isAdmin || force?.isUmpire === true
    for (const node of this.listed) {
      const spec = nodeSpec(node)
      if (spec === undefined) continue
      if (spec.kind === 'force' || spec.kind === 'role' || spec.kind === 'room') desired.add(node)
      if (spec.kind === 'objectives' && allObjectives) desired.add(node)
    }
    const add = (node: string | undefined) => {
      if (node !== undefined) desired.add(node)
    }
    if (roleId !== undefined) add(safeNodeName('role', roleId))
    if (role !== undefined) {
      add(safeNodeName('force', role.forceId))
      add(safeNodeName('objectives', role.forceId))
    }
    return desired
  }

  private reconcileCore(): void {
    if (this.isEnded()) return
    const desired = this.desiredCore()
    for (const node of desired) {
      if (!this.core.has(node)) this.core.set(node, this.acquire(node))
    }
    for (const [node, release] of this.core) {
      if (!desired.has(node)) {
        this.core.delete(node)
        release()
      }
    }
  }

  private async settle(): Promise<void> {
    for (;;) {
      const pending = [...this.nodes.values()]
        .map((e) => e.loading)
        .filter((p): p is Promise<void> => p !== undefined)
      if (pending.length === 0) return
      await Promise.all(pending)
    }
  }

  async refresh(): Promise<void> {
    if (this.isEnded() || this.identity.anonymous) return
    await this.listNodes()
    if (this.isEnded()) return
    this.reconcileCore()
    for (const entry of this.nodes.values()) {
      if (entry.status === 'error' && entry.loading === undefined) void this.loadNode(entry)
    }
  }

  // ---- Document getters -------------------------------------------------------------------

  private docOf<K extends 'force' | 'role' | 'room' | 'objectives' | 'asset'>(
    kind: K,
    id: string,
  ): DocumentValues[K] | undefined {
    const name = safeNodeName(kind, id)
    const entry = name === undefined ? undefined : this.nodes.get(name)
    return documentValue(entry === undefined ? undefined : latest(entry), kind)
  }

  document(node: string): Snapshot<LiveDocument | undefined> {
    const entry = this.nodes.get(node)
    if (entry === undefined) return LOADING
    return this.memo(`doc:${node}`, [entry, entry.version], () =>
      Object.freeze({ data: latest(entry), status: entry.status, error: entry.error }),
    )
  }

  private typedDocument<K extends keyof DocumentValues>(
    kind: K,
    node: string | undefined,
  ): Snapshot<DocumentValues[K] | undefined> {
    if (node === undefined) return INVALID_ID
    const snapshot = this.document(node)
    return this.memo(`typed:${node}`, [snapshot], () => {
      return Object.freeze({
        data: documentValue(snapshot.data, kind),
        status: snapshot.status,
        error: snapshot.error,
      })
    })
  }

  gameSetup(): Snapshot<GameSetup | undefined> {
    return this.typedDocument('game-setup', SINGLETON_NODES.gameSetup)
  }

  force(forceId: string): Snapshot<Force | undefined> {
    return this.typedDocument('force', safeNodeName('force', forceId))
  }

  role(roleId: string): Snapshot<Role | undefined> {
    return this.typedDocument('role', safeNodeName('role', roleId))
  }

  room(roomId: string): Snapshot<Room | undefined> {
    return this.typedDocument('room', safeNodeName('room', roomId))
  }

  objectives(forceId: string): Snapshot<Objectives | undefined> {
    return this.typedDocument('objectives', safeNodeName('objectives', forceId))
  }

  asset(assetId: string): Snapshot<Asset | undefined> {
    return this.typedDocument('asset', safeNodeName('asset', assetId))
  }

  private collection<K extends 'force' | 'role' | 'room'>(kind: K): readonly DocumentValues[K][] {
    return this.memo(`list:${kind}`, [this.docsVersion], () => {
      const docs: DocumentValues[K][] = []
      for (const entry of this.nodes.values()) {
        if (entry.spec?.kind !== kind) continue
        const value = documentValue(latest(entry), kind)
        if (value !== undefined) docs.push(value)
      }
      docs.sort(byOrderThenId)
      // Keep the previous array when nothing in it changed, so consumers do not re-render.
      const previous = this.memos.get(`list-value:${kind}`)?.value
      if (Array.isArray(previous) && shallowEqual(previous, docs)) {
        return previous as readonly DocumentValues[K][]
      }
      const frozen = Object.freeze(docs)
      this.memos.set(`list-value:${kind}`, { deps: [], value: frozen })
      return frozen
    })
  }

  forces(): Snapshot<readonly Force[]> {
    const data = this.collection('force')
    return this.memo('forces', [data, this.currentStatus], () => this.collectionStatus(data))
  }

  roles(): Snapshot<readonly Role[]> {
    const data = this.collection('role')
    return this.memo('roles', [data, this.currentStatus], () => this.collectionStatus(data))
  }

  rooms(): Snapshot<readonly Room[]> {
    const data = this.collection('room')
    return this.memo('rooms', [data, this.currentStatus], () => this.collectionStatus(data))
  }

  announcements(): Snapshot<readonly AnnouncementEntry[]> {
    const entry = this.nodes.get(SINGLETON_NODES.announcements)
    if (entry === undefined) return this.memo('announcements-none', [], () => emptyLoading())
    return this.memo('announcements', [entry, entry.version], () => {
      const list: AnnouncementEntry[] = []
      for (const item of entry.items.values()) {
        if (item.doc.kind === 'announcement') {
          list.push({ id: item.id, announcement: item.doc.value, live: item.live })
        }
      }
      list.sort(
        (a, b) =>
          compareStrings(a.announcement.postedAt, b.announcement.postedAt) ||
          compareStrings(a.id, b.id),
      )
      return Object.freeze({ data: Object.freeze(list), status: entry.status, error: entry.error })
    })
  }

  access(): Snapshot<AccessMatrix> {
    const forces = this.collection('force')
    const roles = this.collection('role')
    const rooms = this.collection('room')
    const matrix = this.memo('access-matrix', [forces, roles, rooms], () =>
      effectiveAccess({ forces, roles, rooms }),
    )
    return this.memo('access', [matrix, this.currentStatus], () => this.collectionStatus(matrix))
  }

  me(): Snapshot<Me> {
    const matrix = this.access().data
    const rooms = this.collection('room')
    const roleId = this.identity.roleId
    const role = roleId === undefined ? undefined : this.docOf('role', roleId)
    const forces = this.collection('force')
    // The admin is the umpire, a member of the White Force (glossary, D8).
    const force = this.identity.isAdmin
      ? whiteForceOf(forces)
      : role === undefined
        ? undefined
        : this.docOf('force', role.forceId)
    const me = this.memo('me-value', [matrix, rooms, role, force], (): Me => {
      const byId = new Map(rooms.map((r) => [r.id, r]))
      const visible = this.identity.isAdmin
        ? rooms.map((room) => ({ room, access: 'write' as const }))
        : roleId === undefined
          ? []
          : roomsForRole(matrix, roleId).flatMap(({ roomId, access }) => {
              const room = byId.get(roomId)
              return room === undefined ? [] : [{ room, access }]
            })
      return Object.freeze({
        identity: this.identity,
        role,
        force,
        isUmpire: this.identity.isAdmin || force?.isUmpire === true,
        isObserver: role?.isObserver === true,
        canEditObjectives: canEditObjectives(this.identity.isAdmin, force, role),
        rooms: Object.freeze(visible),
      })
    })
    return this.memo('me', [me, this.currentStatus], () => this.collectionStatus(me))
  }

  authors(): Snapshot<ReadonlyMap<string, Author>> {
    const forces = this.collection('force')
    const roles = this.collection('role')
    const map = this.memo('authors-value', [forces, roles], () => {
      const byForce = new Map(forces.map((f) => [f.id, f]))
      const authors = new Map<string, Author>()
      for (const role of roles) {
        const force = byForce.get(role.forceId)
        authors.set(role.id, {
          roleId: role.id,
          name: role.name,
          forceId: role.forceId,
          forceName: force?.name,
          colour: force?.colour,
        })
      }
      // The admin is the umpire, in the White Force. Set last: `admin` is a reserved id, so a
      // role document claiming it cannot take the umpire's label.
      const white = whiteForceOf(forces)
      authors.set(ADMIN_AUTHOR_ID, {
        roleId: ADMIN_AUTHOR_ID,
        name: UMPIRE_NAME,
        forceId: white?.id ?? '',
        forceName: white?.name,
        colour: white?.colour,
      })
      return authors
    })
    return this.memo('authors', [map, this.currentStatus], () => this.collectionStatus(map))
  }

  // ---- Rooms ------------------------------------------------------------------------------

  acquireRoom(roomId: string): Release {
    if (this.isEnded() || safeNodeName('room', roomId) === undefined) return noop
    let entry = this.roomEntries.get(roomId)
    if (entry === undefined) {
      entry = this.createRoom(roomId)
      this.roomEntries.set(roomId, entry)
      entry.joining = this.join(entry, 'initial')
    }
    entry.refs++
    const held = entry
    let released = false
    return () => {
      if (released) return
      released = true
      held.refs--
      if (held.refs > 0) return
      this.defer(() => {
        if (held.refs === 0 && this.roomEntries.get(roomId) === held) this.teardownRoom(held)
      })
    }
  }

  private createRoom(roomId: string): RoomEntry {
    return {
      roomId,
      jid: roomJid(roomId, this.session.services.muc),
      refs: 0,
      status: 'joining',
      closeReason: undefined,
      error: undefined,
      joined: undefined,
      timeline: new Timeline(),
      olderCursor: undefined,
      hasOlder: true,
      historyLoaded: false,
      older: undefined,
      occupants: new Map(),
      occupantsVersion: 0,
      version: 0,
      offMessage: undefined,
      offOccupant: undefined,
      joining: undefined,
      generation: 0,
      unsent: undefined,
    }
  }

  private roomChanged(entry: RoomEntry): void {
    entry.version++
    this.emit()
  }

  private attachRoom(entry: RoomEntry): void {
    entry.offMessage ??= this.session.muc.onMessage(entry.jid, (message) => {
      this.onMessage(entry, message)
    })
    entry.offOccupant ??= this.session.muc.onOccupant(entry.jid, (event) => {
      this.onOccupant(entry, event)
    })
  }

  private detachRoom(entry: RoomEntry): void {
    entry.offMessage?.()
    entry.offOccupant?.()
    entry.offMessage = undefined
    entry.offOccupant = undefined
  }

  private join(entry: RoomEntry, mode: 'initial' | 'gap'): Promise<DomainResult<Joined>> {
    const generation = ++entry.generation
    const current = () => entry.generation === generation && !this.isEnded()
    entry.status = 'joining'
    entry.closeReason = undefined
    entry.error = undefined
    this.attachRoom(entry)
    this.roomChanged(entry)
    const nick = this.identity.roleId ?? localpart(this.identity.bareJid) ?? 'admin'
    const run = async (): Promise<DomainResult<Joined>> => {
      const joined = await this.session.muc.join(entry.jid, nick)
      if (!current()) return domainErr('not-joined', 'superseded')
      if (!joined.ok) return this.failRoom(entry, fromTransport(joined.error, 'Joining'))
      entry.joined = joined.value
      entry.status = 'joined'
      entry.occupants.clear()
      for (const event of this.session.muc.occupants(entry.jid)) {
        if (event.available) entry.occupants.set(event.nick, this.toOccupant(event))
      }
      entry.occupantsVersion++
      this.roomChanged(entry)
      const history =
        mode === 'gap' && entry.timeline.size > 0
          ? await this.fillGap(entry, current)
          : await this.loadLatest(entry, current)
      if (current() && !entry.historyLoaded) {
        entry.historyLoaded = true
        if (history.ok) this.roomChanged(entry)
      }
      if (!history.ok && current()) {
        if (history.error.code === 'access-withdrawn') return this.failRoom(entry, history.error)
        entry.error = history.error
        this.logger.warn('Could not load history', { room: entry.roomId, error: history.error })
        this.roomChanged(entry)
      }
      return domainOk(joined.value)
    }
    const joining = run()
    entry.joining = joining
    return joining
  }

  private failRoom(entry: RoomEntry, error: DomainError): DomainResult<never> {
    entry.generation++
    entry.status = error.code === 'access-withdrawn' ? 'withdrawn' : 'error'
    entry.error = error
    entry.joined = undefined
    this.detachRoom(entry)
    this.logger.warn('Room unavailable', { room: entry.roomId, code: error.code })
    this.roomChanged(entry)
    return { ok: false, error }
  }

  private async loadLatest(entry: RoomEntry, current: () => boolean): Promise<DomainResult<void>> {
    const page = await this.session.mam.queryRoom(entry.jid, { max: this.pageSize })
    if (!current()) return domainOk(undefined)
    if (!page.ok) return { ok: false, error: fromTransport(page.error, 'Loading history') }
    this.mergeMessages(entry, page.value.messages)
    entry.olderCursor = page.value.first ?? entry.timeline.oldest()?.id
    entry.hasOlder = !page.value.complete && entry.olderCursor !== undefined
    this.roomChanged(entry)
    return domainOk(undefined)
  }

  /** After a reconnection: page back from the latest until reaching known messages (PLY-2). */
  private async fillGap(entry: RoomEntry, current: () => boolean): Promise<DomainResult<void>> {
    const pages: (readonly RoomMessage[])[] = []
    let before: string | undefined
    for (let i = 0; i < this.gapPageLimit; i++) {
      const query = before === undefined ? { max: this.pageSize } : { before, max: this.pageSize }
      const page = await this.session.mam.queryRoom(entry.jid, query)
      if (!current()) return domainOk(undefined)
      if (!page.ok)
        return { ok: false, error: fromTransport(page.error, 'Loading missed messages') }
      pages.push(page.value.messages)
      const overlaps = page.value.messages.some((m) => entry.timeline.has(m.stanzaId))
      if (overlaps || page.value.complete || page.value.first === undefined) {
        for (const messages of pages) this.mergeMessages(entry, messages)
        if (page.value.complete && !overlaps) entry.hasOlder = false
        this.roomChanged(entry)
        return domainOk(undefined)
      }
      before = page.value.first
    }
    // Too much was missed to bridge: start again from what was fetched, so there is no hole.
    this.logger.warn('Reconnection gap too large; history restarted', { room: entry.roomId })
    entry.timeline.clear()
    for (const messages of pages) this.mergeMessages(entry, messages)
    entry.olderCursor = before
    entry.hasOlder = true
    this.roomChanged(entry)
    return domainOk(undefined)
  }

  private mergeMessages(entry: RoomEntry, messages: readonly RoomMessage[]): number {
    const entries: TimelineEntry[] = []
    for (const message of messages) {
      const normalised = this.toEntry(entry, message)
      if (normalised !== undefined) entries.push(normalised)
    }
    return entry.timeline.merge(entries)
  }

  private toEntry(entry: RoomEntry, message: RoomMessage): TimelineEntry | undefined {
    if (bareJid(message.room) !== bareJid(entry.jid)) return undefined
    if (message.stanzaId === '' || timeKey(message.timestamp) === undefined) {
      this.logger.warn('Ignoring a message without a stanza-id or server time', {
        room: entry.roomId,
        stanzaId: message.stanzaId,
        timestamp: message.timestamp,
      })
      return undefined
    }
    const base = {
      id: message.stanzaId,
      roomId: entry.roomId,
      timestamp: message.timestamp,
      sender: this.toSender(message.nick, message.from),
    }
    const parsed = parseDocument('message', message.body)
    if (!parsed.ok) {
      this.logger.warn('Unreadable message', { room: entry.roomId, stanzaId: message.stanzaId })
      return { ...base, kind: 'unreadable', reason: parsed.error.message }
    }
    const roomType = this.docOf('room', entry.roomId)?.roomType
    const definition = roomType === undefined ? undefined : this.registry.get(roomType)
    if (definition !== undefined && !definition.messageSchema.safeParse(parsed.value).success) {
      return { ...base, kind: 'unreadable', reason: `not a ${definition.type} message` }
    }
    return { ...base, kind: 'message', body: parsed.value }
  }

  /** Identity from the occupant JID only, never the body (§3 rule 3). */
  private toSender(nick: string, jid: string | undefined): Sender {
    const bare = jid === undefined ? undefined : bareJid(jid)
    const onDomain = bare !== undefined && domainpart(bare) === this.identity.domain
    const local = onDomain ? localpart(bare) : undefined
    const isAdmin = local === 'admin'
    return { nick, jid: bare, roleId: isAdmin ? undefined : local, isAdmin }
  }

  private toOccupant(event: OccupantEvent): Occupant {
    const sender = this.toSender(event.nick, event.jid)
    return {
      nick: event.nick,
      jid: sender.jid,
      roleId: sender.roleId,
      isAdmin: sender.isAdmin,
      role: event.role,
      affiliation: event.affiliation,
      self: event.self,
    }
  }

  private onMessage(entry: RoomEntry, message: RoomMessage): void {
    if (this.mergeMessages(entry, [message]) > 0) this.roomChanged(entry)
  }

  private onOccupant(entry: RoomEntry, event: OccupantEvent): void {
    if (event.self && !event.available) {
      if (entry.status !== 'joined' && entry.status !== 'joining') return
      const code = CLOSE_CODES.find(([c]) => event.statusCodes.includes(c))
      entry.generation++
      entry.status = 'closed'
      entry.closeReason = code?.[1] ?? 'removed'
      entry.joined = undefined
      entry.occupants.clear()
      entry.occupantsVersion++
      this.detachRoom(entry)
      this.logger.warn('Removed from room', { room: entry.roomId, reason: entry.closeReason })
      this.roomChanged(entry)
      return
    }
    if (event.self && entry.joined !== undefined) {
      entry.joined = { ...entry.joined, role: event.role, affiliation: event.affiliation }
      entry.version++
    }
    if (event.available) entry.occupants.set(event.nick, this.toOccupant(event))
    else entry.occupants.delete(event.nick)
    entry.occupantsVersion++
    this.emit()
  }

  private teardownRoom(entry: RoomEntry): void {
    const wasIn = entry.status === 'joined' || entry.status === 'joining'
    entry.generation++
    this.detachRoom(entry)
    if (wasIn && !this.isEnded()) void this.session.muc.leave(entry.jid)
    this.roomEntries.delete(entry.roomId)
    this.emit()
  }

  roomView(roomId: string): Snapshot<RoomView | undefined> {
    const entry = this.roomEntries.get(roomId)
    if (entry === undefined) return LOADING
    const me = this.me().data
    return this.memo(`room-view:${roomId}`, [entry, entry.version, me], () => {
      const visible = me.rooms.find((r) => r.room.id === roomId)
      const readOnlyReason = me.isObserver
        ? 'observer'
        : visible?.access === 'read'
          ? 'read-only'
          : undefined
      const role = entry.joined?.role
      const view: RoomView = Object.freeze({
        roomId,
        status: entry.status,
        closeReason: entry.closeReason,
        canPost: entry.status === 'joined' && role !== 'visitor' && role !== 'none',
        readOnlyReason,
        messages: entry.timeline.entries(),
        hasOlder: entry.hasOlder,
        loadingOlder: entry.older !== undefined,
        historyLoaded: entry.historyLoaded,
        unsent: entry.unsent,
      })
      const status: LoadStatus =
        entry.status === 'joining' ? 'loading' : entry.status === 'joined' ? 'ready' : 'error'
      const error =
        entry.status === 'closed'
          ? { code: 'not-joined' as const, message: `closed: ${entry.closeReason ?? 'removed'}` }
          : entry.error
      return Object.freeze({ data: view, status, error })
    })
  }

  occupants(roomId: string): Snapshot<readonly Occupant[]> {
    const entry = this.roomEntries.get(roomId)
    if (entry === undefined) return this.memo('occupants-none', [], () => emptyLoading())
    return this.memo(`occupants:${roomId}`, [entry, entry.occupantsVersion, entry.status], () => {
      const list = [...entry.occupants.values()].sort((a, b) => compareStrings(a.nick, b.nick))
      return Object.freeze({
        data: Object.freeze(list),
        status:
          entry.status === 'joining' ? 'loading' : entry.status === 'joined' ? 'ready' : 'error',
        error: entry.error,
      })
    })
  }

  // ---- Operations -------------------------------------------------------------------------

  async watchRoom(roomId: string): Promise<DomainResult<RoomWatch>> {
    if (this.isEnded()) return domainErr('session-ended', 'the session has ended')
    if (safeNodeName('room', roomId) === undefined) return domainErr('invalid', 'bad room id')
    const release = this.acquireRoom(roomId)
    const entry = this.roomEntries.get(roomId)
    if (entry === undefined) return domainErr('session-ended', 'the session has ended')
    if (entry.status === 'joined' && entry.joined !== undefined) {
      return domainOk({ joined: entry.joined, release })
    }
    const joined = await (entry.joining ?? this.join(entry, 'initial'))
    if (!joined.ok) {
      release()
      return joined
    }
    return domainOk({ joined: joined.value, release })
  }

  rejoinRoom(roomId: string): Promise<DomainResult<Joined>> {
    const entry = this.roomEntries.get(roomId)
    if (this.isEnded()) return Promise.resolve(domainErr('session-ended', 'the session has ended'))
    if (entry === undefined) return Promise.resolve(domainErr('not-joined', 'room not watched'))
    if (entry.status === 'joined' && entry.joined !== undefined) {
      return Promise.resolve(domainOk(entry.joined))
    }
    if (entry.status === 'joining' && entry.joining !== undefined) return entry.joining
    return this.join(entry, 'gap')
  }

  loadOlder(roomId: string): Promise<DomainResult<{ added: number; complete: boolean }>> {
    const entry = this.roomEntries.get(roomId)
    if (this.isEnded()) return Promise.resolve(domainErr('session-ended', 'the session has ended'))
    if (entry?.status !== 'joined') {
      return Promise.resolve(domainErr('not-joined', 'the room is not joined'))
    }
    if (!entry.hasOlder) return Promise.resolve(domainOk({ added: 0, complete: true }))
    if (entry.older !== undefined) return entry.older
    const generation = entry.generation
    const before = entry.olderCursor ?? entry.timeline.oldest()?.id
    const run = async (): Promise<DomainResult<{ added: number; complete: boolean }>> => {
      const query = before === undefined ? { max: this.pageSize } : { before, max: this.pageSize }
      const page = await this.session.mam.queryRoom(entry.jid, query)
      if (entry.generation !== generation || this.isEnded()) {
        return domainErr('not-joined', 'the room closed while loading')
      }
      if (!page.ok) {
        const error = fromTransport(page.error, 'Loading older messages')
        if (error.code === 'access-withdrawn') return this.failRoom(entry, error)
        return { ok: false, error }
      }
      const added = this.mergeMessages(entry, page.value.messages)
      entry.olderCursor = page.value.first ?? entry.olderCursor
      entry.hasOlder = !page.value.complete && page.value.first !== undefined
      return domainOk({ added, complete: !entry.hasOlder })
    }
    const older = run().finally(() => {
      entry.older = undefined
      this.roomChanged(entry)
    })
    entry.older = older
    this.roomChanged(entry)
    return older
  }

  async sendMessage(
    roomId: string,
    text: string,
  ): Promise<{ ok: true; value: { stanzaId: string } } | { ok: false; error: SendError }> {
    const entry = this.roomEntries.get(roomId)
    const refuse = (error: DomainError) => {
      const sendError: SendError = { ...error, unsentText: text }
      if (entry !== undefined) {
        entry.unsent = { text, error }
        this.roomChanged(entry)
      }
      return { ok: false as const, error: sendError }
    }
    if (this.isEnded()) return refuse({ code: 'session-ended', message: 'the session has ended' })
    if (entry?.status !== 'joined' || entry.joined === undefined) {
      return refuse({ code: 'not-joined', message: 'the room is not joined' })
    }
    if (entry.joined.role === 'visitor' || entry.joined.role === 'none') {
      return refuse({ code: 'not-permitted', message: 'read-only in this room (PLY-12)' })
    }
    if (text.trim() === '') return refuse({ code: 'invalid', message: 'the message is empty' })
    if (text.length > LIMITS.messageTextChars) {
      return refuse({
        code: 'too-large',
        message: `messages are limited to ${LIMITS.messageTextChars} characters`,
      })
    }
    const candidate = { type: 'chat', schemaVersion: 1, content: { text } }
    const roomType = this.docOf('room', roomId)?.roomType ?? 'chat'
    const schema = this.registry.get(roomType)?.messageSchema
    const valid = parseDocument('message', candidate)
    if (!valid.ok || (schema !== undefined && !schema.safeParse(valid.value).success)) {
      return refuse({ code: 'invalid', message: `not a valid ${roomType} message` })
    }
    const body = JSON.stringify(valid.value)
    const size = fitsInStanza(body)
    if (!size.ok) {
      return refuse({
        code: 'too-large',
        message: `the message is ${size.bytes} bytes; the limit is ${size.limitBytes}`,
      })
    }
    const sent = await this.session.muc.send(entry.jid, body)
    if (!sent.ok) {
      const error = fromTransport(sent.error, 'Sending')
      return refuse(error.code === 'access-withdrawn' ? { ...error, code: 'not-permitted' } : error)
    }
    if (entry.unsent !== undefined) {
      entry.unsent = undefined
      this.roomChanged(entry)
    }
    return { ok: true, value: { stanzaId: sent.value.stanzaId } }
  }

  async publishObjectives(forceId: string, markdown: string): Promise<DomainResult<void>> {
    if (this.isEnded()) return domainErr('session-ended', 'the session has ended')
    if (!this.me().data.canEditObjectives) {
      return domainErr(
        'not-permitted',
        'only the umpire and White Force roles that are not observers edit objectives (PLY-35)',
      )
    }
    const node = safeNodeName('objectives', forceId)
    if (node === undefined) return domainErr('invalid', `"${forceId}" is not a force id`)
    const parsed = parseDocument('objectives', {
      schemaVersion: 1,
      forceId,
      markdown,
      updatedAt: this.now(),
    })
    if (!parsed.ok) return domainErr('invalid', parsed.error.message)
    // One item per author: ejabberd refuses to let a publisher overwrite another's item, so the
    // admin and each White Force editor keep their own, and readers take the newest (§3 rule 14).
    const author = localpart(this.session.jid) ?? DOCUMENT_ITEM_ID
    return this.publish(node, author, parsed.value, 'Publishing objectives')
  }

  async postAnnouncement(text: string): Promise<DomainResult<void>> {
    if (this.isEnded()) return domainErr('session-ended', 'the session has ended')
    if (!this.identity.isAdmin) {
      return domainErr('not-permitted', 'only the admin posts announcements (PLY-37)')
    }
    const parsed = parseDocument('announcement', { schemaVersion: 1, text, postedAt: this.now() })
    if (!parsed.ok) return domainErr('invalid', parsed.error.message)
    return this.publish(
      SINGLETON_NODES.announcements,
      this.newId(),
      parsed.value,
      'Posting the announcement',
    )
  }

  private async publish(
    node: string,
    itemId: string,
    doc: unknown,
    what: string,
  ): Promise<DomainResult<void>> {
    const size = checkItemSize(doc)
    if (!size.ok) {
      return domainErr('too-large', `${size.bytes} bytes is over the ${size.limitBytes}-byte limit`)
    }
    const published = await this.session.pubsub.publish(node, itemId, JSON.stringify(doc))
    if (!published.ok) {
      const error = fromTransport(published.error, what)
      return {
        ok: false,
        error: error.code === 'access-withdrawn' ? { ...error, code: 'not-permitted' } : error,
      }
    }
    return domainOk(undefined)
  }

  logout(): Promise<DomainResult<void>> {
    return this.endSession('logout')
  }

  private endSession(reason: 'logout' | 'deleted'): Promise<DomainResult<void>> {
    if (this.ending !== undefined) return this.ending
    if (this.isEnded()) return Promise.resolve(domainOk(undefined))
    const run = async (): Promise<DomainResult<void>> => {
      const rooms = [...this.roomEntries.values()].filter(
        (r) => r.status === 'joined' || r.status === 'joining',
      )
      const nodes = [...this.nodes.values()].filter((n) => n.subscribed)
      for (const room of rooms) {
        room.generation++
        this.detachRoom(room)
      }
      await Promise.all([
        ...rooms.map((room) => this.session.muc.leave(room.jid)),
        ...nodes.map((node) => this.session.pubsub.unsubscribe(node.node)),
      ])
      this.endLocal(reason)
      await this.session.disconnect()
      return domainOk(undefined)
    }
    this.ending = run()
    return this.ending
  }

  /** Drops every listener and all game data, with no network traffic (PLY-3). */
  private endLocal(reason: SessionEndReason, text?: string): void {
    if (this.isEnded()) return
    for (const off of this.offSession.splice(0)) off()
    for (const entry of this.nodes.values()) {
      entry.alive = false
      entry.off?.()
    }
    for (const room of this.roomEntries.values()) {
      room.generation++
      this.detachRoom(room)
    }
    this.nodes.clear()
    this.roomEntries.clear()
    this.core.clear()
    this.memos.clear()
    this.listed = new Set()
    this.docsVersion++
    this.setStatus(
      text === undefined ? { state: 'ended', reason } : { state: 'ended', reason, text },
    )
  }
}

function noop(): void {
  return undefined
}

function latest(entry: NodeEntry): LiveDocument | undefined {
  let doc: LiveDocument | undefined
  for (const item of entry.items.values()) {
    // Objectives carry their own time, as several authors' items share the node; other
    // documents have one item, so the last one received is the newest.
    if (
      doc?.kind === 'objectives' &&
      item.doc.kind === 'objectives' &&
      Date.parse(item.doc.value.updatedAt) < Date.parse(doc.value.updatedAt)
    ) {
      continue
    }
    doc = item.doc
  }
  return doc
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
}

function shallowEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return sameDeps(a, b)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function emptyLoading<T>(): Snapshot<readonly T[]> {
  return Object.freeze({ data: Object.freeze([]), status: 'loading', error: undefined })
}

function endedError(reason: SessionEndReason): DomainError {
  return { code: 'session-ended', message: `the session ended (${reason})` }
}

/** How the admin's messages are labelled: the umpire, in the White Force (SC-5). */
export const UMPIRE_NAME = 'Umpire'

/** The admin's key in `authors()`: the reserved account name, never a role id. */
export const ADMIN_AUTHOR_ID = 'admin'

/**
 * The White Force: the force with the umpire flag (glossary). The editor allows exactly one; if
 * a live game has several, the first in display order.
 */
export function whiteForceOf(forces: readonly Force[]): Force | undefined {
  return [...forces].filter((f) => f.isUmpire).sort(byOrderThenId)[0]
}

/** PLY-35, §3 rule 14: the admin, and White Force roles that are not observers. */
export function canEditObjectives(
  isAdmin: boolean,
  force: Force | undefined,
  role: Role | undefined,
): boolean {
  if (isAdmin) return true
  return role !== undefined && force?.isUmpire === true && !role.isObserver
}
