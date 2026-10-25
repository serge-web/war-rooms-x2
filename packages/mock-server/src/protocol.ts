// The wire between a MockTransport session and the MockServer: plain, structured-clone-safe
// frames, one ordered stream each way per connection, as an XMPP stream is. In WP 1.4 the two
// ends share a thread; WP 1.5 carries the same frames between tabs and a SharedWorker.
//
// A request's reply comes after every event the request caused for that connection, so the order
// a session sees is the network's: a join's occupants, then its self-presence (the reply), then
// history; a send's reflection with its reply; a publish's own notification before its result.
import type { Result } from '@wrx/schemas'
import type {
  AffiliationEntry,
  Credentials,
  EndReason,
  Item,
  ItemsEvent,
  Joined,
  MamPage,
  MamQuery,
  MucAffiliation,
  MucRole,
  NodeConfig,
  OccupantEvent,
  PubsubAffiliationEntry,
  RoomConfig,
  RoomMessage,
  Services,
  SubscriptionEntry,
  TransportError,
} from '@wrx/transport'

/**
 * Node options as the server stores them: the interface's config plus the ejabberd options the
 * real transport always sets on nodes it creates (ejabberd.ts `nodeConfigFields`). A node the
 * admin auto-creates by publishing gets ejabberd's defaults instead.
 */
export interface ServerNodeConfig extends NodeConfig {
  /** `pubsub#notify_delete`: subscribers hear of the node's deletion. */
  readonly notifyDelete: boolean
  /** `pubsub#itemreply`: `publisher` reports each item's publisher. */
  readonly itemReply: 'publisher' | 'none'
}

/** Every operation a session can ask of the server, with its arguments and result. */
export interface OpMap {
  'muc.join': { args: readonly [room: string, nick: string]; result: Joined }
  'muc.leave': { args: readonly [room: string]; result: undefined }
  'muc.send': { args: readonly [room: string, body: string]; result: { readonly stanzaId: string } }
  'muc.setRole': { args: readonly [room: string, nick: string, role: MucRole]; result: undefined }
  'muc.setAffiliations': {
    args: readonly [room: string, entries: readonly AffiliationEntry[]]
    result: undefined
  }
  'muc.getAffiliations': {
    args: readonly [room: string, affiliation: MucAffiliation]
    result: readonly AffiliationEntry[]
  }
  'muc.createRoom': { args: readonly [room: string, config: RoomConfig]; result: undefined }
  'muc.configureRoom': { args: readonly [room: string, config: RoomConfig]; result: undefined }
  'muc.getRoomConfig': { args: readonly [room: string]; result: RoomConfig }
  'muc.destroyRoom': { args: readonly [room: string]; result: undefined }
  'muc.listRooms': { args: readonly []; result: readonly string[] }
  'mam.queryRoom': { args: readonly [room: string, query: MamQuery]; result: MamPage }
  'pubsub.getItems': {
    args: readonly [node: string, max: number | undefined]
    result: readonly Item[]
  }
  'pubsub.publish': {
    args: readonly [node: string, itemId: string, payload: string]
    result: undefined
  }
  'pubsub.retract': { args: readonly [node: string, itemId: string]; result: undefined }
  'pubsub.subscribe': { args: readonly [node: string]; result: undefined }
  'pubsub.unsubscribe': { args: readonly [node: string]; result: undefined }
  'pubsub.listNodes': { args: readonly []; result: readonly string[] }
  'pubsub.createNode': {
    args: readonly [node: string, config: ServerNodeConfig]
    result: undefined
  }
  'pubsub.configureNode': {
    args: readonly [node: string, config: ServerNodeConfig]
    result: undefined
  }
  'pubsub.getNodeConfig': { args: readonly [node: string]; result: NodeConfig }
  'pubsub.deleteNode': { args: readonly [node: string]; result: undefined }
  'pubsub.getAffiliations': {
    args: readonly [node: string]
    result: readonly PubsubAffiliationEntry[]
  }
  'pubsub.setAffiliations': {
    args: readonly [node: string, entries: readonly PubsubAffiliationEntry[]]
    result: undefined
  }
  'pubsub.getSubscriptions': { args: readonly [node: string]; result: readonly SubscriptionEntry[] }
  'pubsub.setSubscriptions': {
    args: readonly [node: string, entries: readonly SubscriptionEntry[]]
    result: undefined
  }
  'admin.onlineUsers': { args: readonly []; result: readonly string[] }
  'admin.registeredUsers': { args: readonly []; result: readonly string[] }
  'admin.addUser': { args: readonly [jid: string, password: string]; result: undefined }
  'admin.deleteUser': { args: readonly [jid: string]; result: undefined }
  'admin.changePassword': { args: readonly [jid: string, password: string]; result: undefined }
  'admin.endUserSessions': { args: readonly [jid: string]; result: undefined }
  'admin.getPrivate': { args: readonly [key: string]; result: string | undefined }
  'admin.setPrivate': { args: readonly [key: string, value: string]; result: undefined }
}

export type OpName = keyof OpMap

/** One request, discriminated by `op`. */
export type Request = {
  readonly [K in OpName]: { readonly op: K; readonly args: OpMap[K]['args'] }
}[OpName]

/** The server's answer to a request, discriminated by the same `op`. */
export type Reply = {
  readonly [K in OpName]: {
    readonly op: K
    readonly result: Result<OpMap[K]['result'], TransportError>
  }
}[OpName]

/** Something the server tells a session without being asked. */
export type ServerEvent =
  | { readonly kind: 'presence'; readonly occupant: OccupantEvent }
  | { readonly kind: 'message'; readonly message: RoomMessage }
  | { readonly kind: 'items'; readonly event: ItemsEvent }

/** Session to server. */
export type ClientFrame =
  /** Authenticate and bind; the first frame of every connection. */
  | { readonly t: 'login'; readonly credentials: Credentials; readonly resource?: string }
  | { readonly t: 'request'; readonly id: number; readonly request: Request }
  /** Leave every room and close the stream (PLY-3). */
  | { readonly t: 'logout' }
  /** The connection died without a close: the server forgets the session (no resumption). */
  | { readonly t: 'drop' }

/** Server to session. */
export type ServerFrame =
  | {
      readonly t: 'bound'
      readonly jid: string
      readonly anonymous: boolean
      readonly services: Services
    }
  | { readonly t: 'refused'; readonly error: TransportError }
  | { readonly t: 'reply'; readonly id: number; readonly reply: Reply }
  | { readonly t: 'event'; readonly event: ServerEvent }
  /** The server ended the session for good (PLY-50); the connection is closed. */
  | { readonly t: 'end'; readonly reason: EndReason; readonly text?: string }
  /** The logout completed. */
  | { readonly t: 'closed' }
  /** The server dropped the connection without a stream error (a restart, a reset to seed). */
  | { readonly t: 'dropped' }

/** The server end of one connection. */
export interface ServerPort {
  send(frame: ClientFrame): void
}

/** What a MockTransport needs from a server: a way to open connections (WP 1.5 relays it). */
export interface ServerLink {
  attach(sink: (frame: ServerFrame) => void): ServerPort
}
