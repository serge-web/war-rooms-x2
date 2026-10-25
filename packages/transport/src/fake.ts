// A scriptable fake session for unit tests of the domain layer (NFR-15). It is a test double,
// not the mock server: it enforces nothing, so ARC-10 does not apply. Tests push events with
// `emit*`, change what operations return with `stub`, and read `calls` to see what was asked.
import type { AdminApi } from './admin.ts'
import { ok } from './errors.ts'
import type { Outcome } from './errors.ts'
import type { MamApi, MamPage } from './mam.ts'
import type { Joined, MucApi, OccupantEvent, RoomJid, RoomMessage } from './muc.ts'
import type { ItemsEvent, PubsubApi } from './pubsub.ts'
import type { ConnectionStatus, Recovery, Session, Services, Unsubscribe } from './session.ts'

type Api = 'muc' | 'mam' | 'pubsub' | 'admin'

export interface FakeCall {
  readonly api: Api
  readonly op: string
  readonly args: readonly unknown[]
}

type Handler = (...args: readonly unknown[]) => Outcome<unknown>

class Listeners<K, E> {
  private readonly byKey = new Map<K, Set<(event: E) => void>>()

  add(key: K, listener: (event: E) => void): Unsubscribe {
    const set = this.byKey.get(key) ?? new Set()
    set.add(listener)
    this.byKey.set(key, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.byKey.delete(key)
    }
  }

  emit(key: K, event: E): void {
    for (const listener of [...(this.byKey.get(key) ?? [])]) listener(event)
  }

  count(key: K): number {
    return this.byKey.get(key)?.size ?? 0
  }

  total(): number {
    let n = 0
    for (const set of this.byKey.values()) n += set.size
    return n
  }
}

export interface FakeOptions {
  readonly jid?: string
  readonly anonymous?: boolean
  readonly services?: Services
}

export class FakeSession implements Session {
  readonly jid: string
  readonly anonymous: boolean
  readonly services: Services
  readonly calls: FakeCall[] = []

  private currentStatus: ConnectionStatus = { state: 'online' }
  private readonly statusListeners = new Listeners<'status', ConnectionStatus>()
  private readonly recoveryListeners = new Listeners<'recovery', Recovery>()
  private readonly messageListeners = new Listeners<RoomJid, RoomMessage>()
  private readonly occupantListeners = new Listeners<RoomJid, OccupantEvent>()
  private readonly itemListeners = new Listeners<string, ItemsEvent>()
  private readonly occupantsByRoom = new Map<RoomJid, Map<string, OccupantEvent>>()
  private readonly handlers = new Map<string, Handler>()

  constructor(options: FakeOptions = {}) {
    this.jid = options.jid ?? 'blue-co@wrx.test/fake'
    this.anonymous = options.anonymous ?? false
    this.services = options.services ?? {
      muc: 'conference.wrx.test',
      pubsub: 'pubsub.wrx.test',
    }
  }

  /** Makes `api.op` return what `handler` returns, until stubbed again. */
  stub(api: Api, op: string, handler: Handler): void {
    this.handlers.set(`${api}.${op}`, handler)
  }

  /** Live listeners, for checking that subscriptions are released (ARC-3). */
  listenerCount(): number {
    return (
      this.statusListeners.total() +
      this.recoveryListeners.total() +
      this.messageListeners.total() +
      this.occupantListeners.total() +
      this.itemListeners.total()
    )
  }

  emitStatus(status: ConnectionStatus): void {
    this.currentStatus = status
    this.statusListeners.emit('status', status)
  }

  emitRecovered(recovery: Recovery): void {
    this.emitStatus({ state: 'online' })
    this.recoveryListeners.emit('recovery', recovery)
  }

  emitMessage(message: RoomMessage): void {
    this.messageListeners.emit(message.room, message)
  }

  emitOccupant(event: OccupantEvent): void {
    const room = this.occupantsByRoom.get(event.room) ?? new Map<string, OccupantEvent>()
    if (event.available) room.set(event.nick, event)
    else room.delete(event.nick)
    this.occupantsByRoom.set(event.room, room)
    this.occupantListeners.emit(event.room, event)
  }

  emitItems(event: ItemsEvent): void {
    this.itemListeners.emit(event.node, event)
  }

  status(): ConnectionStatus {
    return this.currentStatus
  }

  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe {
    return this.statusListeners.add('status', listener)
  }

  onRecovered(listener: (recovery: Recovery) => void): Unsubscribe {
    return this.recoveryListeners.add('recovery', listener)
  }

  disconnect(): Promise<void> {
    this.calls.push({ api: 'admin', op: 'disconnect', args: [] })
    if (this.currentStatus.state !== 'ended') this.emitStatus({ state: 'ended', reason: 'logout' })
    return Promise.resolve()
  }

  private call<T>(api: Api, op: string, args: readonly unknown[], fallback: T): Outcome<T> {
    this.calls.push({ api, op, args })
    const handler = this.handlers.get(`${api}.${op}`)
    // A stub decides the result type; tests own that contract.
    if (handler !== undefined) return handler(...args) as Outcome<T>
    return Promise.resolve(ok(fallback))
  }

  readonly muc: MucApi = {
    join: (room, nick) => {
      const joined: Joined = { room, nick, role: 'participant', affiliation: 'member' }
      return this.call('muc', 'join', [room, nick], joined)
    },
    leave: (room) => this.call('muc', 'leave', [room], undefined),
    send: (room, body) =>
      this.call('muc', 'send', [room, body], { stanzaId: `fake-${this.calls.length}` }),
    onMessage: (room, listener) => this.messageListeners.add(room, listener),
    onOccupant: (room, listener) => this.occupantListeners.add(room, listener),
    occupants: (room) => [...(this.occupantsByRoom.get(room)?.values() ?? [])],
    setRole: (room, nick, role, reason) =>
      this.call('muc', 'setRole', [room, nick, role, reason], undefined),
    setAffiliations: (room, entries) =>
      this.call('muc', 'setAffiliations', [room, entries], undefined),
    getAffiliations: (room, affiliation) =>
      this.call('muc', 'getAffiliations', [room, affiliation], []),
    createRoom: (room, config) => this.call('muc', 'createRoom', [room, config], undefined),
    configureRoom: (room, config) => this.call('muc', 'configureRoom', [room, config], undefined),
    getRoomConfig: (room) =>
      this.call('muc', 'getRoomConfig', [room], {
        name: room,
        membersOnly: true,
        moderated: true,
        persistent: true,
        public: false,
        whois: 'anyone',
        archive: true,
      }),
    destroyRoom: (room, reason) => this.call('muc', 'destroyRoom', [room, reason], undefined),
    listRooms: () => this.call('muc', 'listRooms', [], []),
  }

  readonly mam: MamApi = {
    queryRoom: (room, query) => {
      const empty: MamPage = { messages: [], first: undefined, last: undefined, complete: true }
      return this.call('mam', 'queryRoom', [room, query], empty)
    },
  }

  readonly pubsub: PubsubApi = {
    getItems: (node, options) => this.call('pubsub', 'getItems', [node, options], []),
    publish: (node, itemId, payload) =>
      this.call('pubsub', 'publish', [node, itemId, payload], undefined),
    retract: (node, itemId) => this.call('pubsub', 'retract', [node, itemId], undefined),
    subscribe: (node) => this.call('pubsub', 'subscribe', [node], undefined),
    unsubscribe: (node) => this.call('pubsub', 'unsubscribe', [node], undefined),
    onItems: (node, listener) => this.itemListeners.add(node, listener),
    listNodes: () => this.call('pubsub', 'listNodes', [], []),
    createNode: (node, config) => this.call('pubsub', 'createNode', [node, config], undefined),
    configureNode: (node, config) =>
      this.call('pubsub', 'configureNode', [node, config], undefined),
    getNodeConfig: (node) =>
      this.call('pubsub', 'getNodeConfig', [node], {
        accessModel: 'whitelist',
        publishModel: 'publishers',
        maxItems: 1,
        notifyRetract: true,
      }),
    deleteNode: (node) => this.call('pubsub', 'deleteNode', [node], undefined),
    getAffiliations: (node) => this.call('pubsub', 'getAffiliations', [node], []),
    setAffiliations: (node, entries) =>
      this.call('pubsub', 'setAffiliations', [node, entries], undefined),
    getSubscriptions: (node) => this.call('pubsub', 'getSubscriptions', [node], []),
    setSubscriptions: (node, entries) =>
      this.call('pubsub', 'setSubscriptions', [node, entries], undefined),
  }

  readonly admin: AdminApi = {
    onlineUsers: () => this.call('admin', 'onlineUsers', [], []),
    registeredUsers: () => this.call('admin', 'registeredUsers', [], []),
    addUser: (jid, password) => this.call('admin', 'addUser', [jid, password], undefined),
    deleteUser: (jid) => this.call('admin', 'deleteUser', [jid], undefined),
    changePassword: (jid, password) =>
      this.call('admin', 'changePassword', [jid, password], undefined),
    endUserSessions: (jid) => this.call('admin', 'endUserSessions', [jid], undefined),
    getPrivate: (key) => this.call<string | undefined>('admin', 'getPrivate', [key], undefined),
    setPrivate: (key, value) => this.call('admin', 'setPrivate', [key, value], undefined),
  }
}
