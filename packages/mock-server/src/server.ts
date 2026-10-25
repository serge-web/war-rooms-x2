// The mock server (WP 1.4, D14, ARC-7): one instance is one ejabberd, in memory. It is a pure
// state machine: frames in, frames out, synchronously, with time from an injected Clock. It
// uses no browser API, so WP 1.5 can host it in a SharedWorker or a leader tab, and tests run
// it in Node. Behaviour follows the contract suite (ARC-10, ARC-11); see muc.ts and pubsub.ts.
import type { Result } from '@wrx/schemas'
import { err, ok } from '@wrx/transport'
import type { Credentials, EndReason, Services, TransportError } from '@wrx/transport'
import { MucService } from './muc.ts'
import type {
  ClientFrame,
  Reply,
  Request,
  ServerFrame,
  ServerLink,
  ServerPort,
} from './protocol.ts'
import { PubsubService } from './pubsub.ts'
import { MOCK_STATE_FORMAT, emptyState } from './state.ts'
import type { MockState } from './state.ts'
import { systemClock } from './time.ts'
import type { Clock } from './time.ts'
import { World, bareOf, compareStanzaIds } from './world.ts'
import type { Connection } from './world.ts'

type Outcome<T> = Result<T, TransportError>

export interface MockServerOptions {
  /**
   * The state to start from and to return to on `reset()`: a seed (see seed.ts) or an export.
   * Without one, the server holds only `admin@<domain>` with `adminPassword`.
   */
  readonly seed?: MockState
  /** Used when there is no seed. Default `localhost`. */
  readonly domain?: string
  /** Used when there is no seed. A demo password (NFR-6); default `admin`. */
  readonly adminPassword?: string
  /** Server time for stanza-ids and timestamps. Default: the system clock. */
  readonly clock?: Clock
  /** SASL ANONYMOUS (D20, NFR-21). Default true, as in the reference deployment. */
  readonly allowAnonymous?: boolean
  /** For anonymous JIDs and generated resources. Default Math.random. */
  readonly random?: () => number
}

const ok0: Outcome<undefined> = Object.freeze({ ok: true, value: undefined })

class Link implements Connection {
  readonly rooms = new Set<string>()
  private closed = false

  constructor(
    readonly id: number,
    readonly jid: string,
    readonly bare: string,
    readonly anonymous: boolean,
    readonly admin: boolean,
    private readonly sink: (frame: ServerFrame) => void,
  ) {}

  get isClosed(): boolean {
    return this.closed
  }

  send(frame: ServerFrame): void {
    if (!this.closed) this.sink(frame)
  }

  close(): void {
    this.closed = true
  }
}

export class MockServer implements ServerLink {
  private world: World
  private seed: MockState
  private readonly clock: Clock
  private readonly allowAnonymous: boolean
  private readonly random: () => number
  private muc: MucService
  private pubsub: PubsubService
  private nextConnection = 1

  constructor(options: MockServerOptions = {}) {
    this.clock = options.clock ?? systemClock
    this.allowAnonymous = options.allowAnonymous ?? true
    this.random = options.random ?? Math.random
    this.seed =
      options.seed ?? emptyState(options.domain ?? 'localhost', options.adminPassword ?? 'admin')
    this.world = this.load(this.seed)
    this.muc = new MucService(this.world)
    this.pubsub = new PubsubService(this.world)
  }

  get domain(): string {
    return this.world.domain
  }

  get services(): Services {
    return this.world.services
  }

  /** Bound sessions, for test assertions and the multi-client view. */
  sessions(): readonly string[] {
    return [...this.world.connections].map((c) => c.jid)
  }

  // ---- connections --------------------------------------------------------------------------

  /** Opens one connection. Frames to the server go through the port; frames back to `sink`. */
  attach(sink: (frame: ServerFrame) => void): ServerPort {
    let conn: Link | undefined
    let done = false
    return {
      send: (frame: ClientFrame) => {
        if (done) return
        switch (frame.t) {
          case 'login': {
            if (conn !== undefined) return
            const bound = this.login(frame.credentials, frame.resource, sink)
            if (bound.ok) {
              conn = bound.value
              sink({
                t: 'bound',
                jid: conn.jid,
                anonymous: conn.anonymous,
                services: this.services,
              })
            } else {
              done = true
              sink({ t: 'refused', error: bound.error })
            }
            return
          }
          case 'request': {
            if (conn === undefined || conn.isClosed) return
            const reply = this.handle(conn, frame.request)
            conn.send({ t: 'reply', id: frame.id, reply })
            return
          }
          case 'logout': {
            done = true
            if (conn === undefined || conn.isClosed) return
            this.close(conn, { t: 'closed' })
            return
          }
          case 'drop': {
            done = true
            if (conn !== undefined && !conn.isClosed) this.close(conn, undefined)
            return
          }
        }
      },
    }
  }

  /** RFC 6120 §6 SASL and §7 binding (S00, S10). */
  private login(
    credentials: Credentials,
    resource: string | undefined,
    sink: (frame: ServerFrame) => void,
  ): Outcome<Link> {
    let bare: string
    let anonymous = false
    let admin = false
    if (credentials.kind === 'anonymous') {
      if (!this.allowAnonymous) return err('not-authorized', 'authentication failed', 'auth')
      bare = `${this.token(16)}@${this.world.domain}`
      anonymous = true
    } else {
      bare = bareOf(`${credentials.username}@${this.world.domain}`)
      const account = this.world.accounts.get(bare)
      // §6.5.10: a wrong password and an unknown account look the same (S00, C01 R-E).
      if (account?.password !== credentials.password) {
        return err('not-authorized', 'authentication failed', 'auth')
      }
      admin = account.admin
    }
    const jid = `${bare}/${resource === undefined || resource === '' ? this.token(12) : resource}`
    // A second stream on the same full JID replaces the first, which ejabberd ends with a
    // `conflict` stream error (resource_conflict: acceptnew; not covered by contract).
    for (const old of [...this.world.connections]) {
      if (old.jid === jid)
        this.close(old, { t: 'end', reason: 'account-removed', text: 'Replaced by new connection' })
    }
    const conn = new Link(this.nextConnection++, jid, bare, anonymous, admin, sink)
    this.world.connections.add(conn)
    return ok(conn)
  }

  private token(length: number): string {
    let out = ''
    while (out.length < length) out += Math.floor(this.random() * 36).toString(36)
    return out
  }

  /** Ends a connection: it leaves its rooms (others are told), then gets `last`, if any. */
  private close(conn: Connection, last: ServerFrame | undefined): void {
    if (!this.world.connections.has(conn)) return
    this.world.connections.delete(conn)
    this.muc.disconnect(conn)
    if (last !== undefined) conn.send(last)
    conn.close()
  }

  private endSessions(bare: string, reason: EndReason, text: string): void {
    for (const conn of this.world.sessionsOf(bare)) this.close(conn, { t: 'end', reason, text })
  }

  // ---- requests -----------------------------------------------------------------------------

  private handle(conn: Connection, request: Request): Reply {
    const { muc, pubsub } = this
    switch (request.op) {
      case 'muc.join':
        return { op: request.op, result: muc.join(conn, ...request.args) }
      case 'muc.leave':
        return { op: request.op, result: muc.leave(conn, ...request.args) }
      case 'muc.send':
        return { op: request.op, result: muc.send(conn, ...request.args) }
      case 'muc.setRole':
        return { op: request.op, result: muc.setRole(conn, ...request.args) }
      case 'muc.setAffiliations':
        return { op: request.op, result: muc.setAffiliations(conn, ...request.args) }
      case 'muc.getAffiliations':
        return { op: request.op, result: muc.getAffiliations(conn, ...request.args) }
      case 'muc.createRoom':
        return { op: request.op, result: muc.createRoom(conn, ...request.args) }
      case 'muc.configureRoom':
        return { op: request.op, result: muc.configureRoom(conn, ...request.args) }
      case 'muc.getRoomConfig':
        return { op: request.op, result: muc.getRoomConfig(conn, ...request.args) }
      case 'muc.destroyRoom':
        return { op: request.op, result: muc.destroyRoom(conn, ...request.args) }
      case 'muc.listRooms':
        return { op: request.op, result: muc.listRooms(conn) }
      case 'mam.queryRoom':
        return { op: request.op, result: muc.queryArchive(conn, ...request.args) }
      case 'pubsub.getItems':
        return { op: request.op, result: pubsub.getItems(conn, ...request.args) }
      case 'pubsub.publish':
        return { op: request.op, result: pubsub.publish(conn, ...request.args) }
      case 'pubsub.retract':
        return { op: request.op, result: pubsub.retract(conn, ...request.args) }
      case 'pubsub.subscribe':
        return { op: request.op, result: pubsub.subscribe(conn, ...request.args) }
      case 'pubsub.unsubscribe':
        return { op: request.op, result: pubsub.unsubscribe(conn, ...request.args) }
      case 'pubsub.listNodes':
        return { op: request.op, result: pubsub.listNodes() }
      case 'pubsub.createNode':
        return { op: request.op, result: pubsub.createNode(conn, ...request.args) }
      case 'pubsub.configureNode':
        return { op: request.op, result: pubsub.configureNode(conn, ...request.args) }
      case 'pubsub.getNodeConfig':
        return { op: request.op, result: pubsub.getNodeConfig(conn, ...request.args) }
      case 'pubsub.deleteNode':
        return { op: request.op, result: pubsub.deleteNode(conn, ...request.args) }
      case 'pubsub.getAffiliations':
        return { op: request.op, result: pubsub.getAffiliations(conn, ...request.args) }
      case 'pubsub.setAffiliations':
        return { op: request.op, result: pubsub.setAffiliations(conn, ...request.args) }
      case 'pubsub.getSubscriptions':
        return { op: request.op, result: pubsub.getSubscriptions(conn, ...request.args) }
      case 'pubsub.setSubscriptions':
        return { op: request.op, result: pubsub.setSubscriptions(conn, ...request.args) }
      case 'admin.onlineUsers':
        return { op: request.op, result: this.onlineUsers(conn) }
      case 'admin.addUser':
        return { op: request.op, result: this.addUser(conn, ...request.args) }
      case 'admin.deleteUser':
        return { op: request.op, result: this.deleteUser(conn, ...request.args) }
      case 'admin.changePassword':
        return { op: request.op, result: this.changePassword(conn, ...request.args) }
      case 'admin.endUserSessions':
        return { op: request.op, result: this.endUserSessions(conn, ...request.args) }
      case 'admin.getPrivate':
        return { op: request.op, result: this.getPrivate(conn, ...request.args) }
      case 'admin.setPrivate':
        return { op: request.op, result: this.setPrivate(conn, ...request.args) }
    }
  }

  // ---- XEP-0133 service administration and XEP-0049 private storage ---------------------------

  /** XEP-0133 is for server admins only: ejabberd answers `forbidden` (S04, S10). */
  private requireAdmin(conn: Connection): Outcome<undefined> {
    return conn.admin ? ok0 : err('forbidden', 'Access denied by service policy', 'auth')
  }

  /** §4.18: bare JIDs, each once (S04). */
  private onlineUsers(conn: Connection): Outcome<readonly string[]> {
    const allowed = this.requireAdmin(conn)
    if (!allowed.ok) return allowed
    return ok([...new Set([...this.world.connections].map((c) => c.bare))])
  }

  /** The bare JID of an account on this server, or undefined. */
  private localAccount(jid: string): string | undefined {
    const bare = bareOf(jid)
    const at = bare.indexOf('@')
    if (at <= 0 || bare.slice(at + 1) !== this.world.domain) return undefined
    return bare
  }

  /** §4.1; an existing account is `conflict` (S04). */
  private addUser(conn: Connection, jid: string, password: string): Outcome<undefined> {
    const allowed = this.requireAdmin(conn)
    if (!allowed.ok) return allowed
    const bare = this.localAccount(jid)
    if (bare === undefined) return err('jid-malformed', `${jid} is not on ${this.domain}`, 'modify')
    if (this.world.accounts.has(bare)) return err('conflict', 'User already exists', 'cancel')
    this.world.accounts.set(bare, { jid: bare, password, admin: false, demo: false })
    return ok0
  }

  /**
   * §4.2. A missing account is success (C01 R-E). Online sessions end with `conflict`
   * (account-removed, S04), leaving their rooms as others see (S12); room affiliations go
   * with the account (S12), and so do node affiliations, subscriptions and private storage
   * (not covered by contract).
   */
  private deleteUser(conn: Connection, jid: string): Outcome<undefined> {
    const allowed = this.requireAdmin(conn)
    if (!allowed.ok) return allowed
    const bare = this.localAccount(jid)
    if (bare === undefined || !this.world.accounts.has(bare)) return ok0
    this.endSessions(bare, 'account-removed', 'User removed')
    this.world.accounts.delete(bare)
    this.muc.forget(bare)
    this.pubsub.forget(bare)
    this.world.privateStorage.delete(bare)
    return ok0
  }

  /** §4.7: open sessions stay open (S04, PLY-31). */
  private changePassword(conn: Connection, jid: string, password: string): Outcome<undefined> {
    const allowed = this.requireAdmin(conn)
    if (!allowed.ok) return allowed
    const account = this.world.accounts.get(this.localAccount(jid) ?? '')
    if (account === undefined) return err('item-not-found', 'User does not exist', 'cancel')
    account.password = password
    return ok0
  }

  /** §4.6: every session of the account ends with `policy-violation` (session-ended: S04). */
  private endUserSessions(conn: Connection, jid: string): Outcome<undefined> {
    const allowed = this.requireAdmin(conn)
    if (!allowed.ok) return allowed
    this.endSessions(bareOf(jid), 'session-ended', 'has been kicked')
    return ok0
  }

  /** XEP-0049, per account (S04). An empty value reads back as unset, as on ejabberd. */
  private getPrivate(conn: Connection, key: string): Outcome<string | undefined> {
    const value = this.world.privateStorage.get(conn.bare)?.get(key)
    return ok(value === undefined || value === '' ? undefined : value)
  }

  private setPrivate(conn: Connection, key: string, value: string): Outcome<undefined> {
    const store = this.world.privateStorage.get(conn.bare) ?? new Map<string, string>()
    store.set(key, value)
    this.world.privateStorage.set(conn.bare, store)
    return ok0
  }

  // ---- state: export, import, reset (PLY-21, PLY-34) -----------------------------------------

  /** The durable state, as JSON-safe data. Sessions, occupants and join history are left out. */
  exportState(): MockState {
    const w = this.world
    return {
      format: MOCK_STATE_FORMAT,
      version: 1,
      domain: w.domain,
      accounts: [...w.accounts.values()].map((a) => ({ ...a })),
      rooms: [...w.rooms.values()].map((room) => ({
        jid: room.jid,
        config: { ...room.config },
        affiliations: [...room.affiliations]
          .filter((e): e is [string, 'owner' | 'admin' | 'member' | 'outcast'] => e[1] !== 'none')
          .map(([jid, affiliation]) => ({ jid, affiliation })),
        storedRoles: [...room.storedRoles]
          .filter((e): e is [string, 'moderator' | 'participant' | 'visitor'] => e[1] !== 'none')
          .map(([jid, role]) => ({ jid, role })),
        archive: room.archive.map((m) => ({ ...m })),
      })),
      nodes: [...w.nodes.values()].map((node) => ({
        name: node.name,
        config: { ...node.config },
        affiliations: [...node.affiliations]
          .filter(
            (e): e is [string, 'owner' | 'publisher' | 'publish-only' | 'member' | 'outcast'] =>
              e[1] !== 'none',
          )
          .map(([jid, affiliation]) => ({ jid, affiliation })),
        subscriptions: [...node.subscriptions]
          .filter((e): e is [string, 'subscribed' | 'pending' | 'unconfigured'] => e[1] !== 'none')
          .map(([jid, subscription]) => ({ jid, subscription })),
        items: node.items.map((i) => ({ ...i })),
      })),
      privateStorage: [...w.privateStorage].flatMap(([jid, store]) =>
        [...store].map(([key, value]) => ({ jid, key, value })),
      ),
      lastStanzaId: w.lastStanzaId.toString(),
    }
  }

  /**
   * Replaces the whole state. Every session is dropped without a stream error, as a server
   * restart drops them, so clients reconnect to the new state as new sessions (PLY-2). Pass
   * validated state (parseMockState).
   */
  importState(state: MockState): void {
    for (const conn of [...this.world.connections]) this.close(conn, { t: 'dropped' })
    this.world = this.load(state)
    this.muc = new MucService(this.world)
    this.pubsub = new PubsubService(this.world)
  }

  /** Back to the seed (PLY-21). */
  reset(): void {
    this.importState(this.seed)
  }

  /** Makes `state` the seed that `reset()` returns to; does not change the current state. */
  setSeed(state: MockState): void {
    this.seed = state
  }

  private load(state: MockState): World {
    const world = new World(state.domain, this.clock)
    for (const a of state.accounts) {
      const jid = bareOf(a.jid)
      world.accounts.set(jid, { jid, password: a.password, admin: a.admin, demo: a.demo })
    }
    for (const r of state.rooms) {
      const archive = r.archive
        .map((m) => ({ ...m }))
        .sort((a, b) => compareStanzaIds(a.stanzaId, b.stanzaId))
      world.rooms.set(bareOf(r.jid), {
        jid: bareOf(r.jid),
        config: { ...r.config },
        affiliations: new Map(r.affiliations.map((e) => [bareOf(e.jid), e.affiliation])),
        storedRoles: new Map(r.storedRoles.map((e) => [bareOf(e.jid), e.role])),
        occupants: new Map(),
        archive,
        // Join history lives in memory only, so it starts empty, as after an ejabberd restart.
        history: [],
      })
    }
    for (const n of state.nodes) {
      world.nodes.set(n.name, {
        name: n.name,
        config: { ...n.config },
        affiliations: new Map(n.affiliations.map((e) => [bareOf(e.jid), e.affiliation])),
        subscriptions: new Map(n.subscriptions.map((e) => [e.jid, e.subscription])),
        items: n.items.map((i) => ({ ...i })),
      })
    }
    for (const { jid, key, value } of state.privateStorage) {
      const bare = bareOf(jid)
      const store = world.privateStorage.get(bare) ?? new Map<string, string>()
      store.set(key, value)
      world.privateStorage.set(bare, store)
    }
    world.lastStanzaId = BigInt(state.lastStanzaId)
    for (const room of world.rooms.values()) {
      const last = room.archive.at(-1)
      if (last !== undefined && BigInt(last.stanzaId) > world.lastStanzaId) {
        world.lastStanzaId = BigInt(last.stanzaId)
      }
    }
    return world
  }
}
