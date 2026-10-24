// The server's live state: what the durable MockState holds, plus sessions and occupants. One
// World per MockServer instance; nothing is shared between servers (ARC-2).
import type {
  MucAffiliation,
  MucRole,
  PubsubAffiliation,
  RoomConfig,
  Services,
  SubscriptionState,
} from '@wrx/transport'
import type { ServerFrame, ServerNodeConfig } from './protocol.ts'
import type { ArchivedMessage } from './state.ts'
import type { Clock } from './time.ts'

export interface Account {
  readonly jid: string
  password: string
  readonly admin: boolean
  readonly demo: boolean
}

/** One bound session (an XMPP stream with a full JID). */
export interface Connection {
  readonly id: number
  readonly jid: string
  readonly bare: string
  readonly anonymous: boolean
  /** A server administrator (ejabberd `acl: admin`): creates rooms and nodes, runs XEP-0133. */
  readonly admin: boolean
  /** Rooms this session is an occupant of. */
  readonly rooms: Set<string>
  /** Delivers a frame, unless the connection is closed. */
  send(frame: ServerFrame): void
  /** Nothing more is delivered. */
  close(): void
}

/** A room occupant: one nick, one bare JID, one or more sessions (D22, S11). */
export interface Occupant {
  readonly nick: string
  readonly bare: string
  role: MucRole
  readonly sessions: Set<Connection>
}

export interface Room {
  readonly jid: string
  config: RoomConfig
  /** Bare JID to affiliation; `none` is never stored. */
  readonly affiliations: Map<string, MucAffiliation>
  /** Bare JID to the role a moderator last set (R13); applied on join in moderated rooms. */
  readonly storedRoles: Map<string, MucRole>
  /** By nick, in join order. */
  readonly occupants: Map<string, Occupant>
  /** MAM archive, oldest first (XEP-0313). */
  archive: ArchivedMessage[]
  /** Join history (XEP-0045 §7.2.15), in memory only: lost on export and import, as on restart. */
  history: ArchivedMessage[]
}

export interface StoredItem {
  readonly id: string
  readonly payload: string
  /** Bare JID. */
  readonly publisher: string
}

export interface PubsubNode {
  readonly name: string
  config: ServerNodeConfig
  /** Bare JID to affiliation; `none` is never stored. */
  readonly affiliations: Map<string, PubsubAffiliation>
  /** Full or bare JID to subscription state; `none` is never stored. */
  readonly subscriptions: Map<string, SubscriptionState>
  /** Oldest first. */
  items: StoredItem[]
}

/** ejabberd's default MUC history size (`history_size: 20`). */
export const HISTORY_SIZE = 20

export class World {
  readonly accounts = new Map<string, Account>()
  readonly rooms = new Map<string, Room>()
  readonly nodes = new Map<string, PubsubNode>()
  /** Bare JID to key to value (XEP-0049). */
  readonly privateStorage = new Map<string, Map<string, string>>()
  readonly connections = new Set<Connection>()
  readonly services: Services
  lastStanzaId = 0n

  constructor(
    readonly domain: string,
    readonly clock: Clock,
  ) {
    this.services = Object.freeze({ muc: `conference.${domain}`, pubsub: `pubsub.${domain}` })
  }

  /**
   * A new stanza-id: the server time in microseconds since the epoch, as ejabberd's room
   * stanza-ids are (spike S5), kept strictly increasing so ids are unique and sort by time.
   */
  nextStanzaId(): string {
    const now = BigInt(Math.floor(this.clock.now() * 1000))
    this.lastStanzaId = now > this.lastStanzaId ? now : this.lastStanzaId + 1n
    return this.lastStanzaId.toString()
  }

  sessionsOf(bare: string): Connection[] {
    return [...this.connections].filter((c) => c.bare === bare)
  }

  isAdmin(bare: string): boolean {
    return this.accounts.get(bare)?.admin === true
  }
}

/** The server time a stanza-id stands for, to the millisecond (the real transport's precision). */
export function stampOf(stanzaId: string): string {
  return new Date(Number(BigInt(stanzaId) / 1000n)).toISOString()
}

/** Compares stanza-ids as the numbers they are. */
export function compareStanzaIds(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** The bare JID, lower-cased as ejabberd's nodeprep does for the local and domain parts. */
export function bareOf(jid: string): string {
  const slash = jid.indexOf('/')
  return (slash < 0 ? jid : jid.slice(0, slash)).toLowerCase()
}

/** A full JID with the bare part lower-cased; the resource is kept as it is. */
export function normaliseJid(jid: string): string {
  const slash = jid.indexOf('/')
  return slash < 0 ? jid.toLowerCase() : `${jid.slice(0, slash).toLowerCase()}${jid.slice(slash)}`
}
