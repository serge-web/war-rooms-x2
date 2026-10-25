// AdminOps (ADM-35): the one module through which every admin change to the server passes. It
// works over a `@wrx/transport` Session logged in as `admin` (D3, ADM-12) and applies the rules
// the server spike found (C01, S01, S02, S12, plan/decisions/S13.md):
//
// - R-A (ADM-36): revoking read access to a node removes the affiliation, then every
//   subscription of every full JID of the account. The affiliation goes first, so no session
//   can subscribe again in between (a whitelist node refuses it).
// - R-B (ADM-37): any change of a read-only role's room affiliation clears its stored visitor
//   role, so voice is revoked again, through the role's own login (the vault route), straight
//   after the membership is granted. If that cannot be done the membership is taken away again:
//   the tooling fails closed.
// - R-C (ADM-37): game rooms are always moderated; there is no option to ask otherwise.
// - R-D (ADM-38): a move grants all new access before revoking any old access.
// - R-E (ADM-39): deleting a role removes its room and node affiliations and subscriptions,
//   then the account (already gone is success), then its vault entry.
// - R-F (ADM-40): destroying a room reports its message count first, and refuses if the count
//   changed after the admin confirmed it.
// - Nodes are created before anything is published to them: ejabberd auto-creates a missing
//   node with an open config when the admin publishes (WP 1.2).
//
// Operations are primitives for a planner (2.3 publish, 2.10 audit). Each resolves to a Result
// and never rejects for a refusal (ARC-14), and reports each step to an optional listener.
import { bareJid, domainpart } from '@wrx/domain'
import { RESERVED_ROLE_IDS, parseNodeName, slugSchema } from '@wrx/schemas'
import type {
  AffiliationEntry,
  Endpoint,
  MucAffiliation,
  MucRole,
  NodeConfig,
  Outcome,
  PubsubAffiliationEntry,
  RoomConfig,
  Session,
  SubscriptionEntry,
  Transport,
  TransportError,
} from '@wrx/transport'
import { opsErr, opsOk } from './errors.ts'
import type { AdminOpsError, OpsOutcome, OpsResult, ProgressListener } from './errors.ts'
import { gameRoomConfig } from './target.ts'
import type { NodeAccess, RoomAccess } from './target.ts'
import { ObserverVault } from './vault.ts'

/** How the tooling logs in as a read-only role to have its voice revoked (ADM-37). */
export interface RoleLogin {
  readonly transport: Transport
  readonly endpoint: Endpoint
}

export interface AdminOpsOptions {
  /** A session logged in as the server's `admin` account (D3). */
  readonly session: Session
  /** Needed for read-only room access: the vault route logs in as the role. */
  readonly login?: RoleLogin
  /** The unlocked vault. Can also be set later with `useVault`. */
  readonly vault?: ObserverVault
  readonly onProgress?: ProgressListener
}

export type Ensured = 'created' | 'updated' | 'unchanged'

export interface RoomSpec {
  readonly name: string
  readonly description?: string
}

export interface RoomAccessChange {
  readonly roleId: string
  readonly access: RoomAccess
  /**
   * The role's access before, when the planner knows it. Going from `read` to `write` needs the
   * stored visitor role cleared, which an unchanged `member` affiliation does not do.
   */
  readonly from?: RoomAccess
}

export interface NodeAccessChange {
  readonly roleId: string
  readonly access: NodeAccess
}

/** Everything a role should have after a move, per room and node it gains or loses (R-D). */
export interface RoleAccessPlan {
  readonly rooms?: readonly {
    readonly roomId: string
    readonly access: RoomAccess
    readonly from?: RoomAccess
  }[]
  readonly nodes?: readonly { readonly node: string; readonly access: NodeAccess }[]
}

export interface RoleScope {
  /** Room ids to clear. Default: every room the admin can list. */
  readonly rooms?: readonly string[]
  /** Node names to clear. Default: every node on the service. */
  readonly nodes?: readonly string[]
}

/** One room's answer to the role's own join (`readJoinRoles`): the role it got, or the refusal. */
export type JoinRoleReading =
  | { readonly roomId: string; readonly role: MucRole; readonly error?: undefined }
  | { readonly roomId: string; readonly role?: undefined; readonly error: TransportError }

export interface RoomSnapshot {
  readonly roomId: string
  readonly config: RoomConfig
  /** Owners, admins, members and outcasts, by bare JID. */
  readonly affiliations: readonly AffiliationEntry[]
}

export interface NodeSnapshot {
  readonly node: string
  readonly config: NodeConfig
  readonly affiliations: readonly PubsubAffiliationEntry[]
  /** As the server lists them: full JIDs for the transport's subscriptions. */
  readonly subscriptions: readonly SubscriptionEntry[]
}

export interface ServerSnapshot {
  readonly rooms: readonly RoomSnapshot[]
  readonly nodes: readonly NodeSnapshot[]
  /** Asked for but not on the server. */
  readonly missingRooms: readonly string[]
  readonly missingNodes: readonly string[]
}

const LISTED_AFFILIATIONS: readonly MucAffiliation[] = Object.freeze([
  'owner',
  'admin',
  'member',
  'outcast',
])

/** Most archive pages read when counting a room's messages (100 each). */
const MAX_COUNT_PAGES = 10_000

function sameRoomConfig(a: RoomConfig, b: RoomConfig): boolean {
  return (
    a.name === b.name &&
    (a.description ?? '') === (b.description ?? '') &&
    a.membersOnly === b.membersOnly &&
    a.moderated === b.moderated &&
    a.persistent === b.persistent &&
    a.public === b.public &&
    a.whois === b.whois &&
    a.archive === b.archive
  )
}

function sameNodeConfig(a: NodeConfig, b: NodeConfig): boolean {
  return (
    a.accessModel === b.accessModel &&
    a.publishModel === b.publishModel &&
    a.maxItems === b.maxItems &&
    a.notifyRetract === b.notifyRetract &&
    (a.title ?? '') === (b.title ?? '')
  )
}

function isMissing(error: TransportError): boolean {
  return error.condition === 'item-not-found'
}

/** A refusal because the room, node or account does not exist. */
function gone(result: { readonly ok: false; readonly error: AdminOpsError }): boolean {
  return result.error.cause !== undefined && isMissing(result.error.cause)
}

function hex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class AdminOps {
  readonly session: Session
  private readonly login: RoleLogin | undefined
  private vault: ObserverVault | undefined
  private readonly onProgress: ProgressListener | undefined
  private readonly domain: string

  constructor(options: AdminOpsOptions) {
    this.session = options.session
    this.login = options.login
    this.vault = options.vault
    this.onProgress = options.onProgress
    this.domain = domainpart(options.session.jid)
  }

  /** Attaches the unlocked vault (or detaches it). */
  useVault(vault: ObserverVault | undefined): void {
    this.vault = vault
  }

  roleJid(roleId: string): string {
    return `${roleId}@${this.domain}`
  }

  roomJid(roomId: string): string {
    return `${roomId}@${this.session.services.muc}`
  }

  // ---- plumbing -------------------------------------------------------------------------------

  private emit(
    op: string,
    step: string,
    target: string,
    state: 'started' | 'done' | 'failed',
    extra: { readonly error?: AdminOpsError; readonly messageCount?: number } = {},
  ): void {
    this.onProgress?.({ op, step, target, state, ...extra })
  }

  /** A read: like `step`, but reported only if it fails, so progress lists changes. */
  private query<T>(
    op: string,
    step: string,
    target: string,
    request: () => Outcome<T>,
  ): OpsOutcome<T> {
    return this.step(op, step, target, request, true)
  }

  /** Runs one server request as a reported step; a refusal becomes a typed error. */
  private async step<T>(
    op: string,
    step: string,
    target: string,
    request: () => Outcome<T>,
    quiet = false,
  ): OpsOutcome<T> {
    if (!quiet) this.emit(op, step, target, 'started')
    const result = await request()
    if (result.ok) {
      if (!quiet) this.emit(op, step, target, 'done')
      return opsOk(result.value)
    }
    const failed = opsErr('refused', `${op}: ${step} failed (${result.error.condition})`, {
      op,
      step,
      target,
      cause: result.error,
    })
    this.emit(op, step, target, 'failed', { error: failed.error })
    return failed
  }

  private fail(
    op: string,
    step: string,
    target: string,
    code: AdminOpsError['code'],
    message: string,
    extra: Omit<AdminOpsError, 'code' | 'message'> = {},
  ): { readonly ok: false; readonly error: AdminOpsError } {
    const failed = opsErr(code, message, { op, step, target, ...extra })
    this.emit(op, step, target, 'failed', { error: failed.error })
    return failed
  }

  private checkRole(op: string, roleId: string): OpsResult<void> {
    if (!slugSchema.safeParse(roleId).success) {
      return opsErr('invalid', `"${roleId}" is not a role id`, { op, target: roleId })
    }
    if (RESERVED_ROLE_IDS.includes(roleId)) {
      return opsErr('invalid', `"${roleId}" is reserved; the tooling never changes it`, {
        op,
        target: roleId,
      })
    }
    return opsOk(undefined)
  }

  private checkRoom(op: string, roomId: string): OpsResult<void> {
    return slugSchema.safeParse(roomId).success
      ? opsOk(undefined)
      : opsErr('invalid', `"${roomId}" is not a room id`, { op, target: roomId })
  }

  private checkNode(op: string, node: string): OpsResult<void> {
    return parseNodeName(node) === undefined
      ? opsErr('invalid', `"${node}" is not a WRX1 node`, { op, target: node })
      : opsOk(undefined)
  }

  /**
   * The vault must be unlocked whenever one exists, so password resets and deletions keep it in
   * step (ADM-37). With no vault stored, there is nothing to keep in step.
   */
  private async vaultInStep(op: string, target: string): OpsOutcome<ObserverVault | undefined> {
    if (this.vault?.unlocked === true) return opsOk(this.vault)
    const exists = await ObserverVault.exists(this.session.admin)
    if (!exists.ok) return this.fail(op, 'check vault', target, 'refused', exists.error.message)
    if (exists.value) {
      return this.fail(op, 'check vault', target, 'vault-locked', 'unlock the vault first')
    }
    return opsOk(undefined)
  }

  // ---- rooms ----------------------------------------------------------------------------------

  /**
   * Creates the room, or brings its configuration to NFR-3, then reads it back. The admin, who
   * creates it, is its owner.
   */
  async ensureRoom(roomId: string, spec: RoomSpec): OpsOutcome<Ensured> {
    const op = 'ensureRoom'
    const valid = this.checkRoom(op, roomId)
    if (!valid.ok) return valid
    const room = this.roomJid(roomId)
    const wanted = gameRoomConfig(spec.name, spec.description)
    const exists = await this.roomExists(op, roomId)
    if (!exists.ok) return exists
    let outcome: Ensured
    if (exists.value) {
      const current = await this.query(op, 'read room config', roomId, () =>
        this.session.muc.getRoomConfig(room),
      )
      if (!current.ok) return current
      if (sameRoomConfig(current.value, wanted)) return opsOk('unchanged')
      const configured = await this.step(op, 'configure room', roomId, () =>
        this.session.muc.configureRoom(room, wanted),
      )
      if (!configured.ok) return configured
      outcome = 'updated'
    } else {
      // XEP-0045 §10.1: created locked, and configured before it unlocks, in one call.
      const created = await this.step(op, 'create room', roomId, () =>
        this.session.muc.createRoom(room, wanted),
      )
      if (!created.ok) return created
      outcome = 'created'
    }
    const check = await this.query(op, 'verify room config', roomId, () =>
      this.session.muc.getRoomConfig(room),
    )
    if (!check.ok) return check
    if (!sameRoomConfig(check.value, wanted)) {
      return this.fail(op, 'verify room config', roomId, 'verify-failed', 'room config differs')
    }
    return opsOk(outcome)
  }

  /** One role's access to one room. */
  setRoomAccess(roomId: string, roleId: string, access: RoomAccess, from?: RoomAccess) {
    return this.applyRoomAccess(roomId, [
      { roleId, access, ...(from === undefined ? {} : { from }) },
    ])
  }

  /**
   * Several roles' access to one room: write grants, then read-only grants (membership and voice
   * revocation back to back), then revocations.
   */
  async applyRoomAccess(roomId: string, changes: readonly RoomAccessChange[]): OpsOutcome<void> {
    const op = 'applyRoomAccess'
    const valid = this.checkRoom(op, roomId)
    if (!valid.ok) return valid
    for (const change of changes) {
      const role = this.checkRole(op, change.roleId)
      if (!role.ok) return role
    }
    const room = this.roomJid(roomId)
    const members = await this.query(op, 'read members', roomId, () =>
      this.session.muc.getAffiliations(room, 'member'),
    )
    if (!members.ok) return members
    const isMember = new Set(members.value.map((m) => bareJid(m.jid)))

    const writes = changes.filter((c) => c.access === 'write')
    const newWrites = writes.filter((c) => !isMember.has(this.roleJid(c.roleId)))
    if (newWrites.length > 0) {
      const granted = await this.step(op, 'grant membership', roomId, () =>
        this.session.muc.setAffiliations(
          room,
          newWrites.map((c) => ({ jid: this.roleJid(c.roleId), affiliation: 'member' as const })),
        ),
      )
      if (!granted.ok) return granted
    }
    for (const change of writes) {
      if (change.from !== 'read' || !isMember.has(this.roleJid(change.roleId))) continue
      const restored = await this.restoreVoice(op, roomId, change.roleId)
      if (!restored.ok) return restored
    }

    for (const change of changes.filter((c) => c.access === 'read')) {
      const readOnly = await this.readOnlyIn(op, change.roleId, [roomId])
      if (!readOnly.ok) return readOnly
    }

    const revokes = changes.filter((c) => c.access === 'none')
    if (revokes.length > 0) {
      const revoked = await this.step(op, 'revoke membership', roomId, () =>
        this.session.muc.setAffiliations(
          room,
          revokes.map((c) => ({ jid: this.roleJid(c.roleId), affiliation: 'none' as const })),
        ),
      )
      if (!revoked.ok) return revoked
    }
    return opsOk(undefined)
  }

  /**
   * Makes a role read-only in rooms (ADM-37, the S13 vault route), granting membership where it
   * is missing. Call this before publishing the documents that tell the role's client about the
   * rooms, so its client has no reason to join early. For each room, back to back:
   *
   * 1. the admin is in the room (owner, so moderator);
   * 2. the role becomes a member, if it is not one;
   * 3. the role's own session, logged in with its vault password, joins;
   * 4. the admin sets it to `visitor` by nick, which ejabberd stores per account (R13);
   * 5. it rejoins, to check that the stored role is `visitor`, and leaves.
   *
   * The role's session is closed at the end. If a step fails, the role's membership of that room
   * is taken away again, so it is never left able to post (`rolledBack` in the error).
   */
  makeReadOnly(roleId: string, roomIds: readonly string[]): OpsOutcome<void> {
    const op = 'makeReadOnly'
    const role = this.checkRole(op, roleId)
    if (!role.ok) return Promise.resolve(role)
    for (const roomId of roomIds) {
      const room = this.checkRoom(op, roomId)
      if (!room.ok) return Promise.resolve(room)
    }
    return this.readOnlyIn(op, roleId, roomIds)
  }

  /**
   * The MUC role each room gives this role on joining, read through the role's own login with
   * its vault password (WP 2.10 audit). No admin command shows a stored role (WP 0.1, R13), so
   * this is the only way to see whether a read-only role really is a visitor. It changes nothing:
   * the role's session joins each room, notes its role and leaves, and is always closed. Its
   * presence shows briefly in each room. A room it cannot join is reported with the refusal.
   */
  async readJoinRoles(
    roleId: string,
    roomIds: readonly string[],
  ): OpsOutcome<readonly JoinRoleReading[]> {
    const op = 'readJoinRoles'
    const role = this.checkRole(op, roleId)
    if (!role.ok) return role
    for (const roomId of roomIds) {
      const room = this.checkRoom(op, roomId)
      if (!room.ok) return room
    }
    return this.asRole(op, roleId, async (session) => {
      const readings: JoinRoleReading[] = []
      for (const roomId of roomIds) {
        const room = this.roomJid(roomId)
        const joined = await session.muc.join(room, roleId)
        if (!joined.ok) {
          readings.push({ roomId, error: joined.error })
          continue
        }
        readings.push({ roomId, role: joined.value.role })
        await session.muc.leave(room)
      }
      return opsOk(readings)
    })
  }

  private async readOnlyIn(
    op: string,
    roleId: string,
    roomIds: readonly string[],
  ): OpsOutcome<void> {
    return this.asRole(op, roleId, async (role) => {
      for (const roomId of roomIds) {
        const done = await this.revokeVoice(op, role, roleId, roomId)
        if (!done.ok) return done
      }
      return opsOk(undefined)
    })
  }

  /** Logs in as the role with its vault password, runs `body`, and always disconnects. */
  private async asRole<T>(
    op: string,
    roleId: string,
    body: (role: Session) => OpsOutcome<T>,
  ): OpsOutcome<T> {
    // Everything that can fail before a membership is granted is checked first.
    if (this.login === undefined) {
      return this.fail(op, 'log in as role', roleId, 'invalid', 'no transport to log in with')
    }
    if (this.vault?.unlocked !== true) {
      return this.fail(op, 'log in as role', roleId, 'vault-locked', 'unlock the vault first')
    }
    const password = this.vault.get(roleId)
    if (password === undefined) {
      return this.fail(op, 'log in as role', roleId, 'no-password', 'the vault has no password')
    }
    this.emit(op, 'log in as role', roleId, 'started')
    const connected = await this.login.transport.connect({
      endpoint: this.login.endpoint,
      credentials: { kind: 'password', username: roleId, password },
      resource: `admin-ops-${hex(6)}`,
    })
    if (!connected.ok) {
      return this.fail(
        op,
        'log in as role',
        roleId,
        'login-failed',
        'logging in as the role failed',
        {
          cause: connected.error,
        },
      )
    }
    this.emit(op, 'log in as role', roleId, 'done')
    try {
      return await body(connected.value)
    } finally {
      await connected.value.disconnect()
      this.emit(op, 'log out role', roleId, 'done')
    }
  }

  /** Puts the admin's session in the room unless it is there; resolves with how to undo that. */
  private async adminIn(op: string, roomId: string): OpsOutcome<() => Promise<void>> {
    const room = this.roomJid(roomId)
    if (this.session.muc.occupants(room).some((o) => o.self)) {
      return opsOk(() => Promise.resolve())
    }
    const nick = bareJid(this.session.jid).split('@')[0] ?? 'admin'
    const joined = await this.step(op, 'admin joins', roomId, () =>
      this.session.muc.join(room, nick),
    )
    if (!joined.ok) return joined
    return opsOk(async () => {
      await this.step(op, 'admin leaves', roomId, () => this.session.muc.leave(room))
    })
  }

  private async revokeVoice(
    op: string,
    role: Session,
    roleId: string,
    roomId: string,
  ): OpsOutcome<void> {
    const room = this.roomJid(roomId)
    const jid = this.roleJid(roleId)
    // Read first: it fails `item-not-found` for a missing room, where a join would create it.
    const members = await this.query(op, 'read members', roomId, () =>
      this.session.muc.getAffiliations(room, 'member'),
    )
    if (!members.ok) return members
    const admin = await this.adminIn(op, roomId)
    if (!admin.ok) return admin
    const rollback = async (
      step: string,
      code: AdminOpsError['code'],
      message: string,
      cause?: TransportError,
    ) => {
      // Fail closed: a role that should be read-only and may have voice loses the room.
      const undone = await this.step(op, 'roll back membership', roomId, () =>
        this.session.muc.setAffiliations(room, [{ jid, affiliation: 'none' }]),
      )
      return this.fail(op, step, roomId, code, message, {
        rolledBack: undone.ok,
        ...(cause === undefined ? {} : { cause }),
      })
    }
    try {
      if (!members.value.some((m) => bareJid(m.jid) === jid)) {
        const granted = await this.step(op, 'grant membership', roomId, () =>
          this.session.muc.setAffiliations(room, [{ jid, affiliation: 'member' }]),
        )
        if (!granted.ok) return granted
      }
      // R-B: straight after any affiliation change, before anything else.
      this.emit(op, 'role joins', roomId, 'started')
      const joined = await role.muc.join(room, roleId)
      if (!joined.ok)
        return await rollback('role joins', 'refused', 'the role could not join', joined.error)
      this.emit(op, 'role joins', roomId, 'done')
      if (joined.value.role !== 'visitor') {
        const revoked = await this.step(op, 'revoke voice', roomId, () =>
          this.session.muc.setRole(room, roleId, 'visitor', 'read-only'),
        )
        if (!revoked.ok)
          return await rollback(
            'revoke voice',
            'refused',
            'voice was not revoked',
            revoked.error.cause,
          )
      }
      await role.muc.leave(room)
      this.emit(op, 'verify visitor', roomId, 'started')
      const again = await role.muc.join(room, roleId)
      if (!again.ok)
        return await rollback('verify visitor', 'refused', 'the role could not rejoin', again.error)
      await role.muc.leave(room)
      if (again.value.role !== 'visitor') {
        return await rollback(
          'verify visitor',
          'verify-failed',
          `the role rejoined as ${again.value.role}`,
        )
      }
      this.emit(op, 'verify visitor', roomId, 'done')
      return opsOk(undefined)
    } finally {
      await admin.value()
    }
  }

  /**
   * Gives a read-only member its voice back (read to write). Through the role's login when the
   * vault has its password; otherwise by taking the membership away and back, which clears the
   * stored role (R-B) but ejects the role's online sessions from the room (status 321).
   */
  private async restoreVoice(op: string, roomId: string, roleId: string): OpsOutcome<void> {
    const room = this.roomJid(roomId)
    const jid = this.roleJid(roleId)
    if (this.login !== undefined && this.vault?.get(roleId) !== undefined) {
      return this.asRole(op, roleId, async (role) => {
        const admin = await this.adminIn(op, roomId)
        if (!admin.ok) return admin
        try {
          const joined = await this.step(op, 'role joins', roomId, () =>
            role.muc.join(room, roleId),
          )
          if (!joined.ok) return joined
          if (joined.value.role === 'visitor') {
            const voiced = await this.step(op, 'grant voice', roomId, () =>
              this.session.muc.setRole(room, roleId, 'participant', 'write access'),
            )
            if (!voiced.ok) return voiced
          }
          await role.muc.leave(room)
          return opsOk(undefined)
        } finally {
          await admin.value()
        }
      })
    }
    const removed = await this.step(op, 'clear stored role', roomId, () =>
      this.session.muc.setAffiliations(room, [{ jid, affiliation: 'none' }]),
    )
    if (!removed.ok) return removed
    return this.step(op, 'grant membership', roomId, () =>
      this.session.muc.setAffiliations(room, [{ jid, affiliation: 'member' }]),
    )
  }

  /** The number of archived messages in a room (R-F): what destroying it deletes. */
  async roomMessageCount(roomId: string): OpsOutcome<number> {
    const op = 'roomMessageCount'
    const valid = this.checkRoom(op, roomId)
    if (!valid.ok) return valid
    const room = this.roomJid(roomId)
    let count = 0
    let before: string | undefined
    for (let page = 0; page < MAX_COUNT_PAGES; page++) {
      const result = await this.query(op, 'read archive', roomId, () =>
        this.session.mam.queryRoom(
          room,
          before === undefined ? { max: 100 } : { before, max: 100 },
        ),
      )
      if (!result.ok) return result
      count += result.value.messages.length
      if (result.value.complete || result.value.first === undefined) return opsOk(count)
      before = result.value.first
    }
    return this.fail(op, 'read archive', roomId, 'verify-failed', 'the archive did not end')
  }

  /**
   * Destroys a room and its archive (R-F, ADM-40). The admin must have been shown the message
   * count: it is counted again first, reported, and the room is left alone if it changed.
   */
  async destroyRoom(
    roomId: string,
    confirm: { readonly messageCount: number },
  ): OpsOutcome<{ readonly messageCount: number }> {
    const op = 'destroyRoom'
    const valid = this.checkRoom(op, roomId)
    if (!valid.ok) return valid
    const count = await this.roomMessageCount(roomId)
    if (!count.ok) {
      if (count.error.cause !== undefined && isMissing(count.error.cause)) {
        return opsOk({ messageCount: 0 })
      }
      return count
    }
    this.emit(op, 'count messages', roomId, 'done', { messageCount: count.value })
    if (count.value !== confirm.messageCount) {
      return this.fail(op, 'count messages', roomId, 'count-changed', 'the message count changed', {
        messageCount: count.value,
      })
    }
    const destroyed = await this.step(op, 'destroy room', roomId, () =>
      this.session.muc.destroyRoom(this.roomJid(roomId), 'removed from the game design'),
    )
    if (!destroyed.ok) {
      if (destroyed.error.cause !== undefined && isMissing(destroyed.error.cause)) {
        return opsOk({ messageCount: 0 })
      }
      return destroyed
    }
    return opsOk({ messageCount: count.value })
  }

  // ---- nodes ----------------------------------------------------------------------------------

  /** Creates the node with this config, or brings its config to it, then reads it back. */
  async ensureNode(node: string, config: NodeConfig): OpsOutcome<Ensured> {
    const op = 'ensureNode'
    const valid = this.checkNode(op, node)
    if (!valid.ok) return valid
    const current = await this.session.pubsub.getNodeConfig(node)
    let outcome: Ensured
    if (current.ok && sameNodeConfig(current.value, config)) return opsOk('unchanged')
    if (current.ok) {
      const configured = await this.step(op, 'configure node', node, () =>
        this.session.pubsub.configureNode(node, config),
      )
      if (!configured.ok) return configured
      outcome = 'updated'
    } else if (isMissing(current.error)) {
      const created = await this.step(op, 'create node', node, () =>
        this.session.pubsub.createNode(node, config),
      )
      if (!created.ok) return created
      outcome = 'created'
    } else {
      return this.fail(op, 'read node config', node, 'refused', 'reading the node failed', {
        cause: current.error,
      })
    }
    const check = await this.query(op, 'verify node config', node, () =>
      this.session.pubsub.getNodeConfig(node),
    )
    if (!check.ok) return check
    if (!sameNodeConfig(check.value, config)) {
      return this.fail(op, 'verify node config', node, 'verify-failed', 'node config differs')
    }
    return opsOk(outcome)
  }

  /**
   * Publishes one item, always after `ensureNode`, so the admin never auto-creates a node with
   * the server's open default config.
   */
  async publishDocument(
    node: string,
    config: NodeConfig,
    itemId: string,
    payload: string,
  ): OpsOutcome<void> {
    const ensured = await this.ensureNode(node, config)
    if (!ensured.ok) return ensured
    return this.step('publishDocument', 'publish', node, () =>
      this.session.pubsub.publish(node, itemId, payload),
    )
  }

  /** Deletes a node; already gone is success. */
  async deleteNode(node: string): OpsOutcome<void> {
    const op = 'deleteNode'
    const valid = this.checkNode(op, node)
    if (!valid.ok) return valid
    const deleted = await this.step(op, 'delete node', node, () =>
      this.session.pubsub.deleteNode(node),
    )
    if (!deleted.ok && deleted.error.cause !== undefined && isMissing(deleted.error.cause)) {
      return opsOk(undefined)
    }
    return deleted
  }

  setNodeAccess(node: string, roleId: string, access: NodeAccess): OpsOutcome<void> {
    return this.applyNodeAccess(node, [{ roleId, access }])
  }

  /**
   * Several roles' access to one node: grants, then revocations. Revoking (R-A) sets the
   * affiliation to none first, so a whitelist node refuses any new subscription, then removes
   * every subscription whose bare JID is the role's (one per full JID), then checks none is left.
   */
  async applyNodeAccess(node: string, changes: readonly NodeAccessChange[]): OpsOutcome<void> {
    const op = 'applyNodeAccess'
    const valid = this.checkNode(op, node)
    if (!valid.ok) return valid
    for (const change of changes) {
      const role = this.checkRole(op, change.roleId)
      if (!role.ok) return role
    }
    const grants = changes.filter((c) => c.access !== 'none')
    if (grants.length > 0) {
      const granted = await this.step(op, 'grant affiliation', node, () =>
        this.session.pubsub.setAffiliations(
          node,
          grants.map((c) => ({
            jid: this.roleJid(c.roleId),
            affiliation: c.access === 'publish' ? ('publisher' as const) : ('member' as const),
          })),
        ),
      )
      if (!granted.ok) return granted
    }
    const revoked = new Set(
      changes.filter((c) => c.access === 'none').map((c) => this.roleJid(c.roleId)),
    )
    if (revoked.size === 0) return opsOk(undefined)
    return this.revokeNode(op, node, revoked)
  }

  private async revokeNode(op: string, node: string, jids: ReadonlySet<string>): OpsOutcome<void> {
    const removed = await this.step(op, 'revoke affiliation', node, () =>
      this.session.pubsub.setAffiliations(
        node,
        [...jids].map((jid) => ({ jid, affiliation: 'none' as const })),
      ),
    )
    if (!removed.ok) return removed
    const theirs = async (): OpsOutcome<readonly SubscriptionEntry[]> => {
      const subs = await this.query(op, 'read subscriptions', node, () =>
        this.session.pubsub.getSubscriptions(node),
      )
      if (!subs.ok) return subs
      return opsOk(subs.value.filter((s) => jids.has(bareJid(s.jid)) && s.subscription !== 'none'))
    }
    const found = await theirs()
    if (!found.ok) return found
    if (found.value.length > 0) {
      const cleared = await this.step(op, 'remove subscriptions', node, () =>
        this.session.pubsub.setSubscriptions(
          node,
          found.value.map((s) => ({ jid: s.jid, subscription: 'none' as const })),
        ),
      )
      if (!cleared.ok) return cleared
      const left = await theirs()
      if (!left.ok) return left
      if (left.value.length > 0) {
        return this.fail(op, 'remove subscriptions', node, 'verify-failed', 'subscriptions remain')
      }
    }
    return opsOk(undefined)
  }

  // ---- roles ----------------------------------------------------------------------------------

  /**
   * Moves a role's access (R-D, ADM-38): every grant in the plan (rooms, then nodes) before any
   * revocation, so the role is never locked out in between. A failed grant stops the move before
   * anything is revoked.
   */
  async moveRole(roleId: string, plan: RoleAccessPlan): OpsOutcome<void> {
    const op = 'moveRole'
    const role = this.checkRole(op, roleId)
    if (!role.ok) return role
    const rooms = plan.rooms ?? []
    const nodes = plan.nodes ?? []
    for (const { roomId, access, from } of rooms.filter((r) => r.access !== 'none')) {
      const done = await this.setRoomAccess(roomId, roleId, access, from)
      if (!done.ok) return done
    }
    for (const { node, access } of nodes.filter((n) => n.access !== 'none')) {
      const done = await this.setNodeAccess(node, roleId, access)
      if (!done.ok) return done
    }
    for (const { roomId } of rooms.filter((r) => r.access === 'none')) {
      const done = await this.setRoomAccess(roomId, roleId, 'none')
      if (!done.ok) return done
    }
    for (const { node } of nodes.filter((n) => n.access === 'none')) {
      const done = await this.setNodeAccess(node, roleId, 'none')
      if (!done.ok) return done
    }
    return opsOk(undefined)
  }

  /**
   * Deletes a role (R-E, ADM-39): its room affiliations, its node affiliations and
   * subscriptions, then the account (already gone is success), then its vault entry. Rooms and
   * nodes that no longer exist are skipped.
   */
  async deleteRole(roleId: string, scope: RoleScope = {}): OpsOutcome<void> {
    const op = 'deleteRole'
    const role = this.checkRole(op, roleId)
    if (!role.ok) return role
    const vault = await this.vaultInStep(op, roleId)
    if (!vault.ok) return vault
    const jid = this.roleJid(roleId)

    const rooms = await this.roomIds(op, scope.rooms)
    if (!rooms.ok) return rooms
    for (const roomId of rooms.value) {
      const removed = await this.step(op, 'revoke membership', roomId, () =>
        this.session.muc.setAffiliations(this.roomJid(roomId), [{ jid, affiliation: 'none' }]),
      )
      if (!removed.ok && !gone(removed)) return removed
    }

    const nodes = await this.nodeNames(op, scope.nodes)
    if (!nodes.ok) return nodes
    for (const node of nodes.value) {
      const revoked = await this.revokeNode(op, node, new Set([jid]))
      if (!revoked.ok && !gone(revoked)) return revoked
    }

    const deleted = await this.deleteAccountOnly(op, roleId)
    if (!deleted.ok) return deleted
    if (vault.value !== undefined) {
      const forgotten = await vault.value.remove(roleId)
      if (!forgotten.ok)
        return this.fail(
          op,
          'remove from vault',
          roleId,
          forgotten.error.code,
          forgotten.error.message,
        )
    }
    return opsOk(undefined)
  }

  /** The given room ids, or every room the admin can list on the MUC service. */
  private async roomIds(
    op: string,
    given: readonly string[] | undefined,
  ): OpsOutcome<readonly string[]> {
    if (given !== undefined) return opsOk(given)
    const listed = await this.query(op, 'list rooms', this.session.services.muc, () =>
      this.session.muc.listRooms(),
    )
    if (!listed.ok) return listed
    const suffix = `@${this.session.services.muc}`
    return opsOk(
      listed.value
        .map((jid) => bareJid(jid))
        .filter((jid) => jid.endsWith(suffix))
        .map((jid) => jid.slice(0, -suffix.length)),
    )
  }

  /**
   * Whether the room exists, from the service's room list (the admin sees unlisted rooms too).
   * Not from the room config: on ejabberd an owner request to a missing room creates it, public
   * and semi-anonymous, so a read must never send one to a room that may not exist.
   */
  private async roomExists(op: string, roomId: string): OpsOutcome<boolean> {
    const rooms = await this.roomIds(op, undefined)
    return rooms.ok ? opsOk(rooms.value.includes(roomId)) : rooms
  }

  /** The given node names, or every WRX1 node on the PubSub service. */
  private async nodeNames(
    op: string,
    given: readonly string[] | undefined,
  ): OpsOutcome<readonly string[]> {
    if (given !== undefined) return opsOk(given)
    const listed = await this.query(op, 'list nodes', this.session.services.pubsub, () =>
      this.session.pubsub.listNodes(),
    )
    if (!listed.ok) return listed
    return opsOk(listed.value.filter((n) => parseNodeName(n) !== undefined))
  }

  // ---- accounts -------------------------------------------------------------------------------

  /**
   * Creates a role's account (XEP-0133 add-user). With `readOnly`, the password also goes into
   * the vault; if that fails the account is removed again, so a retry starts clean.
   */
  async createAccount(
    roleId: string,
    password: string,
    options: { readonly readOnly?: boolean } = {},
  ): OpsOutcome<void> {
    const op = 'createAccount'
    const role = this.checkRole(op, roleId)
    if (!role.ok) return role
    const vault = await this.vaultInStep(op, roleId)
    if (!vault.ok) return vault
    if (options.readOnly === true && vault.value === undefined) {
      return this.fail(
        op,
        'check vault',
        roleId,
        'vault-locked',
        'a read-only role needs the vault',
      )
    }
    const added = await this.step(op, 'add account', roleId, () =>
      this.session.admin.addUser(this.roleJid(roleId), password),
    )
    if (!added.ok) {
      return added.error.cause?.condition === 'conflict'
        ? opsErr('exists', `the account ${roleId} already exists`, { op, target: roleId })
        : added
    }
    if (options.readOnly === true && vault.value !== undefined) {
      const stored = await vault.value.set(roleId, password)
      if (!stored.ok) {
        await this.deleteAccountOnly(op, roleId)
        return this.fail(op, 'store in vault', roleId, stored.error.code, stored.error.message, {
          rolledBack: true,
        })
      }
    }
    return opsOk(undefined)
  }

  /**
   * Sets a role's password (ADM-26). Current sessions stay logged in (PLY-31). If the vault holds
   * the role's password, or `readOnly` asks for it, the vault is written first and restored if
   * the server refuses, so the two never disagree after the call.
   */
  async setPassword(
    roleId: string,
    password: string,
    options: { readonly readOnly?: boolean } = {},
  ): OpsOutcome<void> {
    const op = 'setPassword'
    const role = this.checkRole(op, roleId)
    if (!role.ok) return role
    if (password === '') return opsErr('invalid', 'the password is empty', { op, target: roleId })
    const found = await this.vaultInStep(op, roleId)
    if (!found.ok) return found
    const vault = found.value
    if (options.readOnly === true && vault === undefined) {
      return this.fail(
        op,
        'check vault',
        roleId,
        'vault-locked',
        'a read-only role needs the vault',
      )
    }
    const inVault = vault !== undefined && (vault.has(roleId) || options.readOnly === true)
    const previous = vault?.get(roleId)
    if (inVault) {
      const stored = await vault.set(roleId, password)
      if (!stored.ok)
        return this.fail(op, 'store in vault', roleId, stored.error.code, stored.error.message)
    }
    const changed = await this.step(op, 'change password', roleId, () =>
      this.session.admin.changePassword(this.roleJid(roleId), password),
    )
    if (!changed.ok && inVault) {
      const restored =
        previous === undefined ? await vault.remove(roleId) : await vault.set(roleId, previous)
      return opsErr(changed.error.code, changed.error.message, {
        ...changed.error,
        rolledBack: restored.ok,
      })
    }
    return changed
  }

  /** Deletes the account and its vault entry. Use `deleteRole` to clear its access first (R-E). */
  async deleteAccount(roleId: string): OpsOutcome<void> {
    const op = 'deleteAccount'
    const role = this.checkRole(op, roleId)
    if (!role.ok) return role
    const vault = await this.vaultInStep(op, roleId)
    if (!vault.ok) return vault
    const deleted = await this.deleteAccountOnly(op, roleId)
    if (!deleted.ok) return deleted
    if (vault.value !== undefined) {
      const forgotten = await vault.value.remove(roleId)
      if (!forgotten.ok)
        return this.fail(
          op,
          'remove from vault',
          roleId,
          forgotten.error.code,
          forgotten.error.message,
        )
    }
    return opsOk(undefined)
  }

  /** XEP-0133 delete-user; `item-not-found` is already deleted (R-E). */
  private async deleteAccountOnly(op: string, roleId: string): OpsOutcome<void> {
    const deleted = await this.step(op, 'delete account', roleId, () =>
      this.session.admin.deleteUser(this.roleJid(roleId)),
    )
    if (!deleted.ok && deleted.error.cause !== undefined && isMissing(deleted.error.cause)) {
      return opsOk(undefined)
    }
    return deleted
  }

  // ---- reading state (2.3 diff, 2.10 audit) -------------------------------------------------

  /** A room's config and affiliations; undefined when the room does not exist. */
  async readRoom(roomId: string): OpsOutcome<RoomSnapshot | undefined> {
    const op = 'readRoom'
    const valid = this.checkRoom(op, roomId)
    if (!valid.ok) return valid
    const exists = await this.roomExists(op, roomId)
    if (!exists.ok) return exists
    return exists.value ? this.readExistingRoom(op, roomId) : opsOk(undefined)
  }

  private async readExistingRoom(op: string, roomId: string): OpsOutcome<RoomSnapshot> {
    const room = this.roomJid(roomId)
    const config = await this.query(op, 'read room config', roomId, () =>
      this.session.muc.getRoomConfig(room),
    )
    if (!config.ok) return config
    const affiliations: AffiliationEntry[] = []
    for (const affiliation of LISTED_AFFILIATIONS) {
      const listed = await this.query(op, `read ${affiliation}s`, roomId, () =>
        this.session.muc.getAffiliations(room, affiliation),
      )
      if (!listed.ok) return listed
      affiliations.push(...listed.value.map((e) => ({ jid: bareJid(e.jid), affiliation })))
    }
    return opsOk({ roomId, config: config.value, affiliations })
  }

  async readNode(node: string): OpsOutcome<NodeSnapshot | undefined> {
    const op = 'readNode'
    const valid = this.checkNode(op, node)
    if (!valid.ok) return valid
    const config = await this.session.pubsub.getNodeConfig(node)
    if (!config.ok) {
      if (isMissing(config.error)) return opsOk(undefined)
      return this.fail(op, 'read node config', node, 'refused', 'reading the node failed', {
        cause: config.error,
      })
    }
    const affiliations = await this.query(op, 'read affiliations', node, () =>
      this.session.pubsub.getAffiliations(node),
    )
    if (!affiliations.ok) return affiliations
    const subscriptions = await this.query(op, 'read subscriptions', node, () =>
      this.session.pubsub.getSubscriptions(node),
    )
    if (!subscriptions.ok) return subscriptions
    return opsOk({
      node,
      config: config.value,
      affiliations: affiliations.value,
      subscriptions: subscriptions.value,
    })
  }

  /**
   * Rooms and nodes as the server has them. Without a scope: every room the admin can list and
   * every WRX1 node on the service.
   */
  async readState(scope: RoleScope = {}): OpsOutcome<ServerSnapshot> {
    const op = 'readState'
    for (const roomId of scope.rooms ?? []) {
      const valid = this.checkRoom(op, roomId)
      if (!valid.ok) return valid
    }
    const listed = await this.roomIds(op, undefined)
    if (!listed.ok) return listed
    const nodes = await this.nodeNames(op, scope.nodes)
    if (!nodes.ok) return nodes
    const rooms: RoomSnapshot[] = []
    const missingRooms: string[] = []
    for (const roomId of scope.rooms ?? listed.value) {
      if (!listed.value.includes(roomId)) {
        missingRooms.push(roomId)
        continue
      }
      const room = await this.readExistingRoom(op, roomId)
      if (!room.ok) return room
      rooms.push(room.value)
    }
    const read: NodeSnapshot[] = []
    const missingNodes: string[] = []
    for (const node of nodes.value) {
      const snapshot = await this.readNode(node)
      if (!snapshot.ok) return snapshot
      if (snapshot.value === undefined) missingNodes.push(node)
      else read.push(snapshot.value)
    }
    return opsOk({ rooms, nodes: read, missingRooms, missingNodes })
  }
}
