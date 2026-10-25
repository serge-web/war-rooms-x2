// A MockTransport session (WP 1.4): the 1.1 Session over a connection to a mock server. It is
// the client half and behaves as the real transport (WP 1.3) does on its side of the wire:
// size caps and JSON checks before sending, node options on every node it creates, occupant
// tracking from presence, reconnection and XEP-0198-style resumption (PLY-2), and forced logout
// (PLY-50). Nothing here is shared between sessions (D15).
import type { Result } from '@wrx/schemas'
import { err, ok } from '@wrx/transport'
import type {
  AdminApi,
  ConnectOptions,
  ConnectionStatus,
  EndReason,
  ItemsEvent,
  Joined,
  MamApi,
  MucApi,
  NodeConfig,
  OccupantEvent,
  Outcome,
  PubsubApi,
  Recovery,
  RoomJid,
  RoomMessage,
  Services,
  Session,
  TransportError,
  Unsubscribe,
} from '@wrx/transport'
import { Channel } from './network.ts'
import type { MockNetwork } from './network.ts'
import type {
  ClientFrame,
  Reply,
  Request,
  ServerEvent,
  ServerFrame,
  ServerLink,
  ServerNodeConfig,
  ServerPort,
} from './protocol.ts'
import {
  PRIVATE_KEY_PATTERN,
  PUBSUB_PAYLOAD_CAP_BYTES,
  messageStanza,
  messageWithinCap,
  payloadWithinCap,
  utf8Bytes,
} from './size.ts'
import type { Cancel } from './time.ts'

export interface ReconnectOptions {
  /** Delay before the first attempt; doubles per attempt up to `maxMs`. */
  readonly initialMs: number
  readonly maxMs: number
  /** Attempts before giving up with `unreachable`. */
  readonly maxAttempts: number
}

export interface SessionSettings {
  readonly network: MockNetwork
  readonly timeoutMs: number
  readonly reconnect: ReconnectOptions
}

/** A request that never reached the server, or whose answer will never come. */
interface Failed {
  readonly op: 'failed'
  readonly result: Result<never, TransportError>
}

type Phase = 'online' | 'reconnecting' | 'ended'

interface Bound {
  readonly jid: string
  readonly anonymous: boolean
  readonly services: Services
}

interface Wire {
  readonly port: ServerPort
  readonly up: Channel<ClientFrame>
  readonly down: Channel<ServerFrame>
}

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
    for (const listener of [...(this.byKey.get(key) ?? [])]) {
      try {
        listener(event)
      } catch (error) {
        // A failing listener must not stop delivery to the others; report it out of band.
        queueMicrotask(() => {
          throw error
        })
      }
    }
  }
}

const mismatch = (): Result<never, TransportError> =>
  err('invalid-response', 'the reply does not match the request')

/** What the API objects need from their session. */
interface Caller {
  call(request: Request): Promise<Reply | Failed>
  nextId(): string
}

// ---- MUC ------------------------------------------------------------------------------------

interface RoomState {
  nick: string
  joined: boolean
  readonly occupants: Map<string, OccupantEvent>
}

class MockMuc implements MucApi {
  private readonly rooms = new Map<RoomJid, RoomState>()
  private readonly messageListeners = new Listeners<RoomJid, RoomMessage>()
  private readonly occupantListeners = new Listeners<RoomJid, OccupantEvent>()

  constructor(private readonly caller: Caller) {}

  /** A new session replaced the old one: the server has dropped us from every room (PLY-2). */
  reset(): void {
    this.rooms.clear()
  }

  handlePresence(event: OccupantEvent): void {
    const state = this.rooms.get(event.room)
    if (state === undefined) return
    if (event.available) state.occupants.set(event.nick, event)
    else state.occupants.delete(event.nick)
    if (event.self && event.available) {
      state.joined = true
      state.nick = event.nick
    }
    if (event.self && !event.available) {
      // Left, kicked (307), banned (301), removed by an affiliation change (321), destroyed.
      state.joined = false
      state.occupants.clear()
    }
    this.occupantListeners.emit(event.room, event)
  }

  handleMessage(message: RoomMessage): void {
    if (!this.rooms.has(message.room)) return
    this.messageListeners.emit(message.room, message)
  }

  join = async (room: RoomJid, nick: string): Outcome<Joined> => {
    const state = this.rooms.get(room) ?? { nick, joined: false, occupants: new Map() }
    this.rooms.set(room, state)
    const r = await this.caller.call({ op: 'muc.join', args: [room, nick] })
    const result = r.op === 'muc.join' || r.op === 'failed' ? r.result : mismatch()
    if (!result.ok && !state.joined && this.rooms.get(room) === state) this.rooms.delete(room)
    return result
  }

  leave = async (room: RoomJid): Outcome<void> => {
    const state = this.rooms.get(room)
    if (state?.joined !== true) {
      this.rooms.delete(room)
      return ok(undefined)
    }
    const r = await this.caller.call({ op: 'muc.leave', args: [room] })
    const result = r.op === 'muc.leave' || r.op === 'failed' ? r.result : mismatch()
    if (result.ok && this.rooms.get(room) === state) this.rooms.delete(room)
    return result
  }

  send = async (room: RoomJid, body: string): Outcome<{ readonly stanzaId: string }> => {
    const stanza = messageStanza(this.caller.nextId(), room, body)
    if (!messageWithinCap(stanza)) {
      return err('too-large', `message stanza is ${utf8Bytes(stanza)} bytes, over the cap`)
    }
    const r = await this.caller.call({ op: 'muc.send', args: [room, body] })
    return r.op === 'muc.send' || r.op === 'failed' ? r.result : mismatch()
  }

  onMessage(room: RoomJid, listener: (message: RoomMessage) => void): Unsubscribe {
    return this.messageListeners.add(room, listener)
  }

  onOccupant(room: RoomJid, listener: (event: OccupantEvent) => void): Unsubscribe {
    return this.occupantListeners.add(room, listener)
  }

  occupants(room: RoomJid): readonly OccupantEvent[] {
    return [...(this.rooms.get(room)?.occupants.values() ?? [])]
  }

  setRole: MucApi['setRole'] = async (room, nick, role) => {
    const r = await this.caller.call({ op: 'muc.setRole', args: [room, nick, role] })
    return r.op === 'muc.setRole' || r.op === 'failed' ? r.result : mismatch()
  }

  setAffiliations: MucApi['setAffiliations'] = async (room, entries) => {
    if (entries.length === 0) return ok(undefined)
    const r = await this.caller.call({ op: 'muc.setAffiliations', args: [room, entries] })
    return r.op === 'muc.setAffiliations' || r.op === 'failed' ? r.result : mismatch()
  }

  getAffiliations: MucApi['getAffiliations'] = async (room, affiliation) => {
    const r = await this.caller.call({ op: 'muc.getAffiliations', args: [room, affiliation] })
    return r.op === 'muc.getAffiliations' || r.op === 'failed' ? r.result : mismatch()
  }

  createRoom: MucApi['createRoom'] = async (room, config) => {
    const r = await this.caller.call({ op: 'muc.createRoom', args: [room, config] })
    return r.op === 'muc.createRoom' || r.op === 'failed' ? r.result : mismatch()
  }

  configureRoom: MucApi['configureRoom'] = async (room, config) => {
    const r = await this.caller.call({ op: 'muc.configureRoom', args: [room, config] })
    return r.op === 'muc.configureRoom' || r.op === 'failed' ? r.result : mismatch()
  }

  getRoomConfig: MucApi['getRoomConfig'] = async (room) => {
    const r = await this.caller.call({ op: 'muc.getRoomConfig', args: [room] })
    return r.op === 'muc.getRoomConfig' || r.op === 'failed' ? r.result : mismatch()
  }

  destroyRoom: MucApi['destroyRoom'] = async (room) => {
    const r = await this.caller.call({ op: 'muc.destroyRoom', args: [room] })
    const result = r.op === 'muc.destroyRoom' || r.op === 'failed' ? r.result : mismatch()
    if (result.ok) this.rooms.delete(room)
    return result
  }

  listRooms: MucApi['listRooms'] = async () => {
    const r = await this.caller.call({ op: 'muc.listRooms', args: [] })
    return r.op === 'muc.listRooms' || r.op === 'failed' ? r.result : mismatch()
  }
}

// ---- MAM ------------------------------------------------------------------------------------

class MockMam implements MamApi {
  constructor(private readonly caller: Caller) {}

  queryRoom: MamApi['queryRoom'] = async (room, query) => {
    const r = await this.caller.call({ op: 'mam.queryRoom', args: [room, query] })
    return r.op === 'mam.queryRoom' || r.op === 'failed' ? r.result : mismatch()
  }
}

// ---- PubSub ---------------------------------------------------------------------------------

/**
 * The options the real transport sets on every node it creates or configures (ejabberd.ts
 * `nodeConfigFields`): deletion is announced and items report their publisher.
 */
function withTransportOptions(config: NodeConfig): ServerNodeConfig {
  return { ...config, notifyDelete: true, itemReply: 'publisher' }
}

class MockPubsub implements PubsubApi {
  private readonly itemListeners = new Listeners<string, ItemsEvent>()

  constructor(private readonly caller: Caller) {}

  handleItems(event: ItemsEvent): void {
    this.itemListeners.emit(event.node, event)
  }

  getItems: PubsubApi['getItems'] = async (node, options) => {
    const r = await this.caller.call({ op: 'pubsub.getItems', args: [node, options?.max] })
    return r.op === 'pubsub.getItems' || r.op === 'failed' ? r.result : mismatch()
  }

  publish: PubsubApi['publish'] = async (node, itemId, payload) => {
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      return err('bad-request', 'the payload is not JSON (XEP-0335)')
    }
    // What the real transport sends is JSON.stringify of the parsed value; so does the mock.
    const text = JSON.stringify(json)
    if (!payloadWithinCap(text)) {
      return err('too-large', `the payload is over the ${PUBSUB_PAYLOAD_CAP_BYTES}-byte item cap`)
    }
    const r = await this.caller.call({ op: 'pubsub.publish', args: [node, itemId, text] })
    return r.op === 'pubsub.publish' || r.op === 'failed' ? r.result : mismatch()
  }

  retract: PubsubApi['retract'] = async (node, itemId) => {
    const r = await this.caller.call({ op: 'pubsub.retract', args: [node, itemId] })
    return r.op === 'pubsub.retract' || r.op === 'failed' ? r.result : mismatch()
  }

  subscribe: PubsubApi['subscribe'] = async (node) => {
    const r = await this.caller.call({ op: 'pubsub.subscribe', args: [node] })
    return r.op === 'pubsub.subscribe' || r.op === 'failed' ? r.result : mismatch()
  }

  unsubscribe: PubsubApi['unsubscribe'] = async (node) => {
    const r = await this.caller.call({ op: 'pubsub.unsubscribe', args: [node] })
    return r.op === 'pubsub.unsubscribe' || r.op === 'failed' ? r.result : mismatch()
  }

  onItems(node: string, listener: (event: ItemsEvent) => void): Unsubscribe {
    return this.itemListeners.add(node, listener)
  }

  listNodes: PubsubApi['listNodes'] = async () => {
    const r = await this.caller.call({ op: 'pubsub.listNodes', args: [] })
    return r.op === 'pubsub.listNodes' || r.op === 'failed' ? r.result : mismatch()
  }

  createNode: PubsubApi['createNode'] = async (node, config) => {
    const args = [node, withTransportOptions(config)] as const
    const r = await this.caller.call({ op: 'pubsub.createNode', args })
    return r.op === 'pubsub.createNode' || r.op === 'failed' ? r.result : mismatch()
  }

  configureNode: PubsubApi['configureNode'] = async (node, config) => {
    const args = [node, withTransportOptions(config)] as const
    const r = await this.caller.call({ op: 'pubsub.configureNode', args })
    return r.op === 'pubsub.configureNode' || r.op === 'failed' ? r.result : mismatch()
  }

  getNodeConfig: PubsubApi['getNodeConfig'] = async (node) => {
    const r = await this.caller.call({ op: 'pubsub.getNodeConfig', args: [node] })
    return r.op === 'pubsub.getNodeConfig' || r.op === 'failed' ? r.result : mismatch()
  }

  deleteNode: PubsubApi['deleteNode'] = async (node) => {
    const r = await this.caller.call({ op: 'pubsub.deleteNode', args: [node] })
    return r.op === 'pubsub.deleteNode' || r.op === 'failed' ? r.result : mismatch()
  }

  getAffiliations: PubsubApi['getAffiliations'] = async (node) => {
    const r = await this.caller.call({ op: 'pubsub.getAffiliations', args: [node] })
    return r.op === 'pubsub.getAffiliations' || r.op === 'failed' ? r.result : mismatch()
  }

  setAffiliations: PubsubApi['setAffiliations'] = async (node, entries) => {
    if (entries.length === 0) return ok(undefined)
    const r = await this.caller.call({ op: 'pubsub.setAffiliations', args: [node, entries] })
    return r.op === 'pubsub.setAffiliations' || r.op === 'failed' ? r.result : mismatch()
  }

  getSubscriptions: PubsubApi['getSubscriptions'] = async (node) => {
    const r = await this.caller.call({ op: 'pubsub.getSubscriptions', args: [node] })
    return r.op === 'pubsub.getSubscriptions' || r.op === 'failed' ? r.result : mismatch()
  }

  setSubscriptions: PubsubApi['setSubscriptions'] = async (node, entries) => {
    if (entries.length === 0) return ok(undefined)
    const r = await this.caller.call({ op: 'pubsub.setSubscriptions', args: [node, entries] })
    return r.op === 'pubsub.setSubscriptions' || r.op === 'failed' ? r.result : mismatch()
  }
}

// ---- administration -------------------------------------------------------------------------

class MockAdmin implements AdminApi {
  constructor(private readonly caller: Caller) {}

  onlineUsers: AdminApi['onlineUsers'] = async () => {
    const r = await this.caller.call({ op: 'admin.onlineUsers', args: [] })
    return r.op === 'admin.onlineUsers' || r.op === 'failed' ? r.result : mismatch()
  }

  registeredUsers: AdminApi['registeredUsers'] = async () => {
    const r = await this.caller.call({ op: 'admin.registeredUsers', args: [] })
    return r.op === 'admin.registeredUsers' || r.op === 'failed' ? r.result : mismatch()
  }

  addUser: AdminApi['addUser'] = async (jid, password) => {
    const r = await this.caller.call({ op: 'admin.addUser', args: [jid, password] })
    return r.op === 'admin.addUser' || r.op === 'failed' ? r.result : mismatch()
  }

  deleteUser: AdminApi['deleteUser'] = async (jid) => {
    const r = await this.caller.call({ op: 'admin.deleteUser', args: [jid] })
    return r.op === 'admin.deleteUser' || r.op === 'failed' ? r.result : mismatch()
  }

  changePassword: AdminApi['changePassword'] = async (jid, password) => {
    const r = await this.caller.call({ op: 'admin.changePassword', args: [jid, password] })
    return r.op === 'admin.changePassword' || r.op === 'failed' ? r.result : mismatch()
  }

  endUserSessions: AdminApi['endUserSessions'] = async (jid) => {
    const r = await this.caller.call({ op: 'admin.endUserSessions', args: [jid] })
    return r.op === 'admin.endUserSessions' || r.op === 'failed' ? r.result : mismatch()
  }

  getPrivate: AdminApi['getPrivate'] = async (key) => {
    if (!PRIVATE_KEY_PATTERN.test(key))
      return err('bad-request', `private key ${key} is not allowed`)
    const r = await this.caller.call({ op: 'admin.getPrivate', args: [key] })
    return r.op === 'admin.getPrivate' || r.op === 'failed' ? r.result : mismatch()
  }

  setPrivate: AdminApi['setPrivate'] = async (key, value) => {
    if (!PRIVATE_KEY_PATTERN.test(key))
      return err('bad-request', `private key ${key} is not allowed`)
    const r = await this.caller.call({ op: 'admin.setPrivate', args: [key, value] })
    return r.op === 'admin.setPrivate' || r.op === 'failed' ? r.result : mismatch()
  }
}

// ---- the session ----------------------------------------------------------------------------

export class MockSession implements Session {
  readonly muc: MockMuc
  readonly mam: MockMam
  readonly pubsub: MockPubsub
  readonly admin: MockAdmin

  private phase: Phase = 'online'
  private current: ConnectionStatus = { state: 'online' }
  private bound: Bound | undefined
  private wire: Wire | undefined
  /** Frames from an earlier wire are ignored. */
  private generation = 0
  private attempt = 0
  private reconnectTimer: Cancel | undefined
  private requestId = 0
  private stanzaId = 0
  private readonly pending = new Map<number, (reply: Reply | Failed) => void>()
  private settleLogin: ((result: Result<Bound, TransportError>) => void) | undefined
  private settleLogout: (() => void) | undefined
  private disconnecting: Promise<void> | undefined
  private readonly statusListeners = new Listeners<'status', ConnectionStatus>()
  private readonly recoveryListeners = new Listeners<'recovery', Recovery>()

  private constructor(
    private readonly link: ServerLink,
    private readonly options: ConnectOptions,
    private readonly settings: SessionSettings,
  ) {
    const caller: Caller = {
      call: (request) => this.call(request),
      nextId: () => `m${(++this.stanzaId).toString(36)}`,
    }
    this.muc = new MockMuc(caller)
    this.mam = new MockMam(caller)
    this.pubsub = new MockPubsub(caller)
    this.admin = new MockAdmin(caller)
  }

  /** Logs in and binds; resolves once the session is ready, as `Transport.connect` does. */
  static async open(
    link: ServerLink,
    options: ConnectOptions,
    settings: SessionSettings,
  ): Outcome<Session> {
    const session = new MockSession(link, options, settings)
    if (!settings.network.conditions.online) {
      return err('disconnected', 'the mock network is offline')
    }
    const bound = await session.login()
    if (!bound.ok) {
      session.phase = 'ended'
      session.wire?.port.send({ t: 'drop' })
      session.closeWire()
      return bound
    }
    session.bound = bound.value
    return ok(session)
  }

  get jid(): string {
    return this.requireBound().jid
  }

  get anonymous(): boolean {
    return this.options.credentials.kind === 'anonymous'
  }

  get services(): Services {
    return this.requireBound().services
  }

  private requireBound(): Bound {
    if (this.bound === undefined) throw new Error('the session is not bound yet')
    return this.bound
  }

  status(): ConnectionStatus {
    return this.current
  }

  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe {
    return this.statusListeners.add('status', listener)
  }

  onRecovered(listener: (recovery: Recovery) => void): Unsubscribe {
    return this.recoveryListeners.add('recovery', listener)
  }

  disconnect(): Promise<void> {
    this.disconnecting ??= this.logout()
    return this.disconnecting
  }

  /**
   * Test hook (PLY-2), not part of the Session interface: cuts the connection as a network
   * failure would. `resumable`: the server keeps the session and frames wait, then the stream
   * resumes. `lost`: the server forgets the session, and a new one is bound.
   */
  interrupt(how: 'resumable' | 'lost'): void {
    if (this.phase === 'ended') return
    if (how === 'lost' || this.wire === undefined) {
      this.loseWire(true)
    } else if (this.phase === 'online') {
      this.wire.up.pause()
      this.wire.down.pause()
      this.phase = 'reconnecting'
      this.scheduleRetry(() => {
        this.resume()
      })
    }
  }

  // ---- the wire -----------------------------------------------------------------------------

  private openWire(): Wire {
    const generation = ++this.generation
    const network = this.settings.network
    const down = new Channel<ServerFrame>(network, (frame) => {
      if (generation === this.generation) this.onFrame(frame)
    })
    const port = this.link.attach((frame) => {
      down.push(frame)
    })
    const up = new Channel<ClientFrame>(network, (frame) => {
      port.send(frame)
    })
    this.wire = { port, up, down }
    return this.wire
  }

  private closeWire(): void {
    const wire = this.wire
    this.wire = undefined
    this.generation++
    wire?.up.close()
    wire?.down.close()
  }

  private login(): Promise<Result<Bound, TransportError>> {
    const wire = this.openWire()
    return new Promise((resolve) => {
      const cancel = this.settings.network.scheduler.after(this.settings.timeoutMs, () => {
        this.settleLogin = undefined
        resolve(err('timeout', 'no session from the mock server'))
      })
      this.settleLogin = (result) => {
        cancel()
        this.settleLogin = undefined
        resolve(result)
      }
      const { credentials, resource } = this.options
      const resourceOf = this.bound?.jid.split('/').slice(1).join('/') ?? resource
      wire.up.push({
        t: 'login',
        credentials,
        ...(resourceOf === undefined ? {} : { resource: resourceOf }),
      })
    })
  }

  private onFrame(frame: ServerFrame): void {
    switch (frame.t) {
      case 'bound':
        this.settleLogin?.(
          ok({ jid: frame.jid, anonymous: frame.anonymous, services: frame.services }),
        )
        return
      case 'refused':
        this.settleLogin?.({ ok: false, error: frame.error })
        return
      case 'reply': {
        const settle = this.pending.get(frame.id)
        this.pending.delete(frame.id)
        settle?.(frame.reply)
        return
      }
      case 'event':
        this.onEvent(frame.event)
        return
      case 'end':
        this.finish(frame.reason, frame.text)
        return
      case 'closed':
        this.settleLogout?.()
        return
      case 'dropped':
        this.loseWire(false)
        return
    }
  }

  private onEvent(event: ServerEvent): void {
    if (event.kind === 'presence') this.muc.handlePresence(event.occupant)
    else if (event.kind === 'message') this.muc.handleMessage(event.message)
    else this.pubsub.handleItems(event.event)
  }

  private call(request: Request): Promise<Reply | Failed> {
    const wire = this.wire
    if (this.phase === 'ended' || wire === undefined) {
      return Promise.resolve(failed('disconnected', 'the session has ended'))
    }
    const id = ++this.requestId
    return new Promise((resolve) => {
      const cancel = this.settings.network.scheduler.after(this.settings.timeoutMs, () => {
        this.pending.delete(id)
        resolve(failed('timeout', `no reply to ${request.op} after ${this.settings.timeoutMs} ms`))
      })
      this.pending.set(id, (reply) => {
        cancel()
        resolve(reply)
      })
      wire.up.push({ t: 'request', id, request })
    })
  }

  private failPending(condition: 'disconnected', text: string): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const settle of pending) settle(failed(condition, text))
  }

  // ---- recovery (PLY-2) ---------------------------------------------------------------------

  /** The server's session is gone: rooms are left, and the client must rejoin (PLY-2). */
  private loseWire(tellServer: boolean): void {
    if (this.phase === 'ended') return
    const wire = this.wire
    if (tellServer) wire?.port.send({ t: 'drop' })
    this.closeWire()
    this.failPending('disconnected', 'the connection was lost')
    this.muc.reset()
    this.phase = 'reconnecting'
    this.attempt = 0
    this.scheduleRetry(() => {
      void this.reconnect()
    })
  }

  private scheduleRetry(task: () => void): void {
    this.attempt += 1
    const { initialMs, maxMs, maxAttempts } = this.settings.reconnect
    if (this.attempt > maxAttempts) {
      this.wire?.port.send({ t: 'drop' })
      this.finish('unreachable', `gave up after ${this.attempt - 1} attempts`)
      return
    }
    this.setStatus({ state: 'reconnecting', attempt: this.attempt })
    const delay = Math.min(maxMs, initialMs * 2 ** (this.attempt - 1))
    this.reconnectTimer?.()
    this.reconnectTimer = this.settings.network.scheduler.after(delay, () => {
      this.reconnectTimer = undefined
      if (this.phase === 'reconnecting') task()
    })
  }

  private resume(): void {
    const wire = this.wire
    if (wire === undefined) return
    if (!this.settings.network.conditions.online) {
      this.scheduleRetry(() => {
        this.resume()
      })
      return
    }
    this.recovered('resumed')
    wire.down.resume()
    wire.up.resume()
  }

  private async reconnect(): Promise<void> {
    if (!this.settings.network.conditions.online) {
      this.scheduleRetry(() => {
        void this.reconnect()
      })
      return
    }
    const bound = await this.login()
    if (this.phase !== 'reconnecting') return
    if (bound.ok) {
      this.bound = bound.value
      this.recovered('reconnected')
    } else if (bound.error.condition === 'not-authorized') {
      this.finish('auth-failed', bound.error.text)
    } else {
      this.closeWire()
      this.scheduleRetry(() => {
        void this.reconnect()
      })
    }
  }

  private recovered(recovery: Recovery): void {
    this.attempt = 0
    this.phase = 'online'
    this.setStatus({ state: 'online' })
    this.recoveryListeners.emit('recovery', recovery)
  }

  private setStatus(status: ConnectionStatus): void {
    this.current = status
    this.statusListeners.emit('status', status)
  }

  private finish(reason: EndReason, text?: string): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.reconnectTimer?.()
    this.reconnectTimer = undefined
    this.closeWire()
    this.failPending('disconnected', 'the session ended')
    this.muc.reset()
    this.settleLogout?.()
    this.setStatus({ state: 'ended', reason, ...(text === undefined ? {} : { text }) })
  }

  private async logout(): Promise<void> {
    if (this.phase === 'ended') return
    const wire = this.wire
    if (this.phase === 'online' && wire !== undefined) {
      const closed = new Promise<void>((resolve) => {
        const cancel = this.settings.network.scheduler.after(this.settings.timeoutMs, resolve)
        this.settleLogout = () => {
          cancel()
          this.settleLogout = undefined
          resolve()
        }
      })
      wire.up.push({ t: 'logout' })
      await closed
      // A no-op once the server has closed; otherwise the logout timed out.
      wire.port.send({ t: 'drop' })
    } else {
      wire?.port.send({ t: 'drop' })
    }
    this.finish('logout')
  }
}

function failed(condition: 'disconnected' | 'timeout', text: string): Failed {
  return { op: 'failed', result: err(condition, text) }
}
