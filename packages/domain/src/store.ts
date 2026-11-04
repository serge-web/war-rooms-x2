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
import {
  LIMITS,
  MAP_ROOM_TYPE,
  SINGLETON_NODES,
  checkItemSize,
  chatRoomConfigReader,
  parseDocument,
} from '@wrx/schemas'
import type {
  Announcement,
  Asset,
  ChatRoomConfig,
  Directory,
  Force,
  GameSetup,
  GameState,
  Objectives,
  Retired,
  Role,
  Room,
  Template,
  TemplateValue,
  WorldState,
} from '@wrx/schemas'
import { checkTemplatedMessage, createTemplateValidator, templatesFor } from '@wrx/templates'
import type { TemplateCheck, TemplateValidator } from '@wrx/templates'
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
import {
  DOCUMENT_ITEM_ID,
  documentValue,
  nodeSpec,
  objectivesItemId,
  parseItem,
  safeNodeName,
} from './documents.ts'
import type { DocumentValues, LiveDocument, NodeSpec } from './documents.ts'
import { domainErr, domainOk, fromTransport } from './errors.ts'
import type { DomainError, DomainResult } from './errors.ts'
import { bareJid, domainpart, localpart, roomJid } from './jid.ts'
import { consoleLogger } from './logger.ts'
import type { Logger } from './logger.ts'
import { defaultRoomTypes, roomConfig } from './registry.ts'
import type { RoomTypeRegistry } from './registry.ts'
import { fitsInStanza, fitsWorldStateStanza } from './size.ts'
import { Timeline, timeKey } from './timeline.ts'
import { nextGameState, postingPaused, sameGameState } from './turns.ts'
import type { ReadableEntry, Sender, TimelineEntry } from './timeline.ts'

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
  /**
   * The role's login name (the JID's local part), or `undefined` for the admin and anonymous
   * sessions. The role itself, and its GUID, come from the role documents: `Me.role`.
   */
  readonly loginName: string | undefined
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
   * (PLY-35, §3 rule 14, D21). White Force observers read them only.
   */
  readonly canEditObjectives: boolean
  /**
   * The rooms this role can see, in display order, from effective access (PLY-4). The admin,
   * owner of every room, sees every room with write access.
   */
  readonly rooms: readonly { readonly room: Room; readonly access: 'write' | 'read' }[]
}

/**
 * Display data for a message author, resolved live from role and force documents by the
 * author's login name (§3 rule 6). The admin is listed under ADMIN_AUTHOR_ID as the umpire, in
 * the White Force. A deleted role is listed from its `retired` record, marked `deleted`.
 */
export interface Author {
  /** The role's GUID; ADMIN_AUTHOR_ID for the admin. */
  readonly roleId: string
  readonly loginName: string
  readonly name: string
  readonly forceId: string
  readonly forceName: string | undefined
  readonly colour: string | undefined
  /** The role was deleted; `name` is its last name, from `retired` (§3 rule 1, ADM-14). */
  readonly deleted: boolean
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

/** A refused templated message, kept so its form can show the values again (PLY-33). */
export interface UnsentTemplateMessage {
  readonly templateId: string
  readonly values: Readonly<Record<string, TemplateValue>>
  readonly error: TemplateSendError
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
  /** The last refused templated message, kept so its form keeps the values (PLY-33). */
  readonly unsentTemplate: UnsentTemplateMessage | undefined
}

export interface Occupant {
  readonly nick: string
  readonly jid: string | undefined
  /** The JID's local part on this game's domain: a role's login name. */
  readonly loginName: string | undefined
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

/** A refused templated message; the values come back so the form can keep them (PLY-33). */
export interface TemplateSendError extends DomainError {
  readonly templateId: string
  readonly unsentValues: Readonly<Record<string, TemplateValue>>
  /** Why the values do not fit, when that is the reason: each field's problem. */
  readonly check?: TemplateCheck
}

/**
 * What a room offers this session for posting (Annex A, TD3, TD4): free text or not, and the
 * templates it may use. The composer (WP 4.2) shows these; the receiver checks every templated
 * message against the same rule (`checkTemplate`).
 */
export interface RoomTemplates {
  /**
   * The room's chat config, version 2 (a version 1 config reads as free text, no templates);
   * `undefined` while the room document loads, or for a room type without templates.
   */
  readonly config: ChatRoomConfig | undefined
  /** Free text may be posted here (TD3). True while the config is not known, as in v1. */
  readonly freeText: boolean
  /**
   * The templates this session may use here, in the config's order (TD4, provisional answer 4):
   * none for observers; every template the room names for the admin and the White Force's
   * writers. A template not (yet) loaded is left out.
   */
  readonly templates: readonly Template[]
}

/**
 * The map room's world state as this client accepts it (D25, PLY-58, PLY-59): the newest valid
 * world-state message from the admin's real JID, found by paging back through MAM on joining and
 * replaced live by later ones. Messages from anyone else, and invalid ones, are ignored.
 */
export interface WorldStateView {
  readonly roomId: string
  /** The newest accepted world state; undefined while none has been found. */
  readonly state: WorldState | undefined
  /** The stanza-id and server time of the message it came in. */
  readonly stanzaId: string | undefined
  readonly timestamp: string | undefined
  /** Still paging back through the archive for one. */
  readonly searching: boolean
  /**
   * The archive was searched to its start and held no valid world state from the admin: the
   * admin has not published one yet.
   */
  readonly none: boolean
  /**
   * The search reached its page limit with older messages still in the archive and no valid
   * world state from the admin among the newer ones: there may be one further back, behind many
   * other messages (a modified client can post them, WP 5.7 review). Not `none`: nothing may be
   * built on the room being empty. `searchWorldStateFurther` looks again.
   */
  readonly unreached: boolean
  /** Messages in the room that were not accepted: not from the admin, or not a valid state. */
  readonly ignored: number
}

/**
 * What the admin asks for when moving the game on (ADM-43), and optionally the world state to
 * publish with the change (ADM-45, WP 5.6).
 */
export interface AdvancePhaseOptions {
  /**
   * The turn state the admin confirmed moving on from. If `game-state` holds anything else by
   * the time the change is sent (another admin tab moved it first), nothing is sent: `stale`.
   */
  readonly from: GameState
  /**
   * A full world state to publish to the map room with the change (ADM-45), sent with
   * `sendWorldState` before `game-state` moves. If it is refused, the phase does not change.
   */
  readonly worldState?: { readonly roomId: string; readonly state: WorldState }
}

/** A phase change the admin made: from where, to where. */
export interface PhaseChange {
  readonly from: GameState
  readonly to: GameState
}

export interface RoomWatch {
  readonly joined: Joined
  readonly release: Release
}

export interface SessionStoreOptions {
  readonly session: Session
  readonly logger?: Logger
  /**
   * MAM page size in the map room, whose messages are full world states of up to 500 KB each
   * (D25): small pages, so the newest is found without fetching megabytes. Default 5.
   */
  readonly worldStatePageSize?: number
  /** Most pages paged back for a world state before giving up (PLY-59). Default 40. */
  readonly worldStatePageLimit?: number
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
  /** The turn state, `game-state` (D7, PLY-55): turn number and phase, live. */
  gameState(): Snapshot<GameState | undefined>
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
  /** Login names keyed to authors, deleted roles included (§3 rule 6). */
  authors(): Snapshot<ReadonlyMap<string, Author>>
  /** The last names of deleted forces and roles (§3 rule 1); never used for access. */
  retired(): Snapshot<readonly Retired[]>
  /** Every message template in the game, by name (Annex A, TPL-1). */
  templates(): Snapshot<readonly Template[]>
  /** What the room offers this session for posting: free text, and its templates (TD3, TD4). */
  roomTemplates(roomId: string): Snapshot<RoomTemplates>
  /**
   * The receiver's check of a templated message (TPL-6): `undefined` for any other message.
   * Re-run as templates, the room's config and the documents change; cached per entry.
   */
  checkTemplate(entry: ReadableEntry): TemplateCheck | undefined

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
  /**
   * Posts a templated message (TPL-3) after the receiver's own check, run on this session as the
   * sender: the room offers the template to it, the values fit, pickers name known forces and
   * roles. Refused when any fails, or over the stanza cap (PLY-53); the values come back.
   */
  sendTemplateMessage(
    roomId: string,
    templateId: string,
    values: Readonly<Record<string, TemplateValue>>,
  ): Promise<{ ok: true; value: { stanzaId: string } } | { ok: false; error: TemplateSendError }>
  /** Tries a closed or withdrawn room once more, on the user's request. */
  rejoinRoom(roomId: string): Promise<DomainResult<Joined>>
  /**
   * Joins the map room and looks for its world state (PLY-59): reference-counted like
   * `acquireRoom`, with small MAM pages, paging back to the newest valid one from the admin.
   */
  acquireWorldState(roomId: string): Release
  /**
   * After a search that stopped at its page limit (`unreached`), pages back once more, up to the
   * limit again, from where it stopped. Does nothing while a search runs or once one is found.
   */
  searchWorldStateFurther(roomId: string): Promise<void>
  /** The map room's accepted world state (PLY-58, PLY-59); see {@link WorldStateView}. */
  worldState(roomId: string): Snapshot<WorldStateView | undefined>
  /**
   * Posts the full world state to the map room, as the admin only (D25): checked against the
   * schema, the room's type and the 500 KB map-room cap (PLY-53) before it is sent.
   */
  sendWorldState(roomId: string, state: WorldState): Promise<DomainResult<{ stanzaId: string }>>
  /** The admin only (§3 rule 14, D21); refused for every role before anything is sent. */
  publishObjectives(forceId: string, markdown: string): Promise<DomainResult<void>>
  /** The admin only (PLY-37). */
  postAnnouncement(text: string): Promise<DomainResult<void>>
  /**
   * The admin only (ADM-43): moves the game from `options.from` to its next phase
   * (`nextGameState`) and publishes it to `game-state`. Refused before sending for any role,
   * when `game-state` no longer holds `from` (`stale`), when none is published (`not-found`), and
   * after the last turn (`invalid`). With `options.worldState`, publishes it first (ADM-45), and
   * refuses the change if it is refused.
   */
  advancePhase(options: AdvancePhaseOptions): Promise<DomainResult<PhaseChange>>
  /**
   * Retries the nodes that failed and picks up what the directory names; run after a design
   * change and on reconnection. Nodes are never listed: rooms, forces and roles are found from
   * `directory` (PLY-60).
   */
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
  unsentTemplate: UnsentTemplateMessage | undefined
  /** Watched for its world state (`acquireWorldState`): small pages, and the search below. */
  world: boolean
  /** The search back through MAM for a world state, while it runs. */
  seeking: Promise<void> | undefined
  /** A search has finished since the last join. */
  sought: boolean
  /** Ignored messages dropped from a world-state room's timeline (R26), still counted. */
  droppedIgnored: number
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
  private readonly worldStatePageSize: number
  private readonly worldStatePageLimit: number
  private readonly gapPageLimit: number
  private readonly now: () => string
  private readonly newId: () => string
  private readonly defer: (task: () => void) => void
  /** One validator for the session: composer and receiver checks share its cache (TPL-6). */
  private readonly templateValidator: TemplateValidator = createTemplateValidator()
  private readonly templateChecks = new WeakMap<
    TimelineEntry,
    { deps: readonly unknown[]; value: TemplateCheck }
  >()

  private readonly listeners = new Set<() => void>()
  private readonly nodes = new Map<string, NodeEntry>()
  private readonly roomEntries = new Map<string, RoomEntry>()
  private readonly core = new Map<string, Release>()
  private readonly memos = new Map<string, { deps: readonly unknown[]; value: unknown }>()
  private readonly offSession: Unsubscribe[] = []
  private readonly readyWaiters: ((status: StoreStatus) => void)[] = []
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
    this.worldStatePageSize = options.worldStatePageSize ?? 5
    this.worldStatePageLimit = options.worldStatePageLimit ?? 40
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
      loginName: this.session.anonymous || isAdmin ? undefined : local,
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
    // Each pass may reveal nodes to add: the directory's forces, roles and rooms, then the
    // role's force, then that force's objectives.
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
      // In the server's order (`latest`), then what arrived live during the fetch, newer still.
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
      // Before the items go: the own role is found from them (by login name).
      const ownRole = this.isOwnRoleNode(entry.node)
      entry.items.clear()
      entry.touched?.clear()
      entry.touched = undefined
      entry.status = 'error'
      entry.error = { code: 'not-found', message: `${entry.node} was deleted` }
      this.nodeChanged(entry)
      if (ownRole) void this.endSession('deleted')
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
      // Delete first so the newest item is last in the map's order (`latest`).
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
      // A structural change (rule 8): retry what failed, since access may have changed. New
      // forces, roles and rooms come from the directory, which is read live (PLY-60).
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
    const role = this.ownRole()
    return role !== undefined && node === safeNodeName('role', role.id)
  }

  /**
   * This session's role: the role document whose login name is the session's (§3 rule 1). The
   * `directory` says which document that is, so it is read without listing nodes; it is only a
   * pointer, and a role document is taken only if it carries this login name (failing closed).
   * Two documents claiming the login name: the one the directory names, else the first in order.
   */
  private ownRole(): Role | undefined {
    const login = this.identity.loginName
    if (login === undefined) return undefined
    const pointed = this.directoryRoleId(login)
    const pointedRole = pointed === undefined ? undefined : this.docOf('role', pointed)
    if (pointedRole?.loginName === login) return pointedRole
    return this.collection('role').find((r) => r.loginName === login)
  }

  /** The `directory` document, if this session has read it. */
  private directory(): Directory | undefined {
    const entry = this.nodes.get(SINGLETON_NODES.directory)
    return documentValue(entry === undefined ? undefined : latest(entry), 'directory')
  }

  /** The role GUID the `directory` gives for a login name. */
  private directoryRoleId(login: string): string | undefined {
    return this.directory()?.roles.find((r) => r.loginName === login)?.id
  }

  /** The nodes the store itself holds: everything the session's documents need. */
  private desiredCore(): Set<string> {
    const desired = new Set<string>([SINGLETON_NODES.gameSetup])
    if (this.identity.anonymous) return desired
    desired.add(SINGLETON_NODES.announcements)
    // The deleted-entity records, for message authors only; nothing reads them for access.
    desired.add(SINGLETON_NODES.retired)
    // Where the documents are, so neither the own role nor the rest needs node listing.
    desired.add(SINGLETON_NODES.directory)
    // Message templates, read by every role (Annex A, TPL-1).
    desired.add(SINGLETON_NODES.templates)
    // The turn state, read by every role (D7, §3 rule 15).
    desired.add(SINGLETON_NODES.gameState)
    const add = (node: string | undefined) => {
      if (node !== undefined) desired.add(node)
    }
    // PLY-60: every force, role and room the directory names, read and kept live by
    // subscription; the directory itself is subscribed, so one created or deleted during the
    // session is picked up (or dropped) when the admin publishes the new directory. Nodes are
    // never listed. Each room document is read, and the role's rooms are those rule 4 gives it
    // (`me`). With no directory the role finds nothing (failing closed).
    const directory = this.directory()
    if (directory !== undefined) {
      for (const f of directory.forces) add(safeNodeName('force', f))
      for (const r of directory.roles) add(safeNodeName('role', r.id))
      for (const r of directory.rooms) add(safeNodeName('room', r))
    }
    const role = this.ownRole()
    const force = role === undefined ? undefined : this.docOf('force', role.forceId)
    const allObjectives = this.identity.isAdmin || force?.isUmpire === true
    if (allObjectives) {
      for (const force of this.collection('force')) add(safeNodeName('objectives', force.id))
    }
    if (role !== undefined) {
      add(safeNodeName('role', role.id))
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

  refresh(): Promise<void> {
    if (this.isEnded() || this.identity.anonymous) return Promise.resolve()
    this.reconcileCore()
    for (const entry of this.nodes.values()) {
      if (entry.status === 'error' && entry.loading === undefined) void this.loadNode(entry)
    }
    return Promise.resolve()
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

  gameState(): Snapshot<GameState | undefined> {
    return this.typedDocument('game-state', SINGLETON_NODES.gameState)
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
    const role = this.ownRole()
    const roleId = role?.id
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
        canEditObjectives: canEditObjectives({
          isAdmin: this.identity.isAdmin,
          isUmpire: force?.isUmpire === true,
          isObserver: role?.isObserver === true,
        }),
        rooms: Object.freeze(visible),
      })
    })
    return this.memo('me', [me, this.currentStatus], () => this.collectionStatus(me))
  }

  retired(): Snapshot<readonly Retired[]> {
    const data = this.retiredList()
    return this.memo('retired', [data, this.currentStatus], () => this.collectionStatus(data))
  }

  private retiredList(): readonly Retired[] {
    const entry = this.nodes.get(SINGLETON_NODES.retired)
    if (entry === undefined) return EMPTY_RETIRED
    return this.memo('retired-list', [entry, entry.version], () => {
      const list: Retired[] = []
      for (const item of entry.items.values()) {
        // The item id is the entity's GUID; a record under another id is ignored.
        if (item.doc.kind === 'retired' && item.doc.value.id === item.id) list.push(item.doc.value)
      }
      return Object.freeze(list.sort((a, b) => compareStrings(a.id, b.id)))
    })
  }

  templates(): Snapshot<readonly Template[]> {
    const data = this.templateList()
    return this.memo('templates', [data, this.currentStatus], () => this.collectionStatus(data))
  }

  private templateList(): readonly Template[] {
    const entry = this.nodes.get(SINGLETON_NODES.templates)
    if (entry === undefined) return EMPTY_TEMPLATES
    return this.memo('template-list', [entry, entry.version], () => {
      const list: Template[] = []
      for (const item of entry.items.values()) {
        // The item id is the template's GUID; a template under another id is ignored.
        if (item.doc.kind === 'template' && item.doc.value.id === item.id) list.push(item.doc.value)
      }
      return Object.freeze(
        list.sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.id, b.id)),
      )
    })
  }

  /** A chat room's config, version 2; undefined until its documents load, or for other types. */
  private chatConfig(roomId: string): ChatRoomConfig | undefined {
    const room = this.docOf('room', roomId)
    const game = documentValue(this.document(SINGLETON_NODES.gameSetup).data, 'game-setup')
    return this.memo(`chat-config:${roomId}`, [room, game], () => {
      if (room?.roomType !== 'chat') return undefined
      const config = roomConfig(this.registry, room, game)
      if (!config.ok) {
        this.logger.warn('Invalid room config', { room: roomId, error: config.error })
        return undefined
      }
      const parsed = chatRoomConfigReader.safeParse(config.value)
      return parsed.success ? parsed.data : undefined
    })
  }

  roomTemplates(roomId: string): Snapshot<RoomTemplates> {
    const config = this.chatConfig(roomId)
    const all = this.templateList()
    const role = this.ownRole()
    const forces = this.collection('force')
    const value = this.memo(
      `room-templates-value:${roomId}`,
      [config, all, role, forces],
      (): RoomTemplates => {
        if (config === undefined) return Object.freeze({ config, freeText: true, templates: [] })
        const ids = templatesFor(config, { isAdmin: this.identity.isAdmin, role }, forces)
        const templates = ids.flatMap((id) => all.filter((t) => t.id === id))
        return Object.freeze({
          config,
          freeText: config.freeText,
          templates: Object.freeze(templates),
        })
      },
    )
    return this.memo(`room-templates:${roomId}`, [value, this.currentStatus], () =>
      this.collectionStatus(value),
    )
  }

  checkTemplate(entry: ReadableEntry): TemplateCheck | undefined {
    const body = entry.body
    if (body.type !== 'template') return undefined
    const template = this.templateList().find((t) => t.id === body.content.templateId)
    const config = this.chatConfig(entry.roomId)
    const forces = this.collection('force')
    const roles = this.collection('role')
    const retired = this.retiredList()
    const deps = [template, config, forces, roles, retired]
    const cached = this.templateChecks.get(entry)
    if (cached !== undefined && sameDeps(cached.deps, deps)) return cached.value
    // An unknown room config offers nothing, so every templated message is not permitted until
    // it loads; the schema checks still run.
    const value = checkTemplatedMessage(
      body,
      template,
      config ?? { schemaVersion: 2, freeText: true, templates: [] },
      entry.sender,
      { forces, roles, retired },
      { validator: this.templateValidator },
    )
    this.templateChecks.set(entry, { deps, value })
    return value
  }

  authors(): Snapshot<ReadonlyMap<string, Author>> {
    const forces = this.collection('force')
    const roles = this.collection('role')
    const retired = this.retiredList()
    const map = this.memo('authors-value', [forces, roles, retired], () => {
      const byForce = new Map(forces.map((f) => [f.id, f]))
      const authors = new Map<string, Author>()
      // Deleted roles first, so a current role's document wins should a login name ever be in
      // both (the design check and the editor refuse that, §3 rule 1).
      for (const record of retired) {
        if (record.kind !== 'role' || record.loginName === undefined) continue
        if (record.loginName === ADMIN_AUTHOR_ID) continue
        authors.set(record.loginName, {
          roleId: record.id,
          loginName: record.loginName,
          name: record.name,
          forceId: '',
          forceName: undefined,
          colour: record.colour,
          deleted: true,
        })
      }
      for (const role of roles) {
        if (role.loginName === ADMIN_AUTHOR_ID) continue
        const force = byForce.get(role.forceId)
        authors.set(role.loginName, {
          roleId: role.id,
          loginName: role.loginName,
          name: role.name,
          forceId: role.forceId,
          forceName: force?.name,
          colour: force?.colour,
          deleted: false,
        })
      }
      // The admin is the umpire, in the White Force. `admin` is a reserved login name, so a role
      // document claiming it cannot take the umpire's label (skipped above).
      const white = whiteForceOf(forces)
      authors.set(ADMIN_AUTHOR_ID, {
        roleId: ADMIN_AUTHOR_ID,
        loginName: ADMIN_AUTHOR_ID,
        name: UMPIRE_NAME,
        forceId: white?.id ?? '',
        forceName: white?.name,
        colour: white?.colour,
        deleted: false,
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
      unsentTemplate: undefined,
      world: false,
      seeking: undefined,
      sought: false,
      droppedIgnored: 0,
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
    entry.sought = false
    this.attachRoom(entry)
    this.roomChanged(entry)
    const nick = this.identity.loginName ?? localpart(this.identity.bareJid) ?? 'admin'
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
      if (current() && entry.world) void this.seekWorldState(entry)
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
    const page = await this.session.mam.queryRoom(entry.jid, { max: this.pageSizeOf(entry) })
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
    const max = this.pageSizeOf(entry)
    for (let i = 0; i < this.gapPageLimit; i++) {
      const query = before === undefined ? { max } : { before, max }
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
    entry.droppedIgnored = 0
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
    const added = entry.timeline.merge(entries)
    if (added > 0 && entry.world) this.trimWorldState(entry)
    return added
  }

  /**
   * R26: a room watched for its world state keeps only its newest accepted world state. Each is
   * the full state (about 100 KB at 600 assets, up to 500 KB), the panel shows only the newest,
   * and a modified client's posts are never shown, so nothing else is worth its memory. Dropped
   * ids stay known to the timeline, so paging back never adds them again.
   */
  private trimWorldState(entry: RoomEntry): void {
    const removed = entry.timeline.retainOnly(this.acceptedWorldState(entry)?.id)
    for (const dropped of removed) {
      if (!(dropped.kind === 'message' && this.isAccepted(dropped))) entry.droppedIgnored++
    }
  }

  private isAccepted(entry: ReadableEntry): boolean {
    return entry.body.type === 'world-state' && entry.sender.isAdmin
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
      if (roomType === MAP_ROOM_TYPE) {
        this.logger.warn('Ignoring a map-room message that is not a world state', {
          room: entry.roomId,
          stanzaId: message.stanzaId,
        })
      }
      return { ...base, kind: 'unreadable', reason: `not a ${definition.type} message` }
    }
    // PLY-58: only the admin's world states count; anyone else's is ignored, and logged.
    if (parsed.value.type === 'world-state' && !base.sender.isAdmin) {
      this.logger.warn('Ignoring a world state not from the admin', {
        room: entry.roomId,
        stanzaId: message.stanzaId,
        from: base.sender.jid,
      })
    }
    return { ...base, kind: 'message', body: parsed.value }
  }

  /** Identity from the occupant JID only, never the body (§3 rule 3). */
  private toSender(nick: string, jid: string | undefined): Sender {
    const bare = jid === undefined ? undefined : bareJid(jid)
    const onDomain = bare !== undefined && domainpart(bare) === this.identity.domain
    const local = onDomain ? localpart(bare) : undefined
    const isAdmin = local === 'admin'
    return { nick, jid: bare, loginName: isAdmin ? undefined : local, isAdmin }
  }

  private toOccupant(event: OccupantEvent): Occupant {
    const sender = this.toSender(event.nick, event.jid)
    return {
      nick: event.nick,
      jid: sender.jid,
      loginName: sender.loginName,
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
        unsentTemplate: entry.unsentTemplate,
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

  // ---- The map room's world state (D25, PLY-58, PLY-59) ----------------------------------

  /** MAM page size for a room: small in a room watched for its world state. */
  private pageSizeOf(entry: RoomEntry): number {
    return entry.world ? this.worldStatePageSize : this.pageSize
  }

  acquireWorldState(roomId: string): Release {
    const existing = this.roomEntries.get(roomId)
    const release = this.acquireRoom(roomId)
    const entry = this.roomEntries.get(roomId)
    if (entry === undefined) return release
    if (!entry.world) {
      entry.world = true
      this.trimWorldState(entry)
      // Joined already, for another reason: look now. A join under way looks when it is done.
      if (existing !== undefined && entry.status === 'joined' && entry.historyLoaded) {
        void this.seekWorldState(entry)
      }
    }
    return release
  }

  searchWorldStateFurther(roomId: string): Promise<void> {
    const entry = this.roomEntries.get(roomId)
    if (entry === undefined || !entry.world || entry.status !== 'joined') return Promise.resolve()
    return this.seekWorldState(entry)
  }

  /**
   * Pages back from the oldest message held until a valid world state from the admin is among
   * them, the archive ends, or the page limit is reached (PLY-59). Once is enough per join: live
   * messages then keep the timeline current.
   */
  private seekWorldState(entry: RoomEntry): Promise<void> {
    if (entry.seeking !== undefined) return entry.seeking
    const generation = entry.generation
    const run = async () => {
      for (let page = 0; page < this.worldStatePageLimit; page++) {
        if (entry.generation !== generation || entry.status !== 'joined') return
        if (this.acceptedWorldState(entry) !== undefined || !entry.hasOlder) return
        const older = await this.loadOlder(entry.roomId)
        if (!older.ok) {
          this.logger.warn('Could not page back for the world state', {
            room: entry.roomId,
            error: older.error,
          })
          return
        }
      }
      if (this.acceptedWorldState(entry) === undefined && entry.hasOlder) {
        this.logger.warn('No world state within the page limit', {
          room: entry.roomId,
          pages: this.worldStatePageLimit,
        })
      }
    }
    const seeking = run().finally(() => {
      if (entry.seeking === seeking) entry.seeking = undefined
      if (entry.generation === generation) entry.sought = true
      this.roomChanged(entry)
    })
    entry.seeking = seeking
    this.roomChanged(entry)
    return seeking
  }

  /** The newest timeline entry that is a valid world state from the admin's real JID. */
  private acceptedWorldState(
    entry: RoomEntry,
  ): (ReadableEntry & { readonly body: { readonly type: 'world-state' } }) | undefined {
    const entries = entry.timeline.entries()
    for (let i = entries.length - 1; i >= 0; i--) {
      const candidate = entries[i]
      if (candidate?.kind !== 'message') continue
      // The body passed the message schema (refinements included) when it was merged.
      if (candidate.body.type === 'world-state' && candidate.sender.isAdmin) {
        return candidate as ReadableEntry & { readonly body: { readonly type: 'world-state' } }
      }
    }
    return undefined
  }

  worldState(roomId: string): Snapshot<WorldStateView | undefined> {
    const entry = this.roomEntries.get(roomId)
    if (entry === undefined) return LOADING
    return this.memo(`world-state:${roomId}`, [entry, entry.version], () => {
      const accepted = this.acceptedWorldState(entry)
      const total = entry.timeline.size
      const view: WorldStateView = Object.freeze({
        roomId,
        state: accepted?.body.type === 'world-state' ? accepted.body.content : undefined,
        stanzaId: accepted?.id,
        timestamp: accepted?.timestamp,
        searching: entry.seeking !== undefined,
        none: accepted === undefined && entry.sought && !entry.hasOlder,
        unreached: accepted === undefined && entry.sought && entry.hasOlder,
        ignored: total - this.acceptedCount(entry) + entry.droppedIgnored,
      })
      const settled = accepted !== undefined || entry.sought
      const status: LoadStatus =
        entry.status === 'joined'
          ? settled
            ? 'ready'
            : 'loading'
          : entry.status === 'joining'
            ? 'loading'
            : 'error'
      const error =
        entry.status === 'closed'
          ? { code: 'not-joined' as const, message: `closed: ${entry.closeReason ?? 'removed'}` }
          : entry.error
      return Object.freeze({ data: view, status, error })
    })
  }

  /** How many messages in the room are valid world states from the admin. */
  private acceptedCount(entry: RoomEntry): number {
    let n = 0
    for (const e of entry.timeline.entries()) {
      if (e.kind === 'message' && e.body.type === 'world-state' && e.sender.isAdmin) n++
    }
    return n
  }

  async sendWorldState(
    roomId: string,
    state: WorldState,
  ): Promise<DomainResult<{ stanzaId: string }>> {
    if (this.isEnded()) return domainErr('session-ended', 'the session has ended')
    // D25: clients accept world states only from the admin, so nobody else may post one.
    if (!this.identity.isAdmin) {
      return domainErr('not-permitted', 'only the admin publishes the world state (D25)')
    }
    const entry = this.roomEntries.get(roomId)
    if (entry?.status !== 'joined' || entry.joined === undefined) {
      return domainErr('not-joined', 'the room is not joined')
    }
    if (this.docOf('room', roomId)?.roomType !== MAP_ROOM_TYPE) {
      return domainErr('invalid', 'world states go to the map room only')
    }
    const candidate = parseDocument('message', {
      type: 'world-state',
      schemaVersion: 1,
      content: state,
    })
    if (!candidate.ok || candidate.value.type !== 'world-state') {
      return domainErr(
        'invalid',
        candidate.ok ? 'not a world state' : `not a valid world state: ${candidate.error.message}`,
      )
    }
    const json = JSON.stringify(candidate.value)
    // PLY-53: the map-room cap, for world states only; the transport enforces it again.
    const size = fitsWorldStateStanza(json)
    if (!size.ok) {
      return domainErr(
        'too-large',
        `the world state is ${size.bytes} bytes; the limit is ${size.limitBytes}`,
      )
    }
    const sent = await this.session.muc.send(entry.jid, json, {
      maxBytes: LIMITS.worldStateStanzaBytes,
    })
    if (!sent.ok) {
      const error = fromTransport(sent.error, 'Publishing the world state')
      return {
        ok: false,
        error: error.code === 'access-withdrawn' ? { ...error, code: 'not-permitted' } : error,
      }
    }
    return domainOk({ stanzaId: sent.value.stanzaId })
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
    const max = this.pageSizeOf(entry)
    const run = async (): Promise<DomainResult<{ added: number; complete: boolean }>> => {
      const query = before === undefined ? { max } : { before, max }
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
    if (this.postingPaused()) return refuse(PAUSED)
    // TD3: a room may take templates only. Advisory, like every template rule (T-R1).
    if (!this.roomTemplates(roomId).data.freeText) {
      return refuse({ code: 'not-permitted', message: 'this room takes templated messages only' })
    }
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

  async sendTemplateMessage(
    roomId: string,
    templateId: string,
    values: Readonly<Record<string, TemplateValue>>,
  ): Promise<{ ok: true; value: { stanzaId: string } } | { ok: false; error: TemplateSendError }> {
    const entry = this.roomEntries.get(roomId)
    const refuse = (error: DomainError, check?: TemplateCheck) => {
      const sendError: TemplateSendError = {
        ...error,
        templateId,
        unsentValues: values,
        ...(check === undefined ? {} : { check }),
      }
      if (entry !== undefined) {
        entry.unsentTemplate = { templateId, values, error: sendError }
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
    if (this.postingPaused()) return refuse(PAUSED)
    const candidate = parseDocument('message', {
      type: 'template',
      schemaVersion: 1,
      content: { templateId, values },
    })
    if (!candidate.ok || candidate.value.type !== 'template') {
      return refuse({ code: 'invalid', message: 'not a valid templated message' })
    }
    const body = candidate.value
    const template = this.templateList().find((t) => t.id === templateId)
    const config = this.chatConfig(roomId)
    if (template === undefined || config === undefined) {
      return refuse({ code: 'not-permitted', message: 'this room does not offer that template' })
    }
    // The receiver's check, with this session as the sender, so what is sent is what every
    // receiver accepts (TPL-6, T-R1).
    const check = checkTemplatedMessage(
      body,
      template,
      config,
      { loginName: this.identity.loginName, isAdmin: this.identity.isAdmin },
      {
        forces: this.collection('force'),
        roles: this.collection('role'),
        retired: this.retiredList(),
      },
      { validator: this.templateValidator },
    )
    if (check.status === 'not-permitted') {
      return refuse({ code: 'not-permitted', message: check.message }, check)
    }
    if (check.status === 'invalid')
      return refuse({ code: 'invalid', message: check.message }, check)
    const json = JSON.stringify(body)
    const size = fitsInStanza(json)
    if (!size.ok) {
      return refuse({
        code: 'too-large',
        message: `the message is ${size.bytes} bytes; the limit is ${size.limitBytes}`,
      })
    }
    const sent = await this.session.muc.send(entry.jid, json)
    if (!sent.ok) {
      const error = fromTransport(sent.error, 'Sending')
      return refuse(error.code === 'access-withdrawn' ? { ...error, code: 'not-permitted' } : error)
    }
    if (entry.unsentTemplate !== undefined) {
      entry.unsentTemplate = undefined
      this.roomChanged(entry)
    }
    return { ok: true, value: { stanzaId: sent.value.stanzaId } }
  }

  async publishObjectives(forceId: string, markdown: string): Promise<DomainResult<void>> {
    if (this.isEnded()) return domainErr('session-ended', 'the session has ended')
    const me = this.me().data
    if (!me.canEditObjectives) {
      return domainErr(
        'not-permitted',
        'only the admin and White Force roles that are not observers edit objectives (PLY-35)',
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
    // §3 rule 14: every save is a new item with a fresh id, never a re-published one, so the
    // server's order (by first publish) is edit order; the node keeps one item per author.
    const author = this.identity.isAdmin ? ADMIN_AUTHOR_ID : (me.identity.loginName ?? 'role')
    const itemId = objectivesItemId(author, this.newId())
    return this.publish(node, itemId, parsed.value, 'Publishing objectives')
  }

  /** PLY-56 for this store's own session: adjudication, and outside the White Force (R27). */
  private postingPaused(): boolean {
    return postingPaused(this.me().data, this.gameState().data)
  }

  async advancePhase(options: AdvancePhaseOptions): Promise<DomainResult<PhaseChange>> {
    if (this.isEnded()) return domainErr('session-ended', 'the session has ended')
    if (!this.identity.isAdmin) {
      return domainErr('not-permitted', 'only the admin advances the game (ADM-43)')
    }
    const current = this.gameState().data
    if (current === undefined) return domainErr('not-found', 'no turn state is published yet')
    if (!sameGameState(current, options.from)) {
      return domainErr(
        'stale',
        `the game is at turn ${current.turn} ${current.phase}, not turn ${options.from.turn} ${options.from.phase}`,
      )
    }
    const next = nextGameState(current)
    if (next === undefined) return domainErr('invalid', 'the last turn has no next phase')
    const parsed = parseDocument('game-state', next)
    if (!parsed.ok) return domainErr('invalid', parsed.error.message)
    // ADM-45: the world state first, so players never see the new phase with the old map. If it
    // is refused (too large, not joined), the phase stays where it is.
    if (options.worldState !== undefined) {
      const sent = await this.sendWorldState(options.worldState.roomId, options.worldState.state)
      if (!sent.ok) {
        return {
          ok: false,
          error: {
            ...sent.error,
            message: `the world state was not published, so the phase did not change: ${sent.error.message}`,
          },
        }
      }
    }
    const published = await this.publish(
      SINGLETON_NODES.gameState,
      DOCUMENT_ITEM_ID,
      parsed.value,
      'Advancing the game',
    )
    if (!published.ok) return published
    return domainOk(Object.freeze({ from: current, to: parsed.value }))
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
    this.docsVersion++
    this.setStatus(
      text === undefined ? { state: 'ended', reason } : { state: 'ended', reason, text },
    )
  }
}

function noop(): void {
  return undefined
}

const EMPTY_RETIRED: readonly Retired[] = Object.freeze([])

/** PLY-56: the advisory refusal of a post during adjudication (R27). */
const PAUSED: DomainError = Object.freeze({
  code: 'paused',
  message: 'posting is paused for roles outside the White Force during adjudication (PLY-56)',
})
const EMPTY_TEMPLATES: readonly Template[] = Object.freeze([])

/**
 * The document a node shows: the last item the store holds, the newest by the server's order
 * (§3 rule 14, spike check S15, review F11). Items carry no server time, so nothing here reads
 * a time, the author's `updatedAt` least of all:
 * - a fetch lists items in the order each id was first published (contract S15), and every
 *   objectives save is a new id, so the fetch's last item is the newest edit;
 * - live events arrive in publish order (contract S06) and each is appended, so a later event
 *   is newer than an earlier one and than anything fetched; a fetch that answers after a live
 *   event keeps that event's item last (`touched`);
 * - a retract (an author's trimmed item, or an owner's clean-up) removes the item, and the one
 *   before it shows.
 * Single-document nodes hold one item, so this is simply that item.
 */
function latest(entry: NodeEntry): LiveDocument | undefined {
  let last: NodeItem | undefined
  for (const item of entry.items.values()) last = item
  return last?.doc
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

/** The admin's key in `authors()`: the reserved account name, never a login name. */
export const ADMIN_AUTHOR_ID = 'admin'

/**
 * The White Force: the force with the umpire flag (glossary). The editor allows exactly one; if
 * a live game has several, the first in display order.
 */
export function whiteForceOf(forces: readonly Force[]): Force | undefined {
  return [...forces].filter((f) => f.isUmpire).sort(byOrderThenId)[0]
}

/**
 * PLY-35, §3 rule 14, D21: the admin and White Force roles that are not observers edit every
 * force's objectives; White Force observers and every other role only read (their own force's).
 * The server enforces it (publisher affiliations, `targetState`); this only shapes the UI.
 */
export function canEditObjectives(who: {
  readonly isAdmin: boolean
  readonly isUmpire: boolean
  readonly isObserver: boolean
}): boolean {
  return who.isAdmin || (who.isUmpire && !who.isObserver)
}
