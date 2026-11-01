// The publish planner (WP 2.3, ADM-10): diffs `targetState(design)` against the server view and
// returns the ordered steps that converge the server, and nothing for what already matches, so a
// second publish of the same design plans no step. Pure: no server, no clock, no randomness.
//
// Order, the safety argument while players are online (D23):
//   0 accounts       new accounts; password resets the vault needs (ADM-26)
//   1 rooms          create or configure (NFR-3, R-C)
//   2 nodes          create or configure, before anything is published to them
//   3 grants         room write access, read-only grants (membership and voice back to back,
//                    R-B), voice restored, node access: every grant before any revoke (R-D, ADM-25)
//   4 revokes        voice revoked (write to read), room and node access removed (R-A)
//   5 documents      assets, forces, roles, rooms, objectives (the admin's item, §3 rule 14);
//                    after access, so no client learns of a room it cannot yet use correctly,
//                    and a read-only role is read-only before its room documents say so (ADM-37).
//                    An objectives node holding any item but the admin's (a server published
//                    before WP 3.5, when White Force editors wrote their own) is purged first,
//                    after step 3 has taken their publisher affiliations, then the admin's item
//                    is published again (D21)
//   6 removals       deleted roles (R-E), destroyed rooms (R-F), deleted nodes. A deleted role's
//                    or force's `retired` record (§3 rule 1) is a document of step 5, so it is
//                    on the server before the role loses anything (ADM-39 order: record,
//                    affiliations, subscriptions, account)
//   7 game-setup     last, carrying the incremented `designVersion` (§3 rule 8)
//
// Roles are named by login name throughout (the account's localpart, §3 rule 1): the server knows
// accounts, not role GUIDs. Rooms and nodes carry GUIDs.
//
// Read-only members cannot be told from writers by affiliation (both are MUC members; the stored
// visitor role is per account and not listable). The published room and role documents say
// which members are read-only, since they are published only after access is applied. While the
// publish marker is set (a publish did not finish) they may lag, and are not trusted: read-only
// members are re-checked, and writers in the vault have their voice checked.
import { DOCUMENT_ITEM_ID, effectiveAccess } from '@wrx/domain'
import {
  NODE_PREFIXES,
  SINGLETON_NODES,
  isId,
  parseDocument,
  parseNodeName,
  slugSchema,
  withTemplateLocks,
} from '@wrx/schemas'
import type { DesignFile, Force, GameSetup, Retired, Role, Room, Template } from '@wrx/schemas'
import type { NodeConfig, RoomConfig } from '@wrx/transport'
import type { NodeAccessChange, RoomAccessChange } from '../ops.ts'
import { ROOM_SETTINGS, sameRoomConfig, targetState } from '../target.ts'
import type { NodeAccess, TargetNode } from '../target.ts'
import { roleIdOf } from './view.ts'
import type { NodeView, ServerView } from './view.ts'

export type StepGroup = 'accounts' | 'rooms' | 'nodes' | 'access' | 'documents' | 'removals'

export const STEP_GROUPS: readonly StepGroup[] = Object.freeze([
  'accounts',
  'rooms',
  'nodes',
  'access',
  'documents',
  'removals',
])

export type StepAction =
  | { readonly type: 'create-account'; readonly roleId: string; readonly readOnly: boolean }
  | { readonly type: 'reset-password'; readonly roleId: string; readonly readOnly: boolean }
  | {
      readonly type: 'ensure-room'
      readonly roomId: string
      readonly name: string
      readonly create: boolean
    }
  | {
      readonly type: 'ensure-node'
      readonly node: string
      readonly config: NodeConfig
      readonly create: boolean
    }
  | {
      readonly type: 'room-access'
      readonly roomId: string
      readonly changes: readonly RoomAccessChange[]
    }
  | { readonly type: 'read-only'; readonly roleId: string; readonly roomIds: readonly string[] }
  | {
      readonly type: 'node-access'
      readonly node: string
      readonly changes: readonly NodeAccessChange[]
    }
  | {
      readonly type: 'publish'
      readonly node: string
      readonly config: NodeConfig
      readonly itemId: string
      readonly payload: string
    }
  | {
      readonly type: 'delete-role'
      readonly roleId: string
      readonly rooms: readonly string[]
      readonly nodes: readonly string[]
    }
  | { readonly type: 'destroy-room'; readonly roomId: string; readonly messageCount: number }
  | { readonly type: 'delete-node'; readonly node: string }
  /** Every item goes; `stray` names the ones the design does not hold, for the admin. */
  | { readonly type: 'purge-node'; readonly node: string; readonly stray: readonly string[] }
  /** One item goes: a template the design no longer has, never a locked one (Annex A). */
  | { readonly type: 'retract-item'; readonly node: string; readonly itemId: string }

export interface StepRisk {
  /** It removes access, an account, a room and its history, a node, or a password. */
  readonly destructive: boolean
  /** Roles whose access, account or password the step changes (ADM-25). */
  readonly roles: readonly string[]
}

export interface PlanStep {
  /** Unique within the plan and stable across re-plans, e.g. `grant-room:blue-hq`. */
  readonly id: string
  readonly group: StepGroup
  /** One line for the UI, e.g. "Create room Blue HQ". */
  readonly summary: string
  /** Further lines, e.g. one per role whose access changes. */
  readonly details: readonly string[]
  readonly risk: StepRisk
  readonly action: StepAction
}

export type PlanWarning =
  /** ADM-14. */
  | { readonly kind: 'role-deleted'; readonly roleId: string; readonly name: string }
  /** ADM-40, R16: the archive is destroyed with the room. */
  | {
      readonly kind: 'room-destroyed'
      readonly roomId: string
      readonly name: string
      readonly messageCount: number
    }
  /** ADM-13: access is re-synced; online sessions leave rooms they lose (status 321). */
  | {
      readonly kind: 'resync'
      readonly subject: 'role' | 'room'
      readonly id: string
      readonly message: string
    }
  /** ADM-26, ADM-37: the vault has no password for a role that becomes read-only. */
  | { readonly kind: 'password-reset'; readonly roleId: string; readonly name: string }
  /**
   * The role's account exists although nothing else on the server shows the role (an earlier
   * publish that stopped, or an account made outside the tooling). It is not created and its
   * password is not changed; reset it from the credentials sheet if its players need one (F3).
   */
  | { readonly kind: 'account-exists'; readonly roleId: string; readonly name: string }

/**
 * Why the design cannot be published as it is. A plan with errors has no steps, and the executor
 * refuses it. A role's login name is its XMPP account, which the server cannot rename:
 * - `login-name-changed` (ADM-5): a published role's login name is fixed after the first
 *   publish. To change it, delete the role and add a new one.
 * - `login-name-reused` (§3 rule 1, review V3): a role of another GUID takes the login name of
 *   a published or deleted role, so the old role's messages would show as the new role's.
 */
export type PlanError =
  | {
      readonly kind: 'login-name-changed'
      /** The role's GUID. */
      readonly roleId: string
      readonly name: string
      /** The published login name. */
      readonly from: string
      /** The design's login name. */
      readonly to: string
      readonly message: string
    }
  | {
      readonly kind: 'login-name-reused'
      /** The design role's GUID. */
      readonly roleId: string
      readonly name: string
      readonly loginName: string
      /** The GUID of the published or deleted role that holds the login name. */
      readonly holderId: string
      readonly holderName: string
      readonly message: string
    }
  /**
   * `template-locked-changed` (TD6, TPL-4): the design changes the schema of a template the
   * server holds locked, which messages may already use. Copy it to a new template instead.
   * `template-locked-removed`: the design drops a locked template, whose messages would then
   * show as plain text. Keep it (take it out of the rooms instead), or reset the game.
   */
  | {
      readonly kind: 'template-locked-changed' | 'template-locked-removed'
      /** The template's GUID. */
      readonly templateId: string
      readonly name: string
      readonly message: string
    }

/**
 * Login names the design may not have (ADM-5, §3 rule 1): a published role's changed, and a
 * published or deleted role's taken by a role of another GUID. An imported design, or a draft
 * from another browser, can carry either; the editor prevents both in its own draft.
 */
export function loginNameChanges(
  design: Pick<DesignFile, 'roles'>,
  published: Pick<PublishedDesign, 'roles' | 'retired'>,
): PlanError[] {
  const errors: PlanError[] = []
  const holders = new Map<string, { id: string; name: string; deleted: boolean }>()
  for (const r of published.retired) {
    if (r.kind === 'role' && r.loginName !== undefined) {
      holders.set(r.loginName, { id: r.id, name: r.name, deleted: true })
    }
  }
  for (const r of published.roles) {
    holders.set(r.loginName, { id: r.id, name: r.name, deleted: false })
  }
  for (const role of design.roles) {
    const before = published.roles.find((r) => r.id === role.id)
    if (before !== undefined && before.loginName !== role.loginName) {
      errors.push({
        kind: 'login-name-changed',
        roleId: role.id,
        name: role.name,
        from: before.loginName,
        to: role.loginName,
        message: `${role.name}'s login name is ${before.loginName} on the server, and the design changes it to ${role.loginName}. A published role's login name is fixed (ADM-5): to change it, delete the role and add a new one with the new login name, or keep ${before.loginName}.`,
      })
      continue
    }
    const holder = holders.get(role.loginName)
    if (holder === undefined || holder.id === role.id) continue
    errors.push({
      kind: 'login-name-reused',
      roleId: role.id,
      name: role.name,
      loginName: role.loginName,
      holderId: holder.id,
      holderName: holder.name,
      message: `${role.name}'s login name ${role.loginName} belongs to ${holder.deleted ? 'the deleted role' : 'the published role'} ${holder.name}, a different role on the server, and is not given to another role (§3 rule 1). Give ${role.name} a new login name; to keep editing the published game, import an export of its published design rather than a new or converted one, or reset the game first.`,
    })
  }
  return errors
}

/** What a planning error is about: the role's or the template's GUID. */
export function planErrorTarget(error: PlanError): string {
  return 'roleId' in error ? error.roleId : error.templateId
}

/** Warnings the admin must confirm one by one before applying (ADM-14, ADM-40, ADM-26). */
export function needsConfirmation(warning: PlanWarning): boolean {
  return (
    warning.kind === 'role-deleted' ||
    warning.kind === 'room-destroyed' ||
    warning.kind === 'password-reset'
  )
}

/**
 * The key the admin confirms a warning by (the apply dialog's tick box), for the warnings that
 * need confirmation; the executor wants the same key for the step (`stepConfirmation`).
 */
export function confirmationKey(warning: PlanWarning): string | undefined {
  switch (warning.kind) {
    case 'role-deleted':
      return `role:${warning.roleId}`
    case 'room-destroyed':
      return `room:${warning.roomId}`
    case 'password-reset':
      return `password:${warning.roleId}`
    default:
      return undefined
  }
}

/**
 * The keys of every warning in `plan` that needs confirming: what the apply dialog hands the
 * executor once the admin has ticked each one (and what a test passes to confirm them all).
 */
export function planConfirmations(plan: Pick<PublishPlan, 'warnings'>): Set<string> {
  return new Set(plan.warnings.map(confirmationKey).filter((k): k is string => k !== undefined))
}

/**
 * The confirmation a step needs before the executor runs it, worked out from its action alone,
 * never from a flag the step carries (security review F9): deleting a role, destroying a room
 * and resetting a password.
 */
export function stepConfirmation(action: StepAction): string | undefined {
  switch (action.type) {
    case 'delete-role':
      return `role:${action.roleId}`
    case 'destroy-room':
      return `room:${action.roomId}`
    case 'reset-password':
      return `password:${action.roleId}`
    default:
      return undefined
  }
}

/**
 * Whether an action cannot be undone: it deletes an account, a room and its history or a node,
 * or replaces a password. Worked out from the action type, for the audit's repairs (F9).
 */
export function isDestructiveAction(action: StepAction): boolean {
  return (
    stepConfirmation(action) !== undefined ||
    action.type === 'delete-node' ||
    action.type === 'retract-item'
  )
}

export type VaultNeed =
  /** No step needs the vault. */
  | 'none'
  /** A read-only role needs one and none is stored: create it first. */
  | 'create'
  /** A vault is stored and a step needs it: unlock it first, then plan again. */
  | 'unlock'
  /** Needed and unlocked. */
  | 'ready'

export interface PublishPlan {
  readonly kind: 'publish' | 'reset'
  /** Why the design cannot be published; when any, `steps` is empty and nothing may run. */
  readonly errors: readonly PlanError[]
  readonly steps: readonly PlanStep[]
  /** The version `game-setup` gets, when the plan publishes it; else undefined. */
  readonly designVersion: number | undefined
  /** The version on the server now, if a game is published. */
  readonly publishedVersion: number | undefined
  readonly warnings: readonly PlanWarning[]
  /** Online roles some step changes (ADM-17, ADM-25), sorted. */
  readonly affectedOnline: readonly string[]
  /** Whether everyone online sees changed documents live (D23). */
  readonly documentsChange: boolean
  readonly vault: VaultNeed
  /** Rooms to destroy whose message count is not known yet: count them, then plan again. */
  readonly uncounted: readonly string[]
  /** Display names of every role the plan mentions, from the design or the server. */
  readonly roleNames: Readonly<Record<string, string>>
}

export interface PlanOptions {
  /** Archived messages per room to destroy, counted just before planning (R-F). */
  readonly messageCounts?: ReadonlyMap<string, number>
}

/** The published documents, parsed (invalid ones are ignored, NFR-5). */
export interface PublishedDesign {
  readonly game: GameSetup | undefined
  readonly forces: readonly Force[]
  readonly roles: readonly Role[]
  readonly rooms: readonly Room[]
  /** The `retired` records on the server (§3 rule 1). */
  readonly retired: readonly Retired[]
  /** The templates on the server (Annex A), with their locks. */
  readonly templates: readonly Template[]
}

function documentOf(node: NodeView | undefined, itemId = DOCUMENT_ITEM_ID): string | undefined {
  return node?.items.find((i) => i.id === itemId)?.payload
}

/** The design as the server's documents describe it. */
export function publishedDesign(view: ServerView): PublishedDesign {
  const forces: Force[] = []
  const roles: Role[] = []
  const rooms: Room[] = []
  const retired: Retired[] = []
  const templates: Template[] = []
  let game: GameSetup | undefined
  for (const node of view.nodes) {
    const ref = parseNodeName(node.node)
    if (ref?.kind === 'singleton' && ref.node === SINGLETON_NODES.retired) {
      for (const item of node.items) {
        const parsed = parseDocument('retired', item.payload)
        if (parsed.ok && parsed.value.id === item.id) retired.push(parsed.value)
      }
      continue
    }
    if (ref?.kind === 'singleton' && ref.node === SINGLETON_NODES.templates) {
      for (const item of node.items) {
        const parsed = parseDocument('template', item.payload)
        if (parsed.ok && parsed.value.id === item.id) templates.push(parsed.value)
      }
      continue
    }
    const payload = documentOf(node)
    if (ref === undefined || payload === undefined) continue
    if (ref.kind === 'singleton' && ref.node === SINGLETON_NODES.gameSetup) {
      const parsed = parseDocument('game-setup', payload)
      if (parsed.ok) game = parsed.value
    } else if (ref.kind === 'forces') {
      const parsed = parseDocument('force', payload)
      if (parsed.ok && parsed.value.id === ref.id) forces.push(parsed.value)
    } else if (ref.kind === 'roles') {
      const parsed = parseDocument('role', payload)
      if (parsed.ok && parsed.value.id === ref.id) roles.push(parsed.value)
    } else if (ref.kind === 'rooms') {
      const parsed = parseDocument('room', payload)
      if (parsed.ok && parsed.value.id === ref.id) rooms.push(parsed.value)
    }
  }
  return { game, forces, roles, rooms, retired, templates }
}

/**
 * Template changes the design may not make (TD6, TPL-4, provisional answer 2): a template the
 * server holds locked keeps its schema, and stays in the design. Locks come from the server,
 * since a lock set by another browser's publish is not in this draft.
 */
export function templateLockErrors(
  design: Pick<DesignFile, 'templates'>,
  published: Pick<PublishedDesign, 'templates'>,
): PlanError[] {
  const errors: PlanError[] = []
  for (const before of published.templates) {
    if (before.lockedAt === undefined) continue
    const now = design.templates.find((t) => t.id === before.id)
    if (now === undefined) {
      errors.push({
        kind: 'template-locked-removed',
        templateId: before.id,
        name: before.name,
        message: `The template ${before.name} is locked: a published room has offered it, so messages may use it, and the design removes it. Keep it, and take it out of the rooms instead, so old messages still show as cards (TD6); or reset the game.`,
      })
    } else if (canonicalJson(now.schema) !== canonicalJson(before.schema)) {
      errors.push({
        kind: 'template-locked-changed',
        templateId: before.id,
        name: now.name,
        message: `The template ${before.name} is locked: a published room has offered it, so messages may use it, and the design changes its fields. Copy it to a new template and change the copy, then offer the copy in its rooms (TD6, TPL-4).`,
      })
    }
  }
  return errors
}

/** JSON with object keys sorted, so equal documents compare equal however they were written. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]))
  }
  return value
}

function samePayload(a: string, b: string | undefined): boolean {
  if (b === undefined) return false
  try {
    return canonicalJson(JSON.parse(a)) === canonicalJson(JSON.parse(b))
  } catch {
    return false
  }
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

function nodeAccessOf(affiliation: string): NodeAccess {
  if (affiliation === 'publisher') return 'publish'
  if (affiliation === 'member') return 'read'
  return 'none'
}

/** Rooms on the server: every room on the MUC service is a game room (one game per server, D11). */
function serverRoomIds(view: ServerView): string[] {
  return view.rooms.map((r) => r.roomId).filter((id) => slugSchema.safeParse(id).success)
}

/**
 * Login names the server knows of: role documents, room and node affiliations, and the vault.
 * A role node from before GUID ids (`roles:blue-co`) names its login, so a reset finds it.
 */
export function knownRoles(view: ServerView): string[] {
  const known = new Set<string>()
  const published = publishedDesign(view)
  for (const role of published.roles) known.add(role.loginName)
  for (const node of view.nodes) {
    const legacy = legacyRoleNode(node.node)
    if (legacy !== undefined) known.add(legacy)
    for (const a of node.affiliations) {
      const id = roleIdOf(a.jid, view.domain)
      if (id !== undefined && a.affiliation !== 'none') known.add(id)
    }
    // Open nodes are subscribed to by anonymous sessions too; those are not accounts.
    if (node.config.accessModel === 'open') continue
    for (const s of node.subscriptions) {
      const id = roleIdOf(s.jid, view.domain)
      if (id !== undefined && s.subscription !== 'none') known.add(id)
    }
  }
  for (const room of view.rooms) {
    for (const a of room.affiliations) {
      const id = roleIdOf(a.jid, view.domain)
      if (id !== undefined) known.add(id)
    }
  }
  for (const id of view.vault.roles ?? []) known.add(id)
  return [...known].sort()
}

/** The login name in a role node from before GUID ids, `roles:<login>`; else undefined. */
function legacyRoleNode(node: string): string | undefined {
  const prefix = `${NODE_PREFIXES[1]}:`
  if (!node.startsWith(prefix)) return undefined
  const id = node.slice(prefix.length)
  return !isId(id) && slugSchema.safeParse(id).success ? id : undefined
}

/**
 * The design, with a `retired` record (§3 rule 1) for each published force and role it no
 * longer has and does not already record, nor the server: the planner's safety net when a draft
 * deleted a published entity without recording it (an import, another browser). Named as it was
 * published; stamped with the design's export time, so planning stays free of a clock.
 */
export function withRetiredRecords(design: DesignFile, published: PublishedDesign): DesignFile {
  const has = new Set([
    ...design.forces.map((f) => f.id),
    ...design.roles.map((r) => r.id),
    ...design.retired.map((r) => r.id),
    ...published.retired.map((r) => r.id),
  ])
  const colourOf = (forceId: string) =>
    design.forces.find((f) => f.id === forceId)?.colour ??
    published.forces.find((f) => f.id === forceId)?.colour
  const added: Retired[] = []
  for (const role of published.roles) {
    if (has.has(role.id)) continue
    const colour = colourOf(role.forceId)
    added.push({
      schemaVersion: 1,
      id: role.id,
      kind: 'role',
      name: role.name,
      loginName: role.loginName,
      ...(colour === undefined ? {} : { colour }),
      deletedAt: design.exportedAt,
    })
  }
  for (const force of published.forces) {
    if (has.has(force.id)) continue
    added.push({
      schemaVersion: 1,
      id: force.id,
      kind: 'force',
      name: force.name,
      colour: force.colour,
      deletedAt: design.exportedAt,
    })
  }
  return added.length === 0 ? design : { ...design, retired: [...design.retired, ...added] }
}

/**
 * A node as the admin reads it: entity ids are GUIDs (§3 rule 1), so the entity's name is
 * added, from the design or the server's documents, e.g. `objectives:… (Red)`.
 */
export function nodeLabeller(
  design: Pick<DesignFile, 'forces' | 'roles' | 'rooms'>,
  published: Pick<PublishedDesign, 'forces' | 'roles' | 'rooms'>,
): (node: string) => string {
  const names = new Map<string, string>()
  for (const list of [
    published.forces,
    published.roles,
    published.rooms,
    design.forces,
    design.roles,
    design.rooms,
  ]) {
    for (const entity of list) names.set(entity.id, entity.name)
  }
  return (node) => {
    const ref = parseNodeName(node)
    if (ref === undefined || ref.kind === 'singleton') return node
    const name = names.get(ref.id)
    return name === undefined ? node : `${ref.kind}: ${name}`
  }
}

/** The rooms and nodes where the server shows a role's access, for `deleteRole`'s scope. */
function scopeOf(view: ServerView, roleId: string): { rooms: string[]; nodes: string[] } {
  const rooms = view.rooms
    .filter((r) => r.affiliations.some((a) => roleIdOf(a.jid, view.domain) === roleId))
    .map((r) => r.roomId)
  const nodes = view.nodes
    .filter(
      (n) =>
        n.affiliations.some(
          (a) => a.affiliation !== 'none' && roleIdOf(a.jid, view.domain) === roleId,
        ) ||
        n.subscriptions.some(
          (s) => s.subscription !== 'none' && roleIdOf(s.jid, view.domain) === roleId,
        ),
    )
    .map((n) => n.node)
  return { rooms, nodes }
}

// Templates before rooms, so a client that reads a room's config finds the templates it names.
const DOCUMENT_ORDER = ['assets', 'forces', 'roles', 'templates', 'rooms', 'objectives'] as const

function documentRank(node: string): number {
  const ref = parseNodeName(node)
  if (ref?.kind === 'singleton' && ref.node === SINGLETON_NODES.templates) {
    return DOCUMENT_ORDER.indexOf('templates')
  }
  if (ref === undefined || ref.kind === 'singleton') return DOCUMENT_ORDER.length
  return DOCUMENT_ORDER.indexOf(ref.kind)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Plans a publish of `design` onto the server `view` describes. */
export function planPublish(
  given: DesignFile,
  view: ServerView,
  options: PlanOptions = {},
): PublishPlan {
  const published = publishedDesign(view)
  const publishedVersion = published.game?.designVersion
  // ADM-5: a changed login name of a published role is refused, never planned as a new account
  // and a deleted one (the server cannot rename an account); so is a published or deleted role's
  // login name taken by a role of another GUID (§3 rule 1).
  // TD6: a locked template keeps its schema and stays (provisional answer 2).
  const errors = [...loginNameChanges(given, published), ...templateLockErrors(given, published)]
  if (errors.length > 0) {
    return {
      kind: 'publish',
      errors,
      steps: [],
      designVersion: undefined,
      publishedVersion,
      warnings: [],
      affectedOnline: [],
      documentsChange: false,
      vault: 'none',
      uncounted: [],
      roleNames: {},
    }
  }
  // A publish locks every template a room offers (TD6): the server's locks are kept, and the
  // design's export time stamps new ones (planning keeps no clock).
  const design = withTemplateLocks(withRetiredRecords(given, published), published.templates)
  const target = targetState(design)
  const marker = view.marker
  const pending =
    marker !== undefined &&
    (publishedVersion === undefined || marker.designVersion > publishedVersion)
  const trustDocuments = !pending

  const roleName = (login: string) =>
    design.roles.find((r) => r.loginName === login)?.name ??
    published.roles.find((r) => r.loginName === login)?.name ??
    login
  const roomName = (id: string) =>
    design.rooms.find((r) => r.id === id)?.name ??
    published.rooms.find((r) => r.id === id)?.name ??
    id
  const label = nodeLabeller(design, published)
  const vaultHas = (id: string) => view.vault.roles?.includes(id) ?? false
  const vaultLocked = view.vault.exists && view.vault.roles === undefined

  const publishedAccess = trustDocuments
    ? effectiveAccess({
        forces: published.forces,
        roles: published.roles,
        rooms: published.rooms,
      })
    : undefined
  const publishedIds = new Map(published.roles.map((r) => [r.loginName, r.id]))
  const knownAccess = (roomId: string, login: string): 'write' | 'read' | undefined => {
    const roleId = publishedIds.get(login)
    const cell = roleId === undefined ? undefined : publishedAccess?.cells.get(roomId)?.get(roleId)
    return cell === undefined || cell.access === 'none' ? undefined : cell.access
  }

  const serverRooms = new Map(view.rooms.map((r) => [r.roomId, r]))
  const serverNodes = new Map(view.nodes.map((n) => [n.node, n]))
  const known = new Set(knownRoles(view))
  const registered = new Set(
    view.registered
      .map((j) => roleIdOf(j, view.domain))
      .filter((id): id is string => id !== undefined),
  )
  const targetRoles = new Set(target.roles)
  const readOnlyRoles = new Set(target.readOnlyRoles)

  const accounts: PlanStep[] = []
  const rooms: PlanStep[] = []
  const nodes: PlanStep[] = []
  const grants: PlanStep[] = []
  const revokes: PlanStep[] = []
  const documents: PlanStep[] = []
  const removals: PlanStep[] = []
  const warnings: PlanWarning[] = []
  let vaultUsed = false

  // ---- accounts ------------------------------------------------------------------------------
  // Only an account the server does not list is created. An existing one keeps its password: a
  // reset is its own destructive, confirmed step (below, or the credentials sheet), never a side
  // effect of a create (F3).
  const created = new Set<string>()
  for (const roleId of target.roles) {
    if (registered.has(roleId)) {
      if (!known.has(roleId)) {
        warnings.push({ kind: 'account-exists', roleId, name: roleName(roleId) })
      }
      continue
    }
    const readOnly = readOnlyRoles.has(roleId)
    if (readOnly || view.vault.exists) vaultUsed = true
    created.add(roleId)
    accounts.push({
      id: `account:${roleId}`,
      group: 'accounts',
      summary: `Create the account for ${roleName(roleId)} (${roleId})`,
      details: readOnly ? ['Read-only somewhere: its password goes into the vault'] : [],
      risk: { destructive: false, roles: [] },
      action: { type: 'create-account', roleId, readOnly },
    })
  }

  // ---- rooms ---------------------------------------------------------------------------------
  for (const room of target.rooms) {
    const current = serverRooms.get(room.roomId)
    if (current !== undefined && sameRoomConfig(current.config, room.config)) continue
    rooms.push({
      id: `room:${room.roomId}`,
      group: 'rooms',
      summary:
        current === undefined
          ? `Create room ${room.config.name}`
          : `Configure room ${room.config.name}`,
      details: current === undefined ? [] : roomConfigDiff(current.config, room.config),
      risk: { destructive: false, roles: [] },
      action: {
        type: 'ensure-room',
        roomId: room.roomId,
        name: room.config.name,
        create: current === undefined,
      },
    })
  }

  // ---- nodes ---------------------------------------------------------------------------------
  for (const node of target.nodes) {
    const current = serverNodes.get(node.node)
    if (current !== undefined && sameNodeConfig(current.config, node.config)) continue
    nodes.push({
      id: `node:${node.node}`,
      group: 'nodes',
      summary:
        current === undefined
          ? `Create node ${label(node.node)}`
          : `Configure node ${label(node.node)}`,
      details:
        current === undefined
          ? [`${node.config.accessModel}, keeps ${plural(node.config.maxItems, 'item')}`]
          : nodeConfigDiff(current.config, node.config),
      risk: { destructive: false, roles: [] },
      action: {
        type: 'ensure-node',
        node: node.node,
        config: node.config,
        create: current === undefined,
      },
    })
  }

  // ---- room access ---------------------------------------------------------------------------
  const readOnlyGrants = new Map<string, string[]>()
  const readOnlyConverts = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, roleId: string, roomId: string) => {
    map.set(roleId, [...(map.get(roleId) ?? []), roomId])
  }
  for (const room of target.rooms) {
    const members = new Set(
      (serverRooms.get(room.roomId)?.affiliations ?? [])
        .filter((a) => a.affiliation === 'member')
        .map((a) => roleIdOf(a.jid, view.domain))
        .filter((id): id is string => id !== undefined),
    )
    const grantChanges: RoomAccessChange[] = []
    const revokeChanges: RoomAccessChange[] = []
    for (const roleId of target.roles) {
      const desired = room.access.get(roleId) ?? 'none'
      const member = members.has(roleId)
      const before = knownAccess(room.roomId, roleId)
      if (desired === 'none') {
        if (member) revokeChanges.push({ roleId, access: 'none', from: before ?? 'write' })
      } else if (desired === 'write') {
        if (!member) grantChanges.push({ roleId, access: 'write', from: 'none' })
        else if (before === 'read' || (before === undefined && vaultHas(roleId))) {
          // The stored visitor role is cleared (R-B), through the role's login when the vault
          // has its password; otherwise by re-granting the membership.
          grantChanges.push({ roleId, access: 'write', from: 'read' })
          if (vaultHas(roleId)) vaultUsed = true
        }
      } else if (!member) {
        push(readOnlyGrants, roleId, room.roomId)
      } else if (before !== 'read') {
        push(readOnlyConverts, roleId, room.roomId)
      }
    }
    if (grantChanges.length > 0) {
      grants.push({
        id: `grant-room:${room.roomId}`,
        group: 'access',
        summary: `Give write access to ${room.config.name}`,
        details: grantChanges.map((c) =>
          c.from === 'read'
            ? `${roleName(c.roleId)}: voice restored (read to write)`
            : `${roleName(c.roleId)}: becomes a member with voice`,
        ),
        risk: { destructive: false, roles: grantChanges.map((c) => c.roleId) },
        action: { type: 'room-access', roomId: room.roomId, changes: grantChanges },
      })
    }
    if (revokeChanges.length > 0) {
      revokes.push({
        id: `revoke-room:${room.roomId}`,
        group: 'access',
        summary: `Remove access to ${room.config.name}`,
        details: revokeChanges.map((c) => `${roleName(c.roleId)}: membership removed`),
        risk: { destructive: true, roles: revokeChanges.map((c) => c.roleId) },
        action: { type: 'room-access', roomId: room.roomId, changes: revokeChanges },
      })
    }
  }

  const needsPassword = new Set<string>()
  const readOnlyStep = (roleId: string, roomIds: string[], phase: 'grant' | 'revoke'): PlanStep => {
    vaultUsed = true
    if (!created.has(roleId) && view.vault.roles !== undefined && !vaultHas(roleId)) {
      needsPassword.add(roleId)
    }
    const names = roomIds.map(roomName).join(', ')
    return {
      id: `read-only-${phase}:${roleId}`,
      group: 'access',
      summary:
        phase === 'grant'
          ? `Give ${roleName(roleId)} read-only access to ${names}`
          : `Make ${roleName(roleId)} read-only in ${names}`,
      details: [
        ...(phase === 'revoke'
          ? [
              'Its membership is taken away first, so it cannot post if a later step fails; its online sessions leave these rooms',
            ]
          : []),
        'Membership and voice revocation run back to back, through the role’s own login (ADM-37)',
      ],
      risk: { destructive: phase === 'revoke', roles: [roleId] },
      action: { type: 'read-only', roleId, roomIds },
    }
  }
  for (const [roleId, roomIds] of readOnlyGrants)
    grants.push(readOnlyStep(roleId, roomIds, 'grant'))
  // Voice is revoked before memberships elsewhere are removed: both are revokes (R-D).
  const converts = [...readOnlyConverts].map(([roleId, roomIds]) =>
    readOnlyStep(roleId, roomIds, 'revoke'),
  )
  revokes.unshift(...converts)

  // ---- node access ---------------------------------------------------------------------------
  for (const node of target.nodes) {
    // Open nodes (game-setup, the game theme's assets) need no affiliations: anyone reads them.
    if (node.config.accessModel === 'open') continue
    const current = serverNodes.get(node.node)
    const affiliation = new Map<string, NodeAccess>()
    const subscribed = new Set<string>()
    for (const a of current?.affiliations ?? []) {
      const id = roleIdOf(a.jid, view.domain)
      if (id !== undefined) affiliation.set(id, nodeAccessOf(a.affiliation))
    }
    for (const s of current?.subscriptions ?? []) {
      const id = roleIdOf(s.jid, view.domain)
      if (id !== undefined && s.subscription !== 'none') subscribed.add(id)
    }
    const grantChanges: NodeAccessChange[] = []
    const revokeChanges: NodeAccessChange[] = []
    for (const roleId of target.roles) {
      const desired = node.access.get(roleId) ?? 'none'
      const now = affiliation.get(roleId) ?? 'none'
      if (desired !== 'none' && now !== desired) grantChanges.push({ roleId, access: desired })
      if (desired === 'none' && (now !== 'none' || subscribed.has(roleId))) {
        revokeChanges.push({ roleId, access: 'none' })
      }
    }
    if (grantChanges.length > 0) {
      grants.push({
        id: `grant-node:${node.node}`,
        group: 'access',
        summary: `Give access to node ${label(node.node)}`,
        details: grantChanges.map(
          (c) => `${roleName(c.roleId)}: ${c.access === 'publish' ? 'publish and read' : 'read'}`,
        ),
        risk: { destructive: false, roles: grantChanges.map((c) => c.roleId) },
        action: { type: 'node-access', node: node.node, changes: grantChanges },
      })
    }
    if (revokeChanges.length > 0) {
      revokes.push({
        id: `revoke-node:${node.node}`,
        group: 'access',
        summary: `Remove access to node ${label(node.node)}`,
        details: revokeChanges.map(
          (c) => `${roleName(c.roleId)}: affiliation and every subscription removed (R-A)`,
        ),
        risk: { destructive: true, roles: revokeChanges.map((c) => c.roleId) },
        action: { type: 'node-access', node: node.node, changes: revokeChanges },
      })
    }
  }

  // Password resets the vault needs for an existing role that becomes read-only (ADM-26).
  for (const roleId of [...needsPassword].sort()) {
    accounts.push({
      id: `password:${roleId}`,
      group: 'accounts',
      summary: `Reset the password of ${roleName(roleId)} and keep it in the vault`,
      details: [
        'The vault has no password for this role, which must become read-only (ADM-37)',
        'Sessions stay logged in; the next login needs the new password (PLY-31)',
      ],
      risk: { destructive: true, roles: [roleId] },
      action: { type: 'reset-password', roleId, readOnly: true },
    })
    warnings.push({ kind: 'password-reset', roleId, name: roleName(roleId) })
  }

  // ---- documents -----------------------------------------------------------------------------
  const gameNode = target.nodes.find((n) => n.node === SINGLETON_NODES.gameSetup)
  for (const node of [...target.nodes].sort(
    (a, b) => documentRank(a.node) - documentRank(b.node),
  )) {
    if (node.node === SINGLETON_NODES.gameSetup) continue
    const current = serverNodes.get(node.node)
    const purge = purgeStep(node, current, label(node.node))
    if (purge !== undefined) documents.push(purge)
    for (const doc of node.documents) {
      if (purge === undefined && samePayload(doc.payload, documentOf(current, doc.itemId))) continue
      documents.push(
        documentStep(node, doc.itemId, doc.payload, label(node.node), { design, published }),
      )
    }
  }

  // ---- removals ------------------------------------------------------------------------------
  const counts = options.messageCounts ?? new Map<string, number>()
  const uncounted: string[] = []
  const targetRoomIds = new Set(target.rooms.map((r) => r.roomId))
  const targetNodes = new Set(target.nodes.map((n) => n.node))
  // Templates the design no longer has: never locked ones, which `templateLockErrors` refused.
  // After the rooms' documents, which no longer offer them.
  const templateNode = target.nodes.find((n) => n.node === SINGLETON_NODES.templates)
  if (templateNode !== undefined) {
    const wanted = new Set(templateNode.documents.map((d) => d.itemId))
    for (const item of serverNodes.get(SINGLETON_NODES.templates)?.items ?? []) {
      if (wanted.has(item.id)) continue
      removals.push(retractStep(SINGLETON_NODES.templates, item.id, templateName(published, item)))
    }
  }
  for (const roleId of [...known].filter((id) => !targetRoles.has(id)).sort()) {
    if (view.vault.exists) vaultUsed = true
    removals.push(deleteRoleStep(view, roleId, roleName(roleId)))
    warnings.push({ kind: 'role-deleted', roleId, name: roleName(roleId) })
  }
  for (const roomId of serverRoomIds(view)
    .filter((id) => !targetRoomIds.has(id))
    .sort()) {
    const step = destroyRoomStep(view, roomId, roomName(roomId), counts.get(roomId))
    if (step.uncounted) uncounted.push(roomId)
    removals.push(step.step)
    warnings.push({
      kind: 'room-destroyed',
      roomId,
      name: roomName(roomId),
      messageCount: counts.get(roomId) ?? 0,
    })
  }
  for (const node of view.nodes
    .map((n) => n.node)
    .filter((n) => !targetNodes.has(n))
    .sort()) {
    removals.push(deleteNodeStep(node, label(node)))
  }

  // ---- resync warnings (ADM-13) --------------------------------------------------------------
  for (const role of design.roles) {
    const before = published.roles.find((r) => r.id === role.id)
    if (before === undefined) continue
    // A changed login name never gets here: `loginNameChanges` refused the design (ADM-5).
    if (before.forceId !== role.forceId) {
      const from = published.forces.find((f) => f.id === before.forceId)?.name ?? before.forceId
      const to = design.forces.find((f) => f.id === role.forceId)?.name ?? role.forceId
      warnings.push({
        kind: 'resync',
        subject: 'role',
        id: role.id,
        message: `${role.name} moves from ${from} to ${to}: its room and node access is re-synced, new access first`,
      })
    }
    if (before.isObserver !== role.isObserver) {
      warnings.push({
        kind: 'resync',
        subject: 'role',
        id: role.id,
        message: role.isObserver
          ? `${role.name} becomes an observer: read-only in every room`
          : `${role.name} is no longer an observer: voice is restored where it has write access`,
      })
    }
  }
  for (const room of design.rooms) {
    const before = published.rooms.find((r) => r.id === room.id)
    if (before === undefined) continue
    if (canonicalJson(before.participants) !== canonicalJson(room.participants)) {
      warnings.push({
        kind: 'resync',
        subject: 'room',
        id: room.id,
        message: `${room.name}: participants change, so its memberships and voice are re-synced`,
      })
    }
  }

  // ---- game-setup and the design version (§3 rule 8) ----------------------------------------
  const changes = [
    ...accounts,
    ...rooms,
    ...nodes,
    ...grants,
    ...revokes,
    ...documents,
    ...removals,
  ]
  const gamePayload = (version: number) =>
    JSON.stringify({ ...design.game, designVersion: version })
  const gameChanged =
    published.game === undefined ||
    canonicalJson({ ...published.game, designVersion: 0 }) !==
      canonicalJson({ ...design.game, designVersion: 0 })
  let designVersion: number | undefined
  if (changes.length > 0 || gameChanged || pending) {
    const next = pending
      ? marker.designVersion
      : publishedVersion === undefined
        ? design.game.designVersion
        : publishedVersion + 1
    designVersion = Math.max(next, (publishedVersion ?? 0) + 1)
    if (gameNode !== undefined) {
      changes.push({
        ...documentStep(gameNode, DOCUMENT_ITEM_ID, gamePayload(designVersion), gameNode.node),
        summary: `Publish the game setup, design version ${designVersion}`,
      })
    }
  }

  const affected = new Set(changes.flatMap((s) => s.risk.roles))
  return {
    kind: 'publish',
    errors: [],
    steps: changes,
    designVersion,
    publishedVersion,
    warnings,
    affectedOnline: view.online.filter((id) => affected.has(id)),
    documentsChange: changes.some((s) => s.action.type === 'publish'),
    vault: !vaultUsed ? 'none' : !view.vault.exists ? 'create' : vaultLocked ? 'unlock' : 'ready',
    uncounted,
    roleNames: Object.fromEntries(
      [...new Set([...target.roles, ...known])].map((id) => [id, roleName(id)]),
    ),
  }
}

/** A template item's name, from the server's document, else its id. */
function templateName(published: Pick<PublishedDesign, 'templates'>, item: { id: string }): string {
  return published.templates.find((t) => t.id === item.id)?.name ?? item.id
}

function documentStep(
  node: TargetNode,
  itemId: string,
  payload: string,
  label: string,
  context?: { readonly design: DesignFile; readonly published: PublishedDesign },
): PlanStep {
  const ref = parseNodeName(node.node)
  const isTemplates = ref?.kind === 'singleton' && ref.node === SINGLETON_NODES.templates
  const template = isTemplates ? context?.design.templates.find((t) => t.id === itemId) : undefined
  const before = isTemplates ? context?.published.templates.find((t) => t.id === itemId) : undefined
  const what =
    ref?.kind === 'objectives'
      ? `the admin's item on ${label}`
      : ref?.kind === 'singleton' && ref.node === SINGLETON_NODES.retired
        ? `the record of a deleted force or role on ${label}`
        : template !== undefined
          ? `the template ${template.name}`
          : label
  const details =
    template?.lockedAt !== undefined && before?.lockedAt === undefined
      ? ['A room offers it, so it locks: its fields are fixed from now on (TD6)']
      : []
  return {
    id: `doc:${node.node}:${itemId}`,
    group: 'documents',
    summary: `Publish ${what}`,
    details,
    risk: { destructive: false, roles: [] },
    action: { type: 'publish', node: node.node, config: node.config, itemId, payload },
  }
}

/**
 * §3 rule 14, D21: an objectives node holds the admin's item only. Items the design does not
 * hold (White Force editors' items from before WP 3.5, or text removed from the draft) are
 * purged: every item goes, and the planner publishes the design's again right after. Other
 * nodes keep their items: documents are replaced in place, announcements are history.
 */
function purgeStep(
  node: TargetNode,
  current: NodeView | undefined,
  label: string,
): PlanStep | undefined {
  if (current === undefined || parseNodeName(node.node)?.kind !== 'objectives') return undefined
  const wanted = new Set(node.documents.map((d) => d.itemId))
  const stray = current.items.map((i) => i.id).filter((id) => !wanted.has(id))
  if (stray.length === 0) return undefined
  return {
    id: `purge:${node.node}`,
    group: 'documents',
    summary: `Remove every item from ${label} but the admin's objectives`,
    details: [
      `${plural(stray.length, 'item')} the design does not hold: ${stray.join(', ')}`,
      'Only the admin publishes objectives (D21); the admin’s item is published again next',
    ],
    risk: { destructive: true, roles: [] },
    action: { type: 'purge-node', node: node.node, stray },
  }
}

function retractStep(node: string, itemId: string, name: string): PlanStep {
  return {
    id: `retract:${node}:${itemId}`,
    group: 'removals',
    summary: `Remove the template ${name}`,
    details: ['The design no longer has it, and no published room has offered it'],
    risk: { destructive: true, roles: [] },
    action: { type: 'retract-item', node, itemId },
  }
}

function deleteRoleStep(view: ServerView, roleId: string, name: string): PlanStep {
  const scope = scopeOf(view, roleId)
  return {
    id: `delete-role:${roleId}`,
    group: 'removals',
    summary: `Delete role ${name} (${roleId}) and its account`,
    details: [
      `Access removed from ${plural(scope.rooms.length, 'room')} and ${plural(scope.nodes.length, 'node')} first (R-E)`,
      'Its message history stays attributed to the old login (ADM-14)',
    ],
    risk: { destructive: true, roles: [roleId] },
    action: { type: 'delete-role', roleId, rooms: scope.rooms, nodes: scope.nodes },
  }
}

function destroyRoomStep(
  view: ServerView,
  roomId: string,
  name: string,
  count: number | undefined,
): { step: PlanStep; uncounted: boolean } {
  const members = (view.rooms.find((r) => r.roomId === roomId)?.affiliations ?? [])
    .map((a) => roleIdOf(a.jid, view.domain))
    .filter((id): id is string => id !== undefined)
  return {
    uncounted: count === undefined,
    step: {
      id: `destroy-room:${roomId}`,
      group: 'removals',
      summary: `Destroy room ${name} and its history`,
      details: [
        count === undefined
          ? 'Its messages are not counted yet'
          : `${plural(count, 'archived message')} deleted for good (R-F)`,
      ],
      risk: { destructive: true, roles: members },
      action: { type: 'destroy-room', roomId, messageCount: count ?? 0 },
    },
  }
}

function deleteNodeStep(node: string, label: string = node): PlanStep {
  return {
    id: `delete-node:${node}`,
    group: 'removals',
    summary: `Delete node ${label}`,
    details: [],
    risk: { destructive: true, roles: [] },
    action: { type: 'delete-node', node },
  }
}

function roomConfigDiff(a: RoomConfig, b: RoomConfig): string[] {
  const out: string[] = []
  if (a.name !== b.name) out.push(`name: ${a.name} → ${b.name}`)
  if ((a.description ?? '') !== (b.description ?? '')) out.push('description changes')
  for (const key of ROOM_SETTINGS) {
    if (a[key] !== b[key]) out.push(`${key}: ${String(a[key])} → ${String(b[key])}`)
  }
  return out
}

function nodeConfigDiff(a: NodeConfig, b: NodeConfig): string[] {
  const out: string[] = []
  for (const key of ['accessModel', 'publishModel', 'maxItems', 'notifyRetract'] as const) {
    if (a[key] !== b[key]) out.push(`${key}: ${String(a[key])} → ${String(b[key])}`)
  }
  if ((a.title ?? '') !== (b.title ?? '')) out.push('title changes')
  return out
}

/** Plans a game reset (ADM-15): every role account, room and WRX1 node on the server goes. */
export function planReset(view: ServerView, options: PlanOptions = {}): PublishPlan {
  const published = publishedDesign(view)
  const name = (login: string) => published.roles.find((r) => r.loginName === login)?.name ?? login
  const roomName = (id: string) => published.rooms.find((r) => r.id === id)?.name ?? id
  const counts = options.messageCounts ?? new Map<string, number>()
  const steps: PlanStep[] = []
  const warnings: PlanWarning[] = []
  const uncounted: string[] = []
  const roles = knownRoles(view)
  for (const roleId of roles) {
    steps.push(deleteRoleStep(view, roleId, name(roleId)))
    warnings.push({ kind: 'role-deleted', roleId, name: name(roleId) })
  }
  for (const roomId of serverRoomIds(view).sort()) {
    const step = destroyRoomStep(view, roomId, roomName(roomId), counts.get(roomId))
    if (step.uncounted) uncounted.push(roomId)
    steps.push(step.step)
    warnings.push({
      kind: 'room-destroyed',
      roomId,
      name: roomName(roomId),
      messageCount: counts.get(roomId) ?? 0,
    })
  }
  // game-setup last, so the welcome page goes only when everything else has.
  const nodes = view.nodes
    .map((n) => n.node)
    .sort((a, b) =>
      a === SINGLETON_NODES.gameSetup ? 1 : b === SINGLETON_NODES.gameSetup ? -1 : a < b ? -1 : 1,
    )
  const label = nodeLabeller({ forces: [], roles: [], rooms: [] }, published)
  for (const node of nodes) steps.push(deleteNodeStep(node, label(node)))
  const affected = new Set(steps.flatMap((s) => s.risk.roles))
  return {
    kind: 'reset',
    errors: [],
    steps,
    designVersion: undefined,
    publishedVersion: published.game?.designVersion,
    warnings,
    affectedOnline: view.online.filter((id) => affected.has(id)),
    documentsChange: false,
    vault:
      roles.length > 0 && view.vault.exists
        ? view.vault.roles === undefined
          ? 'unlock'
          : 'ready'
        : 'none',
    uncounted,
    roleNames: Object.fromEntries(roles.map((id) => [id, name(id)])),
  }
}

/** Rooms either plan would destroy, for counting their messages before the final plan. */
export function roomsToDestroy(plan: PublishPlan): string[] {
  return plan.steps.flatMap((s) => (s.action.type === 'destroy-room' ? [s.action.roomId] : []))
}
