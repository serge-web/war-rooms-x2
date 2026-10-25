// The audit's comparison (WP 2.10, ADM-41): the server as read (the publish planner's
// `ServerView`, the registered accounts, the voice readings) against `targetState(design)`.
// Pure: no server, no clock. Where the publish planner already diffs something, the audit takes
// its steps and splits them into one item per role, so the two can never disagree about what
// "matches" means:
//
// - from `planPublish`: room and node configs, missing rooms and nodes, room memberships the
//   design gives or takes away, node affiliations and subscriptions of design roles, documents,
//   and rooms, nodes and roles that are not in the design;
// - the audit's own: what the planner cannot see or leaves alone. Accounts (from XEP-0133
//   registered users, where the planner infers roles from affiliations), stored MUC roles (read
//   through the role's own login, since the planner trusts the published documents), room
//   affiliations other than `member`, node affiliations that grant nothing the planner models
//   (`owner`, `publish-only`), JIDs that are no role account, and `game-setup` without its version.
import { DOCUMENT_ITEM_ID } from '@wrx/domain'
import { RESERVED_ROLE_IDS, SINGLETON_NODES, parseNodeName } from '@wrx/schemas'
import type { DesignFile } from '@wrx/schemas'
import type { MucRole, NodeConfig, RoomConfig } from '@wrx/transport'
import { bareJid, domainpart, localpart } from '@wrx/domain'
import { canonicalJson, planPublish, publishedDesign } from '../publish/plan.ts'
import type { PlanStep, StepAction } from '../publish/plan.ts'
import { roleIdOf } from '../publish/view.ts'
import type { ServerView } from '../publish/view.ts'
import { targetState } from '../target.ts'
import { AUDIT_SEVERITIES } from './types.ts'
import type { AuditItem, AuditKind, AuditReport, AuditSeverity, AuditVaultState } from './types.ts'

/** A stored-role check: the role's own login joins the room (ADM-37, WP 0.1). */
export interface VoiceCheck {
  readonly roleId: string
  readonly roomId: string
  /** Read-only roles must join as `visitor`; writers must not. */
  readonly expect: 'visitor' | 'voice'
}

export type VoiceProblem =
  /** No vault is stored, so no read-only role's password is known. */
  | 'vault-missing'
  /** The vault is stored but locked here. */
  | 'vault-locked'
  /** The vault has no password for the role. */
  | 'no-password'
  /** Logging in with the vault's password failed. */
  | 'login-failed'
  /** AdminOps was given no transport to log in with. */
  | 'no-login'
  /** The role's session could not join the room. */
  | 'join-refused'

export interface VoiceReading extends VoiceCheck {
  /** The role the server gave the role's session on joining. */
  readonly role?: MucRole
  /** Why there is no role. */
  readonly problem?: VoiceProblem
  readonly detail?: string
}

export interface AuditInput {
  readonly view: ServerView
  /** XEP-0133 registered users, bare JIDs. */
  readonly registered: readonly string[]
  readonly voice: readonly VoiceReading[]
  /** Archived messages in each room the audit would destroy (R-F, ADM-40). */
  readonly messageCounts: ReadonlyMap<string, number>
}

export interface VoicePlan {
  readonly checks: readonly VoiceCheck[]
  /** Writer memberships not checked: the vault has no password for them, or is locked. */
  readonly writersSkipped: readonly { readonly roleId: string; readonly roomId: string }[]
}

function membersOf(view: ServerView, roomId: string): Set<string> {
  const room = view.rooms.find((r) => r.roomId === roomId)
  const ids = new Set<string>()
  for (const a of room?.affiliations ?? []) {
    const id = roleIdOf(a.jid, view.domain)
    if (id !== undefined && a.affiliation === 'member') ids.add(id)
  }
  return ids
}

/**
 * The stored roles to read: every read-only member of a design room (it must be a visitor), and
 * every writer member the unlocked vault has a password for (it must not be: this catches a
 * read-to-write change made without the `from` hint, which leaves the visitor role stored).
 */
export function voiceChecks(design: DesignFile, view: ServerView): VoicePlan {
  const target = targetState(design)
  const checks: VoiceCheck[] = []
  const writersSkipped: { roleId: string; roomId: string }[] = []
  const inVault = new Set(view.vault.roles ?? [])
  for (const room of target.rooms) {
    if (!view.rooms.some((r) => r.roomId === room.roomId)) continue
    const members = membersOf(view, room.roomId)
    for (const roleId of target.roles) {
      if (!members.has(roleId)) continue
      const access = room.access.get(roleId)
      if (access === 'read') checks.push({ roleId, roomId: room.roomId, expect: 'visitor' })
      else if (access === 'write') {
        if (inVault.has(roleId)) checks.push({ roleId, roomId: room.roomId, expect: 'voice' })
        else writersSkipped.push({ roleId, roomId: room.roomId })
      }
    }
  }
  return { checks, writersSkipped }
}

const SEVERITY_RANK: Readonly<Record<AuditSeverity, number>> = Object.freeze(
  Object.fromEntries(AUDIT_SEVERITIES.map((s, i) => [s, i])) as Record<AuditSeverity, number>,
)

function worst(severities: readonly AuditSeverity[]): AuditSeverity {
  return severities.reduce<AuditSeverity>(
    (a, b) => (SEVERITY_RANK[b] < SEVERITY_RANK[a] ? b : a),
    'info',
  )
}

const ROOM_FIELD_SEVERITY: Readonly<Record<keyof RoomConfig, AuditSeverity>> = Object.freeze({
  moderated: 'critical',
  membersOnly: 'critical',
  public: 'high',
  whois: 'high',
  persistent: 'high',
  archive: 'medium',
  name: 'low',
  description: 'low',
})

const ROOM_FIELDS = Object.keys(ROOM_FIELD_SEVERITY) as (keyof RoomConfig)[]

type Scalar = string | number | boolean | undefined

function show(value: Scalar): string {
  return value === undefined || value === '' ? '(none)' : String(value)
}

/** The fields whose values differ. */
function configDiff<K extends string>(
  fields: readonly K[],
  expected: Partial<Record<K, Scalar>>,
  found: Partial<Record<K, Scalar>>,
): K[] {
  return fields.filter((f) => show(expected[f]) !== show(found[f]))
}

function describe<K extends string>(
  fields: readonly K[],
  config: Partial<Record<K, Scalar>>,
): string {
  return fields.map((f) => `${f}: ${show(config[f])}`).join(', ')
}

const NODE_FIELDS: readonly (keyof NodeConfig)[] = Object.freeze([
  'accessModel',
  'publishModel',
  'maxItems',
  'notifyRetract',
  'title',
])

function nodeFieldSeverity(
  field: keyof NodeConfig,
  expected: NodeConfig,
  found: NodeConfig,
): AuditSeverity {
  if (field === 'accessModel') {
    return expected.accessModel === 'whitelist' ? 'critical' : 'medium'
  }
  if (field === 'publishModel') {
    return found.publishModel === 'publishers' ? 'medium' : 'critical'
  }
  return 'low'
}

/** What a node affiliation lets a role do, for comparing grants. */
function nodeGrantRank(affiliation: string): number {
  switch (affiliation) {
    case 'owner':
      return 3
    case 'publisher':
    case 'publish-only':
      return 2
    case 'member':
      return 1
    default:
      return 0
  }
}

const NODE_ACCESS_AFFILIATION = { publish: 'publisher', read: 'member', none: 'none' } as const

/** Repairs run in the planner's order (R-D: grants before revokes); see `repairRank`. */
export function repairRank(action: StepAction): number {
  switch (action.type) {
    case 'create-account':
    case 'reset-password':
      return 0
    case 'ensure-room':
      return 1
    case 'ensure-node':
      return 2
    case 'read-only':
      return 3
    case 'room-access':
    case 'node-access':
      return action.changes.some((c) => c.access !== 'none') ? 3 : 4
    case 'publish':
      return 5
    case 'delete-role':
    case 'destroy-room':
    case 'delete-node':
      return 6
  }
}

interface Builder {
  add(
    item: Omit<AuditItem, 'repairable' | 'destructive'> & { readonly destructive?: boolean },
  ): void
  items(): AuditItem[]
}

function builder(): Builder {
  const byId = new Map<string, AuditItem>()
  return {
    add(item) {
      if (byId.has(item.id)) return
      byId.set(item.id, {
        ...item,
        repairable: item.repair.length > 0,
        destructive: item.destructive ?? false,
      })
    },
    items: () => [...byId.values()],
  }
}

/** Compares the server with the design; see the module comment for what comes from where. */
export function diffAudit(design: DesignFile, input: AuditInput): AuditReport {
  const { view } = input
  const target = targetState(design)
  const plan = planPublish(
    design,
    { ...view, marker: undefined },
    {
      messageCounts: input.messageCounts,
    },
  )
  const out = builder()
  const domain = view.domain
  const roleName = (id: string) => plan.roleNames[id] ?? id
  const targetRoles = new Set(target.roles)
  const readOnly = new Set(target.readOnlyRoles)

  // ---- accounts (XEP-0133 registered users) --------------------------------------------------
  const registered = new Set<string>()
  for (const jid of input.registered) {
    const bare = bareJid(jid)
    if (domainpart(bare) !== domain) continue
    const local = localpart(bare) ?? ''
    if (RESERVED_ROLE_IDS.includes(local)) continue
    const id = roleIdOf(bare, domain)
    if (id !== undefined) {
      registered.add(id)
      continue
    }
    out.add({
      id: `account-unknown:${bare}`,
      kind: 'account-unknown',
      target: bare,
      expected: 'no account that is not a role',
      found: 'an account whose name is not a role id',
      severity: 'high',
      repair: [],
      note: 'The tooling only deletes role accounts; remove this one with the server’s own tools.',
    })
  }
  for (const roleId of target.roles) {
    if (registered.has(roleId)) continue
    out.add({
      id: `account-missing:${roleId}`,
      kind: 'account-missing',
      target: roleId,
      roleId,
      expected: `an account for ${roleName(roleId)}`,
      found: 'no account',
      severity: 'high',
      repair: [{ type: 'create-account', roleId, readOnly: readOnly.has(roleId) }],
      note: 'Repair creates it with a new password, shown on the credentials sheet (ADM-26).',
    })
  }
  const deleteSteps = new Map<string, Extract<StepAction, { type: 'delete-role' }>>()
  for (const step of plan.steps) {
    if (step.action.type === 'delete-role') deleteSteps.set(step.action.roleId, step.action)
  }
  for (const roleId of [...registered].filter((id) => !targetRoles.has(id)).sort()) {
    const action = deleteSteps.get(roleId) ?? { type: 'delete-role', roleId, rooms: [], nodes: [] }
    out.add({
      id: `account-unknown:${roleId}`,
      kind: 'account-unknown',
      target: roleId,
      roleId,
      expected: 'no account that is not a role of the design',
      found: accessSummary(action, 'an account'),
      severity: 'high',
      destructive: true,
      repair: [action],
      note: 'Repair removes its access, then deletes the account (R-E).',
    })
  }
  for (const [roleId, action] of deleteSteps) {
    if (registered.has(roleId)) continue
    const anywhere = action.rooms.length + action.nodes.length > 0
    out.add({
      id: `stray-access:${roleId}`,
      kind: 'stray-access',
      target: roleId,
      roleId,
      expected: 'nothing for a role that is not in the design',
      found: anywhere
        ? accessSummary(action, 'no account, but')
        : 'no account, but a password in the vault',
      severity: anywhere ? 'high' : 'low',
      repair: [action],
      note: anywhere
        ? 'An account created later with this name would get this access back.'
        : undefined,
    })
  }

  // ---- rooms ---------------------------------------------------------------------------------
  const serverRooms = new Map(view.rooms.map((r) => [r.roomId, r]))
  for (const room of target.rooms) {
    const current = serverRooms.get(room.roomId)
    if (current === undefined) {
      out.add({
        id: `room-missing:${room.roomId}`,
        kind: 'room-missing',
        target: room.roomId,
        expected: `room ${room.config.name}`,
        found: 'no room',
        severity: 'high',
        repair: [
          { type: 'ensure-room', roomId: room.roomId, name: room.config.name, create: true },
        ],
      })
      continue
    }
    const fields = configDiff(ROOM_FIELDS, room.config, current.config)
    if (fields.length === 0) continue
    out.add({
      id: `room-config:${room.roomId}`,
      kind: 'room-config',
      target: room.roomId,
      expected: describe(fields, room.config),
      found: describe(fields, current.config),
      severity: worst(fields.map((f) => ROOM_FIELD_SEVERITY[f])),
      repair: [{ type: 'ensure-room', roomId: room.roomId, name: room.config.name, create: false }],
    })
  }

  for (const step of plan.steps) {
    roomAccessItems(step, view, roleName, out)
    nodeAccessItems(step, view, roleName, out)
    documentItems(step, view, out)
    removalItems(step, view, input.messageCounts, out)
  }

  // Room affiliations the planner does not model: admin, owner (moderators) and outcast.
  for (const room of target.rooms) {
    const current = serverRooms.get(room.roomId)
    for (const a of current?.affiliations ?? []) {
      const roleId = roleIdOf(a.jid, domain)
      if (roleId === undefined || !targetRoles.has(roleId) || a.affiliation === 'member') continue
      const access = room.access.get(roleId) ?? 'none'
      if (access === 'none' && a.affiliation === 'outcast') continue
      out.add({
        id: `room-access:${room.roomId}:${roleId}`,
        kind: 'room-access',
        target: room.roomId,
        roleId,
        expected: roomAccessText(access),
        found: a.affiliation,
        severity: a.affiliation === 'outcast' ? 'medium' : 'critical',
        repair: [roomRepair(room.roomId, roleId, access)],
      })
    }
  }

  // ---- stored roles (ADM-37) -----------------------------------------------------------------
  for (const reading of input.voice) {
    voiceItem(reading, roleName, out)
  }
  const plannedVoice = voiceChecks(design, view)
  if (plannedVoice.writersSkipped.length > 0) {
    const roles = [...new Set(plannedVoice.writersSkipped.map((w) => w.roleId))].sort()
    out.add({
      id: 'writers-unchecked',
      kind: 'writers-unchecked',
      target: roles.join(', '),
      expected: 'writers have voice',
      found: `${plannedVoice.writersSkipped.length} writer memberships not checked`,
      severity: 'info',
      repair: [],
      note:
        view.vault.exists && view.vault.roles === undefined
          ? 'Unlock the vault to check writers whose passwords it holds.'
          : 'The vault has no password for these roles. A writer is left without voice only if it was read-only before, when the vault held its password.',
    })
  }

  // ---- nodes ---------------------------------------------------------------------------------
  const serverNodes = new Map(view.nodes.map((n) => [n.node, n]))
  for (const node of target.nodes) {
    const current = serverNodes.get(node.node)
    if (current === undefined) {
      out.add({
        id: `node-missing:${node.node}`,
        kind: 'node-missing',
        target: node.node,
        expected: `node ${node.node} (${node.config.accessModel})`,
        found: 'no node',
        severity: 'high',
        repair: [{ type: 'ensure-node', node: node.node, config: node.config, create: true }],
      })
      continue
    }
    const fields = configDiff(NODE_FIELDS, node.config, current.config)
    if (fields.length > 0) {
      out.add({
        id: `node-config:${node.node}`,
        kind: 'node-config',
        target: node.node,
        expected: describe(fields, node.config),
        found: describe(fields, current.config),
        severity: worst(fields.map((f) => nodeFieldSeverity(f, node.config, current.config))),
        repair: [{ type: 'ensure-node', node: node.node, config: node.config, create: false }],
      })
    }
    // Node affiliations the planner leaves alone: `owner` and `publish-only` where the role has
    // no access (it reads them as none).
    if (node.config.accessModel !== 'open') {
      for (const a of current.affiliations) {
        const roleId = roleIdOf(a.jid, domain)
        if (roleId === undefined || !targetRoles.has(roleId)) continue
        if (node.access.has(roleId)) continue
        if (a.affiliation !== 'owner' && a.affiliation !== 'publish-only') continue
        out.add({
          id: `node-access:${node.node}:${roleId}`,
          kind: 'node-access',
          target: node.node,
          roleId,
          expected: 'none',
          found: a.affiliation,
          severity: 'critical',
          repair: [{ type: 'node-access', node: node.node, changes: [{ roleId, access: 'none' }] }],
        })
      }
    }
  }

  // ---- JIDs that are no role account ---------------------------------------------------------
  foreignItems(view, out)

  // ---- game-setup, without its version -------------------------------------------------------
  const published = publishedDesign(view)
  const gameNode = serverNodes.get(SINGLETON_NODES.gameSetup)
  const gameTarget = target.nodes.find((n) => n.node === SINGLETON_NODES.gameSetup)
  if (gameNode !== undefined && gameTarget !== undefined) {
    const version = published.game?.designVersion ?? design.game.designVersion
    const same =
      published.game !== undefined &&
      canonicalJson({ ...published.game, designVersion: 0 }) ===
        canonicalJson({ ...design.game, designVersion: 0 })
    if (!same) {
      out.add({
        id: `document:${SINGLETON_NODES.gameSetup}:${DOCUMENT_ITEM_ID}`,
        kind: 'document',
        target: SINGLETON_NODES.gameSetup,
        expected: 'the game setup as in the design',
        found: published.game === undefined ? 'missing or not valid' : 'differs',
        severity: 'medium',
        repair: [
          {
            type: 'publish',
            node: SINGLETON_NODES.gameSetup,
            config: gameTarget.config,
            itemId: DOCUMENT_ITEM_ID,
            payload: JSON.stringify({ ...design.game, designVersion: version }),
          },
        ],
        note: `Republished at the server’s design version (${version}), so saved layouts still apply.`,
      })
    }
  }
  if (published.game !== undefined && published.game.designVersion !== design.game.designVersion) {
    out.add({
      id: 'design-version',
      kind: 'design-version',
      target: SINGLETON_NODES.gameSetup,
      expected: `design version ${design.game.designVersion}`,
      found: `design version ${published.game.designVersion}`,
      severity: 'info',
      repair: [],
      note: 'The audit compares the server with this design. If it has changed since it was published, publish it instead.',
    })
  }

  // ---- ADM-42 --------------------------------------------------------------------------------
  out.add({
    id: 'node-names-public',
    kind: 'node-names-public',
    target: 'pubsub',
    expected: 'node names reveal nothing confidential',
    found: `${view.nodes.length} node names, listable by anyone, even without logging in`,
    severity: 'info',
    repair: [],
    note: 'Force, role, room and asset ids are part of node names (ADM-42, R17). Node contents stay protected.',
  })

  return {
    items: sortItems(out.items()),
    vault: vaultState(view, plannedVoice),
    voiceChecked: input.voice.filter((r) => r.role !== undefined).length,
    publishedVersion: published.game?.designVersion,
    online: view.online,
  }
}

function vaultState(view: ServerView, voice: VoicePlan): AuditVaultState {
  const readOnlyMembers = voice.checks.some((c) => c.expect === 'visitor')
  if (!view.vault.exists) return readOnlyMembers ? 'missing' : 'not-needed'
  if (view.vault.roles !== undefined) return 'unlocked'
  return readOnlyMembers || voice.writersSkipped.length > 0 ? 'locked' : 'not-needed'
}

const KIND_ORDER: readonly AuditKind[] = Object.freeze([
  'voice',
  'voice-unchecked',
  'room-config',
  'room-access',
  'subscription',
  'node-config',
  'node-access',
  'foreign-access',
  'account-unknown',
  'account-missing',
  'stray-access',
  'room-missing',
  'node-missing',
  'room-extra',
  'node-extra',
  'document',
  'writers-unchecked',
  'design-version',
  'node-names-public',
])

function sortItems(items: AuditItem[]): AuditItem[] {
  return items.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

function accessSummary(action: Extract<StepAction, { type: 'delete-role' }>, lead: string): string {
  const parts: string[] = []
  if (action.rooms.length > 0) parts.push(`membership of ${action.rooms.join(', ')}`)
  if (action.nodes.length > 0) parts.push(`access to ${action.nodes.length} nodes`)
  return parts.length === 0 ? lead : `${lead} with ${parts.join(' and ')}`
}

function roomAccessText(access: 'write' | 'read' | 'none'): string {
  return access === 'write'
    ? 'member with voice'
    : access === 'read'
      ? 'member, read-only'
      : 'no affiliation'
}

function roomRepair(roomId: string, roleId: string, access: 'write' | 'read' | 'none'): StepAction {
  return access === 'read'
    ? { type: 'read-only', roleId, roomIds: [roomId] }
    : { type: 'room-access', roomId, changes: [{ roleId, access, from: 'none' }] }
}

/** The planner's room steps, one item per role: memberships missing or left behind. */
function roomAccessItems(
  step: PlanStep,
  view: ServerView,
  roleName: (id: string) => string,
  out: Builder,
): void {
  const action = step.action
  const affiliationOf = (roomId: string, roleId: string) =>
    view.rooms
      .find((r) => r.roomId === roomId)
      ?.affiliations.find((a) => roleIdOf(a.jid, view.domain) === roleId)?.affiliation ?? 'none'
  if (action.type === 'room-access') {
    for (const change of action.changes) {
      // A read-to-write change is the planner trusting the documents; the audit reads the stored
      // role instead (voice items).
      if (change.access === 'write' && change.from === 'read') continue
      const found = affiliationOf(action.roomId, change.roleId)
      out.add({
        id: `room-access:${action.roomId}:${change.roleId}`,
        kind: 'room-access',
        target: action.roomId,
        roleId: change.roleId,
        expected: roomAccessText(change.access),
        found: found === 'none' ? 'no affiliation' : found,
        severity:
          change.access === 'none' || found === 'admin' || found === 'owner'
            ? 'critical'
            : 'medium',
        repair: [
          {
            type: 'room-access',
            roomId: action.roomId,
            changes: [{ roleId: change.roleId, access: change.access, from: 'none' }],
          },
        ],
        note:
          change.access === 'none'
            ? `${roleName(change.roleId)} can read this room, which the design does not allow.`
            : undefined,
      })
    }
  } else if (action.type === 'read-only' && step.id.startsWith('read-only-grant:')) {
    for (const roomId of action.roomIds) {
      const found = affiliationOf(roomId, action.roleId)
      out.add({
        id: `room-access:${roomId}:${action.roleId}`,
        kind: 'room-access',
        target: roomId,
        roleId: action.roleId,
        expected: roomAccessText('read'),
        found: found === 'none' ? 'no affiliation' : found,
        severity: found === 'admin' || found === 'owner' ? 'critical' : 'medium',
        repair: [{ type: 'read-only', roleId: action.roleId, roomIds: [roomId] }],
      })
    }
  }
}

/** The planner's node steps, one item per role, and one per subscribed full JID (R-A). */
function nodeAccessItems(
  step: PlanStep,
  view: ServerView,
  roleName: (id: string) => string,
  out: Builder,
): void {
  const action = step.action
  if (action.type !== 'node-access') return
  const node = view.nodes.find((n) => n.node === action.node)
  const confidential = parseNodeName(action.node)?.kind === 'objectives'
  for (const change of action.changes) {
    const affiliation =
      node?.affiliations.find((a) => roleIdOf(a.jid, view.domain) === change.roleId)?.affiliation ??
      'none'
    const repair: StepAction = {
      type: 'node-access',
      node: action.node,
      changes: [{ roleId: change.roleId, access: change.access }],
    }
    const wanted = NODE_ACCESS_AFFILIATION[change.access]
    if (affiliation !== wanted) {
      const over = nodeGrantRank(affiliation) > nodeGrantRank(wanted)
      out.add({
        id: `node-access:${action.node}:${change.roleId}`,
        kind: 'node-access',
        target: action.node,
        roleId: change.roleId,
        expected: wanted,
        found: affiliation,
        severity: over
          ? confidential || nodeGrantRank(affiliation) >= 2
            ? 'critical'
            : 'high'
          : 'medium',
        repair: [repair],
      })
    }
    if (change.access !== 'none') continue
    for (const s of node?.subscriptions ?? []) {
      if (s.subscription === 'none' || roleIdOf(s.jid, view.domain) !== change.roleId) continue
      out.add({
        id: `subscription:${action.node}:${s.jid}`,
        kind: 'subscription',
        target: s.jid,
        roleId: change.roleId,
        expected: `no subscription to ${action.node}`,
        found: `${s.subscription} as ${s.jid}`,
        severity: confidential ? 'critical' : 'high',
        repair: [repair],
        note: `${roleName(change.roleId)} has no read access, but a subscription alone still delivers items (R-A).`,
      })
    }
  }
}

function documentItems(step: PlanStep, view: ServerView, out: Builder): void {
  const action = step.action
  if (action.type !== 'publish' || action.node === SINGLETON_NODES.gameSetup) return
  const present = view.nodes
    .find((n) => n.node === action.node)
    ?.items.some((i) => i.id === action.itemId)
  out.add({
    id: `document:${action.node}:${action.itemId}`,
    kind: 'document',
    target: action.node,
    expected: `item ${action.itemId} as in the design`,
    found: present === true ? 'differs' : 'missing',
    severity: 'medium',
    repair: [action],
  })
}

function removalItems(
  step: PlanStep,
  view: ServerView,
  counts: ReadonlyMap<string, number>,
  out: Builder,
): void {
  const action = step.action
  if (action.type === 'destroy-room') {
    const members = (view.rooms.find((r) => r.roomId === action.roomId)?.affiliations ?? []).filter(
      (a) => a.affiliation !== 'owner',
    ).length
    const count = counts.get(action.roomId)
    out.add({
      id: `room-extra:${action.roomId}`,
      kind: 'room-extra',
      target: action.roomId,
      expected: 'no room that is not in the design (D11)',
      found: `a room with ${members} affiliations and ${count ?? 'uncounted'} archived messages`,
      severity: 'high',
      destructive: true,
      repair: count === undefined ? [] : [action],
      note:
        count === undefined
          ? 'Its messages could not be counted, so it is not offered for destruction.'
          : `Destroying it deletes its ${count} archived messages for good (R-F, ADM-40).`,
    })
  } else if (action.type === 'delete-node') {
    const node = view.nodes.find((n) => n.node === action.node)
    out.add({
      id: `node-extra:${action.node}`,
      kind: 'node-extra',
      target: action.node,
      expected: 'no WRX1 node that is not in the design',
      found: `a node with ${node?.items.length ?? 0} items (${node?.config.accessModel ?? 'unknown'} access)`,
      severity: node?.config.accessModel === 'whitelist' ? 'low' : 'medium',
      destructive: true,
      repair: [action],
    })
  }
}

function voiceItem(reading: VoiceReading, roleName: (id: string) => string, out: Builder): void {
  const { roleId, roomId } = reading
  const id = `voice:${roleId}:${roomId}`
  if (reading.role !== undefined) {
    const visitor = reading.role === 'visitor'
    if (reading.expect === 'visitor' && !visitor) {
      out.add({
        id,
        kind: 'voice',
        target: roomId,
        roleId,
        expected: 'visitor (read-only)',
        found: `${reading.role}: can post`,
        severity: 'critical',
        repair: [{ type: 'read-only', roleId, roomIds: [roomId] }],
        note: `${roleName(roleId)} must be read-only here (ADM-37). Repair revokes its voice through its own login.`,
      })
    } else if (reading.expect === 'voice' && visitor) {
      out.add({
        id,
        kind: 'voice',
        target: roomId,
        roleId,
        expected: 'participant (can post)',
        found: 'visitor: cannot post',
        severity: 'medium',
        repair: [
          {
            type: 'room-access',
            roomId,
            changes: [{ roleId, access: 'write', from: 'read' }],
          },
        ],
        note: 'A read-to-write change left the stored visitor role (the `from` hint was missing).',
      })
    }
    return
  }
  if (reading.expect === 'voice') return
  const reset: StepAction[] = [
    { type: 'reset-password', roleId, readOnly: true },
    { type: 'read-only', roleId, roomIds: [roomId] },
  ]
  const why: Record<VoiceProblem, { found: string; repair: StepAction[]; note: string }> = {
    'vault-missing': {
      found: 'not checked: no vault',
      repair: [],
      note: 'Create the vault (Publish) so read-only roles can be checked and made read-only.',
    },
    'vault-locked': {
      found: 'not checked: the vault is locked',
      repair: [],
      note: 'Unlock the vault and audit again.',
    },
    'no-password': {
      found: 'not checked: the vault has no password for it',
      repair: reset,
      note: 'Repair resets its password into the vault, then revokes its voice. Its players need the new password (ADM-26).',
    },
    'login-failed': {
      found: 'not checked: its vault password was refused',
      repair: reset,
      note: 'Repair resets its password into the vault, then revokes its voice. Its players need the new password (ADM-26).',
    },
    'no-login': {
      found: 'not checked: no way to log in as the role',
      repair: [],
      note: 'The admin tooling was set up without a role login.',
    },
    'join-refused': {
      found: `not checked: joining was refused${reading.detail === undefined ? '' : ` (${reading.detail})`}`,
      repair: [],
      note: 'Audit again; if it persists, check the room on the server.',
    },
  }
  const problem = why[reading.problem ?? 'join-refused']
  out.add({
    id,
    kind: 'voice-unchecked',
    target: roomId,
    roleId,
    expected: 'visitor (read-only)',
    found: problem.found,
    severity: 'high',
    destructive: problem.repair.length > 0,
    repair: problem.repair,
    note: problem.note,
  })
}

function foreignItems(view: ServerView, out: Builder): void {
  const admin = `admin@${view.domain}`
  const foreign = (jid: string) =>
    roleIdOf(jid, view.domain) === undefined && bareJid(jid) !== admin
  for (const room of view.rooms) {
    for (const a of room.affiliations) {
      if (!foreign(a.jid) || a.affiliation === 'outcast') continue
      out.add({
        id: `foreign-access:${room.roomId}:${a.jid}`,
        kind: 'foreign-access',
        target: room.roomId,
        expected: 'only role accounts and the admin',
        found: `${a.jid}: ${a.affiliation}`,
        severity: 'critical',
        repair: [],
        note: 'Not a role account, so the tooling does not change it; remove it with the server’s own tools.',
      })
    }
  }
  for (const node of view.nodes) {
    for (const a of node.affiliations) {
      if (!foreign(a.jid) || a.affiliation === 'outcast' || a.affiliation === 'none') continue
      out.add({
        id: `foreign-access:${node.node}:${a.jid}`,
        kind: 'foreign-access',
        target: node.node,
        expected: 'only role accounts and the admin',
        found: `${a.jid}: ${a.affiliation}`,
        severity: node.config.accessModel === 'open' ? 'high' : 'critical',
        repair: [],
        note: 'Not a role account, so the tooling does not change it; remove it with the server’s own tools.',
      })
    }
    // Anonymous sessions subscribe to open nodes (D20); that is expected.
    if (node.config.accessModel === 'open') continue
    for (const s of node.subscriptions) {
      if (!foreign(s.jid) || s.subscription === 'none') continue
      out.add({
        id: `foreign-access:${node.node}:${s.jid}`,
        kind: 'foreign-access',
        target: node.node,
        expected: 'only role accounts subscribe',
        found: `${s.jid}: ${s.subscription}`,
        severity: 'critical',
        repair: [],
        note: 'Not a role account, so the tooling does not change it; remove it with the server’s own tools.',
      })
    }
  }
}
