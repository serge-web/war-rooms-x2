// XEP-0045 Multi-User Chat and XEP-0313 room archives, as ejabberd 26.09 runs them with the
// reference config (deploy/ejabberd/ejabberd.yml) and the rooms the admin tooling creates
// (NFR-3). Each rule cites the contract check that pins it; behaviour the suite does not reach is
// kept to what an operation needs to answer at all, and marked "not covered by contract".
import type { Result } from '@wrx/schemas'
import { err, ok } from '@wrx/transport'
import type {
  AffiliationEntry,
  Joined,
  MamPage,
  MamQuery,
  MucAffiliation,
  MucRole,
  OccupantEvent,
  RoomConfig,
  RoomMessage,
  TransportError,
} from '@wrx/transport'
import type { ArchivedMessage } from './state.ts'
import { HISTORY_SIZE, bareOf, compareStanzaIds, stampOf } from './world.ts'
import type { Connection, Occupant, Room, World } from './world.ts'

type Outcome<T> = Result<T, TransportError>

const SELF = 110
const NON_ANONYMOUS = 100
const BANNED = 301
const KICKED = 307
const AFFILIATION_CHANGE = 321

/** XEP-0313 RSM page size cap (mod_mam `max_rsm`-style limit: ejabberd caps a page at 250). */
const MAX_PAGE = 250

const ok0: Outcome<undefined> = Object.freeze({ ok: true, value: undefined })

export class MucService {
  constructor(private readonly world: World) {}

  // ---- addressing and rights ----------------------------------------------------------------

  private room(jid: string): Room | undefined {
    return this.world.rooms.get(bareOf(jid))
  }

  /** Server admins are owners of every room (ejabberd `access_admin`). */
  affiliationOf(room: Room, bare: string): MucAffiliation {
    if (this.world.isAdmin(bare)) return 'owner'
    return room.affiliations.get(bare) ?? 'none'
  }

  /** ejabberd `get_default_role/2`: no room here sets `members_by_default: false`. */
  private defaultRole(affiliation: MucAffiliation): MucRole {
    if (affiliation === 'owner' || affiliation === 'admin') return 'moderator'
    if (affiliation === 'outcast') return 'none'
    return 'participant'
  }

  /** The stored role wins over the default, but only in moderated rooms (R13, C01 R-C). */
  private roleOnJoin(room: Room, bare: string, affiliation: MucAffiliation): MucRole {
    const stored = room.storedRoles.get(bare)
    if (room.config.moderated && stored !== undefined) return stored
    return this.defaultRole(affiliation)
  }

  private occupantOf(room: Room, conn: Connection): Occupant | undefined {
    for (const occupant of room.occupants.values()) if (occupant.sessions.has(conn)) return occupant
    return undefined
  }

  private occupantByBare(room: Room, bare: string): Occupant | undefined {
    for (const occupant of room.occupants.values()) if (occupant.bare === bare) return occupant
    return undefined
  }

  /** Non-anonymous rooms show real JIDs to everyone; semi-anonymous ones to moderators only. */
  private revealsJidTo(room: Room, recipient: Connection): boolean {
    return room.config.whois === 'anyone' || this.occupantOf(room, recipient)?.role === 'moderator'
  }

  // ---- delivery -----------------------------------------------------------------------------

  private presence(
    room: Room,
    recipient: Connection,
    occupant: Occupant,
    available: boolean,
    codes: readonly number[],
    overrides: { readonly role?: MucRole; readonly affiliation?: MucAffiliation } = {},
  ): void {
    const self = occupant.sessions.has(recipient)
    const statusCodes = self ? [SELF, ...codes] : [...codes]
    if (self && available && room.config.whois === 'anyone') statusCodes.push(NON_ANONYMOUS)
    const event: OccupantEvent = {
      room: room.jid,
      nick: occupant.nick,
      jid: self || this.revealsJidTo(room, recipient) ? occupant.bare : undefined,
      role: overrides.role ?? (available ? occupant.role : 'none'),
      affiliation: overrides.affiliation ?? this.affiliationOf(room, occupant.bare),
      available,
      self,
      statusCodes: statusCodes.sort((a, b) => a - b),
    }
    recipient.send({ t: 'event', event: { kind: 'presence', occupant: event } })
  }

  /** Every session in the room, the occupant's own included. */
  private everyone(room: Room): Connection[] {
    return [...room.occupants.values()].flatMap((o) => [...o.sessions])
  }

  private message(room: Room, recipient: Connection, archived: ArchivedMessage): void {
    const message: RoomMessage = {
      room: room.jid,
      stanzaId: archived.stanzaId,
      nick: archived.nick,
      from: this.revealsJidTo(room, recipient) ? archived.from : undefined,
      timestamp: stampOf(archived.stanzaId),
      body: archived.body,
    }
    recipient.send({ t: 'event', event: { kind: 'message', message } })
  }

  /**
   * Removes an occupant entirely: every session is told (self, with `codes`), then everyone
   * else. Used for kicks, bans and affiliation removals.
   */
  private eject(
    room: Room,
    occupant: Occupant,
    codes: readonly number[],
    affiliation: MucAffiliation,
  ): void {
    const overrides = { role: 'none' as const, affiliation }
    for (const conn of occupant.sessions) {
      this.presence(room, conn, occupant, false, codes, overrides)
      conn.rooms.delete(room.jid)
    }
    room.occupants.delete(occupant.nick)
    for (const conn of this.everyone(room))
      this.presence(room, conn, occupant, false, codes, overrides)
  }

  /**
   * One session leaves. Others hear of it only when the occupant's last session goes (S11);
   * `tellSelf` is false when the session's stream is already closed.
   */
  private depart(room: Room, conn: Connection, tellSelf: boolean): void {
    const occupant = this.occupantOf(room, conn)
    conn.rooms.delete(room.jid)
    if (occupant === undefined) return
    if (tellSelf) this.presence(room, conn, occupant, false, [])
    occupant.sessions.delete(conn)
    if (occupant.sessions.size > 0) return
    room.occupants.delete(occupant.nick)
    for (const other of this.everyone(room)) this.presence(room, other, occupant, false, [])
  }

  // ---- occupant use (§7) --------------------------------------------------------------------

  join(conn: Connection, roomJid: string, nick: string): Outcome<Joined> {
    const room = this.room(roomJid)
    // §10.1.1 room creation is admin-only (S10). ejabberd would create a room for the admin
    // here; the mock does not (not covered by contract), and admin tooling uses createRoom.
    if (room === undefined) {
      return err('forbidden', 'Room creation is denied by service policy', 'auth')
    }
    const affiliation = this.affiliationOf(room, conn.bare)
    // §7.2.7 (errors: banned), §7.2.6 members-only (S10, S12).
    if (affiliation === 'outcast') {
      return err('forbidden', 'You have been banned from this room', 'auth')
    }
    if (room.config.membersOnly && affiliation === 'none') {
      return err('registration-required', 'Membership is required to enter this room', 'auth')
    }
    const current = this.occupantOf(room, conn)
    if (current !== undefined) {
      // Joining again with the same nick re-sends the room state; a nick change is not
      // supported by the mock (not covered by contract).
      if (current.nick !== nick)
        return err('not-allowed', 'nick changes are not supported', 'cancel')
      this.sendRoomState(room, conn, current)
      return ok(this.joined(room, current))
    }
    const existing = room.occupants.get(nick)
    if (existing !== undefined && existing.bare !== conn.bare) {
      return err('conflict', 'That nickname is already in use by another occupant', 'cancel')
    }
    conn.rooms.add(room.jid)
    if (existing !== undefined) {
      // D22, S11: another session of the same account joins under the same nick. It shares the
      // occupant; nobody else is told.
      existing.sessions.add(conn)
      this.sendRoomState(room, conn, existing)
      return ok(this.joined(room, existing))
    }
    const occupant: Occupant = {
      nick,
      bare: conn.bare,
      role: this.roleOnJoin(room, conn.bare, affiliation),
      sessions: new Set([conn]),
    }
    const others = this.everyone(room)
    room.occupants.set(nick, occupant)
    for (const other of others) this.presence(room, other, occupant, true, [])
    this.sendRoomState(room, conn, occupant)
    return ok(this.joined(room, occupant))
  }

  /**
   * §7.2.3 order (ordering check): existing occupants, then the self-presence, then the
   * history. The join's reply follows, so it resolves on the self-presence. No subject is set
   * on any room, so none is sent.
   */
  private sendRoomState(room: Room, conn: Connection, self: Occupant): void {
    for (const occupant of room.occupants.values()) {
      if (occupant !== self) this.presence(room, conn, occupant, true, [])
    }
    this.presence(room, conn, self, true, [])
    for (const archived of room.history) this.message(room, conn, archived)
  }

  private joined(room: Room, occupant: Occupant): Joined {
    return {
      room: room.jid,
      nick: occupant.nick,
      role: occupant.role,
      affiliation: this.affiliationOf(room, occupant.bare),
    }
  }

  /** Leaving a room one is not in is a no-op success (errors check). */
  leave(conn: Connection, roomJid: string): Outcome<undefined> {
    const room = this.room(roomJid)
    if (room !== undefined) this.depart(room, conn, true)
    return ok0
  }

  /** The session's stream closed: it leaves every room, unannounced to itself. */
  disconnect(conn: Connection): void {
    for (const jid of [...conn.rooms]) {
      const room = this.world.rooms.get(jid)
      if (room !== undefined) this.depart(room, conn, false)
    }
  }

  send(conn: Connection, roomJid: string, body: string): Outcome<{ readonly stanzaId: string }> {
    const room = this.room(roomJid)
    const occupant = room === undefined ? undefined : this.occupantOf(room, conn)
    // §7.4 (S01b, errors): only occupants may post.
    if (room === undefined || occupant === undefined) {
      return err(
        'not-acceptable',
        'Only occupants are allowed to send messages to the conference',
        'modify',
      )
    }
    // §8.4 (S01, S13.md): a visitor in a moderated room is refused.
    if (occupant.role === 'visitor' && room.config.moderated) {
      return err('forbidden', 'Visitors are not allowed to send messages to all occupants', 'auth')
    }
    const archived: ArchivedMessage = {
      stanzaId: this.world.nextStanzaId(),
      nick: occupant.nick,
      from: occupant.bare,
      body,
    }
    if (room.config.archive) room.archive.push(archived)
    room.history = [...room.history, archived].slice(-HISTORY_SIZE)
    // Reflected to every session, the sender's own included (S11); the reply follows it.
    for (const recipient of this.everyone(room)) this.message(room, recipient, archived)
    return ok({ stanzaId: archived.stanzaId })
  }

  // ---- moderation (§8) ----------------------------------------------------------------------

  /**
   * §8.4–8.5 by nick. ejabberd checks the nick first (`not-acceptable`, S13), then
   * `can_change_ra` (`not-allowed`, errors check). The role is stored per bare JID (R13).
   */
  setRole(conn: Connection, roomJid: string, nick: string, role: MucRole): Outcome<undefined> {
    const room = this.room(roomJid)
    if (room === undefined) return err('item-not-found', 'Conference room does not exist', 'cancel')
    const target = room.occupants.get(nick)
    if (target === undefined) {
      return err('not-acceptable', `Nickname ${nick} does not exist in the room`, 'modify')
    }
    const callerAffiliation = this.affiliationOf(room, conn.bare)
    const callerRole = this.occupantOf(room, conn)?.role ?? 'none'
    const targetAffiliation = this.affiliationOf(room, target.bare)
    if (!canChangeRole(callerAffiliation, callerRole, targetAffiliation, target.role, role)) {
      return err('not-allowed', 'Changing role/affiliation is not allowed', 'cancel')
    }
    if (target.role === role) return ok0
    if (role === 'none') {
      // A kick (§8.2, 307); not covered by contract beyond the refusal rules.
      room.storedRoles.delete(target.bare)
      this.eject(room, target, [KICKED], targetAffiliation)
      return ok0
    }
    target.role = role
    room.storedRoles.set(target.bare, role)
    for (const recipient of this.everyone(room)) this.presence(room, recipient, target, true, [])
    return ok0
  }

  // ---- ownership (§9, §10) ------------------------------------------------------------------

  /**
   * §9.3 / §10.6. Owners and admins only (`not-allowed` for a member, errors check). Any change
   * of affiliation clears the stored role; setting the same one again keeps it (C01 R-B). Losing
   * membership of a members-only room ejects the occupant with 321 (S12); a ban with 301.
   */
  setAffiliations(
    conn: Connection,
    roomJid: string,
    entries: readonly AffiliationEntry[],
  ): Outcome<undefined> {
    const room = this.room(roomJid)
    if (room === undefined) return err('item-not-found', 'Conference room does not exist', 'cancel')
    const caller = this.affiliationOf(room, conn.bare)
    if (caller !== 'owner' && caller !== 'admin') {
      return err('not-allowed', 'Changing role/affiliation is not allowed', 'cancel')
    }
    const high = (a: MucAffiliation) => a === 'owner' || a === 'admin'
    for (const entry of entries) {
      const previous = room.affiliations.get(bareOf(entry.jid)) ?? 'none'
      if (caller === 'admin' && (high(entry.affiliation) || high(previous))) {
        return err('not-allowed', 'Changing role/affiliation is not allowed', 'cancel')
      }
    }
    for (const entry of entries) this.applyAffiliation(room, bareOf(entry.jid), entry.affiliation)
    return ok0
  }

  private applyAffiliation(room: Room, bare: string, affiliation: MucAffiliation): void {
    const previous = room.affiliations.get(bare) ?? 'none'
    if (previous === affiliation) return
    room.storedRoles.delete(bare)
    if (affiliation === 'none') room.affiliations.delete(bare)
    else room.affiliations.set(bare, affiliation)
    const occupant = this.occupantByBare(room, bare)
    if (occupant === undefined) return
    const effective = this.affiliationOf(room, bare)
    if (effective === 'outcast') {
      this.eject(room, occupant, [BANNED], effective)
    } else if (room.config.membersOnly && effective === 'none') {
      this.eject(room, occupant, [AFFILIATION_CHANGE], effective)
    } else {
      // A promotion or demotion while present: the role follows the new affiliation (not
      // covered by contract).
      occupant.role = this.defaultRole(effective)
      for (const recipient of this.everyone(room))
        this.presence(room, recipient, occupant, true, [])
    }
  }

  /**
   * §9.5 / §10.5. Owners, admins and moderators read every list; members read lists of a
   * members-only room (errors check); others are refused.
   */
  getAffiliations(
    conn: Connection,
    roomJid: string,
    affiliation: MucAffiliation,
  ): Outcome<readonly AffiliationEntry[]> {
    const room = this.room(roomJid)
    if (room === undefined) return err('item-not-found', 'Conference room does not exist', 'cancel')
    const caller = this.affiliationOf(room, conn.bare)
    const role = this.occupantOf(room, conn)?.role
    const allowed =
      caller === 'owner' ||
      caller === 'admin' ||
      role === 'moderator' ||
      (caller === 'member' && room.config.membersOnly)
    if (!allowed) return err('forbidden', 'Administrator privileges required', 'auth')
    const entries: AffiliationEntry[] = []
    for (const [jid, a] of room.affiliations)
      if (a === affiliation) entries.push({ jid, affiliation: a })
    return ok(entries)
  }

  /**
   * §10.1. Only server admins create rooms (S10, `access_create: muc_create`); the creator is
   * stored as owner. An existing room is reconfigured, as the real transport's createRoom does.
   */
  createRoom(conn: Connection, roomJid: string, config: RoomConfig): Outcome<undefined> {
    if (!conn.admin) return err('forbidden', 'Room creation is denied by service policy', 'auth')
    const jid = bareOf(roomJid)
    const at = jid.lastIndexOf('@')
    if (at <= 0 || jid.slice(at + 1) !== this.world.services.muc) {
      return err('item-not-found', `${jid} is not on ${this.world.services.muc}`, 'cancel')
    }
    const existing = this.world.rooms.get(jid)
    if (existing !== undefined) {
      existing.config = { ...config }
      return ok0
    }
    this.world.rooms.set(jid, {
      jid,
      config: { ...config },
      affiliations: new Map([[conn.bare, 'owner']]),
      storedRoles: new Map(),
      occupants: new Map(),
      archive: [],
      history: [],
    })
    return ok0
  }

  /**
   * §10.2 owner use; a member is `forbidden` (errors check). An owner request to a missing room
   * creates it for the admin and is refused for anyone else by the creation policy.
   */
  configureRoom(conn: Connection, roomJid: string, config: RoomConfig): Outcome<undefined> {
    const room = this.room(roomJid)
    if (room === undefined) return this.createRoom(conn, roomJid, config)
    if (this.affiliationOf(room, conn.bare) !== 'owner') {
      return err('forbidden', 'Owner privileges required', 'auth')
    }
    // Re-saving keeps stored roles (S01b). Side effects of changing members-only or anonymity
    // on present occupants are not covered by contract and not modelled.
    room.config = { ...config }
    return ok0
  }

  getRoomConfig(conn: Connection, roomJid: string): Outcome<RoomConfig> {
    const room = this.room(roomJid)
    if (room === undefined) {
      // ejabberd would create a locked room for the admin here; the mock answers
      // item-not-found instead (not covered by contract).
      if (conn.admin) return err('item-not-found', 'Conference room does not exist', 'cancel')
      return err('forbidden', 'Room creation is denied by service policy', 'auth')
    }
    if (this.affiliationOf(room, conn.bare) !== 'owner') {
      return err('forbidden', 'Owner privileges required', 'auth')
    }
    const { description, ...rest } = room.config
    return ok(description === undefined || description === '' ? rest : { ...rest, description })
  }

  /** §10.9: occupants are removed and the archive goes with the room (C01 R-F, ADM-40). */
  destroyRoom(conn: Connection, roomJid: string): Outcome<undefined> {
    const room = this.room(roomJid)
    if (room === undefined) {
      if (conn.admin) return ok0
      return err('forbidden', 'Room creation is denied by service policy', 'auth')
    }
    if (this.affiliationOf(room, conn.bare) !== 'owner') {
      return err('forbidden', 'Owner privileges required', 'auth')
    }
    for (const occupant of room.occupants.values()) {
      for (const session of occupant.sessions) {
        this.presence(room, session, occupant, false, [], { role: 'none', affiliation: 'none' })
        session.rooms.delete(room.jid)
      }
    }
    this.world.rooms.delete(room.jid)
    return ok0
  }

  /**
   * disco#items on the service: public rooms, plus rooms where the asker is an occupant, owner
   * or admin (server admins see all). Unlisted game rooms stay hidden from players and
   * anonymous sessions (S10) and visible to the admin (S04).
   */
  listRooms(conn: Connection): Outcome<readonly string[]> {
    const rooms: string[] = []
    for (const room of this.world.rooms.values()) {
      const affiliation = this.affiliationOf(room, conn.bare)
      const visible =
        room.config.public ||
        affiliation === 'owner' ||
        affiliation === 'admin' ||
        this.occupantOf(room, conn) !== undefined
      if (visible) rooms.push(room.jid)
    }
    return ok(rooms)
  }

  /** XEP-0133 delete-user: the account loses its affiliations and stored roles (S12). */
  forget(bare: string): void {
    for (const room of this.world.rooms.values()) {
      room.affiliations.delete(bare)
      room.storedRoles.delete(bare)
    }
  }

  // ---- XEP-0313 archive ---------------------------------------------------------------------

  /**
   * Members-only rooms serve their archive to owners, admins and members, joined or not (S01,
   * recovery), and to nobody else (`forbidden`: S05, S10). Pages run backwards with XEP-0059
   * `<before/>`; `first` and `last` are the edge stanza-ids and `complete` marks the page that
   * holds the oldest message (S05).
   */
  queryArchive(conn: Connection, roomJid: string, query: MamQuery): Outcome<MamPage> {
    const room = this.room(roomJid)
    if (room === undefined) return err('item-not-found', 'Conference room does not exist', 'cancel')
    const affiliation = this.affiliationOf(room, conn.bare)
    const member = affiliation === 'owner' || affiliation === 'admin' || affiliation === 'member'
    if (affiliation === 'outcast' || (room.config.membersOnly && !member)) {
      return err('forbidden', 'Access denied by service policy', 'auth')
    }
    const before = query.before
    const older =
      before === undefined || before === '' || !/^\d+$/.test(before)
        ? room.archive
        : room.archive.filter((m) => compareStanzaIds(m.stanzaId, before) < 0)
    const max = Math.max(0, Math.min(MAX_PAGE, Math.floor(query.max)))
    const page = max === 0 ? [] : older.slice(-max)
    const messages = page.map((m): RoomMessage => ({
      room: room.jid,
      stanzaId: m.stanzaId,
      nick: m.nick,
      from: room.config.whois === 'anyone' ? m.from : undefined,
      timestamp: stampOf(m.stanzaId),
      body: m.body,
    }))
    return ok({
      messages,
      first: page[0]?.stanzaId,
      last: page.at(-1)?.stanzaId,
      complete: page.length === older.length,
    })
  }
}

/**
 * ejabberd `can_change_ra/7` for roles, reduced to what the mock's rooms can reach: moderators
 * and owners or admins change participant and visitor roles of those below them; only owners
 * and admins grant moderator; nobody changes an owner's role.
 */
function canChangeRole(
  callerAffiliation: MucAffiliation,
  callerRole: MucRole,
  targetAffiliation: MucAffiliation,
  targetRole: MucRole,
  role: MucRole,
): boolean {
  if (targetRole === role) return true
  const callerIsAdmin = callerAffiliation === 'owner' || callerAffiliation === 'admin'
  if (targetAffiliation === 'owner') return false
  if (targetAffiliation === 'admin' && callerAffiliation !== 'owner') return false
  if (role === 'moderator') return callerIsAdmin
  return callerIsAdmin || callerRole === 'moderator'
}
