// XEP-0045 Multi-User Chat: occupant use (§7), moderation (§8) and ownership (§9, §10).
import type { Outcome } from './errors.ts'
import type { Unsubscribe } from './session.ts'

export type MucRole = 'moderator' | 'participant' | 'visitor' | 'none'
export type MucAffiliation = 'owner' | 'admin' | 'member' | 'outcast' | 'none'

/** A room is addressed by its bare JID, `<roomId>@<muc service>`. */
export type RoomJid = string

export interface Joined {
  readonly room: RoomJid
  readonly nick: string
  /** `visitor` means the server will reject posts (PLY-12, D8). */
  readonly role: MucRole
  readonly affiliation: MucAffiliation
}

/** A groupchat message, live or from history. */
export interface RoomMessage {
  readonly room: RoomJid
  /**
   * The server's `stanza-id` (XEP-0359), the same value MAM reports as the archive id. The key
   * for de-duplication across live delivery and MAM (PLY-10, PLY-49).
   */
  readonly stanzaId: string
  readonly nick: string
  /**
   * The sender's bare JID. Rooms are non-anonymous, so the server reveals it; identity comes
   * from here, never from the body (§3 rule 3).
   */
  readonly from: string | undefined
  /** Server time, ISO 8601: the delay stamp on history, else the server's receive time. */
  readonly timestamp: string
  readonly body: string
}

/** A change in who is in a room, including this session (`self`). */
export interface OccupantEvent {
  readonly room: RoomJid
  readonly nick: string
  readonly jid: string | undefined
  readonly role: MucRole
  readonly affiliation: MucAffiliation
  readonly available: boolean
  readonly self: boolean
  /**
   * XEP-0045 status codes. With `self` and `available: false`: 307 kicked, 301 banned,
   * 321 removed by an affiliation change (PLY-51), 332 service shutdown.
   */
  readonly statusCodes: readonly number[]
}

/** Room settings the admin controls (NFR-3: members-only, moderated, non-anonymous, persistent, unlisted). */
export interface RoomConfig {
  readonly name: string
  readonly description?: string
  readonly membersOnly: boolean
  /** Always true for game rooms (ADM-37). */
  readonly moderated: boolean
  readonly persistent: boolean
  readonly public: boolean
  /** `anyone` makes the room non-anonymous, so real JIDs are visible. */
  readonly whois: 'anyone' | 'moderators'
  /** Archive messages for MAM (XEP-0313); required for history (PLY-49). */
  readonly archive: boolean
}

export interface AffiliationEntry {
  /** Bare JID. */
  readonly jid: string
  readonly affiliation: MucAffiliation
}

export interface MucApi {
  /** Joins with this nickname. Several sessions of one role share a nick (D22). */
  join(room: RoomJid, nick: string): Outcome<Joined>
  leave(room: RoomJid): Outcome<void>
  /**
   * Sends a groupchat body. Resolves when the server's reflection arrives, with its stanza-id;
   * fails `forbidden` when the session has no voice (PLY-12), `not-acceptable` if not in the
   * room, and `too-large` before sending if over the cap (PLY-53).
   */
  send(room: RoomJid, body: string): Outcome<{ readonly stanzaId: string }>
  onMessage(room: RoomJid, listener: (message: RoomMessage) => void): Unsubscribe
  onOccupant(room: RoomJid, listener: (event: OccupantEvent) => void): Unsubscribe
  /** Occupants currently known in a joined room, this session included. */
  occupants(room: RoomJid): readonly OccupantEvent[]

  // Moderation and ownership (admin, umpires as moderators).
  /** §8.4–8.5: change an occupant's role, by nick. */
  setRole(room: RoomJid, nick: string, role: MucRole, reason?: string): Outcome<void>
  /** §9.3–9.8, §10.3–10.7: change affiliations by bare JID. */
  setAffiliations(room: RoomJid, entries: readonly AffiliationEntry[]): Outcome<void>
  getAffiliations(room: RoomJid, affiliation: MucAffiliation): Outcome<readonly AffiliationEntry[]>
  /** §10.1: create (or take over) a room and apply its configuration. */
  createRoom(room: RoomJid, config: RoomConfig): Outcome<void>
  configureRoom(room: RoomJid, config: RoomConfig): Outcome<void>
  getRoomConfig(room: RoomJid): Outcome<RoomConfig>
  /** §10.9: destroys the room and its history (R16, ADM-40). */
  destroyRoom(room: RoomJid, reason?: string): Outcome<void>
  /** Rooms on the service visible to this session (disco#items). */
  listRooms(): Outcome<readonly RoomJid[]>
}
