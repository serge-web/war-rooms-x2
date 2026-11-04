// The server state a design implies (§3, NFR-3): accounts, rooms with each role's access, and
// nodes with their configs, each role's access and the documents they hold. Pure; 2.3 diffs it
// against `AdminOps.readState` and 2.10 audits against it. It provisions the same state as the
// mock's seed (`@wrx/mock-server` seed.ts), so a seeded mock and a published server agree.
//
// The server knows a role by its account, so here, and in the planner, the audit and AdminOps,
// a role is named by its login name (the account's localpart, §3 rule 1), never its GUID; rooms,
// nodes and documents carry GUIDs.
import { DOCUMENT_ITEM_ID, OBJECTIVES_ITEM_ID, directoryOf, effectiveAccess } from '@wrx/domain'
import { SINGLETON_NODES, TEMPLATE_LIMITS, nodeName, publicAssetIds } from '@wrx/schemas'
import type { DesignFile } from '@wrx/schemas'
import { CLOSED_SIDE_CHANNELS } from '@wrx/transport'
import type { NodeConfig, RoomConfig } from '@wrx/transport'

/** A role's access to a room: a MUC member with voice, a member stored as visitor, or neither. */
export type RoomAccess = 'write' | 'read' | 'none'

/** A role's access to a node: the `publisher` affiliation, `member`, or no affiliation. */
export type NodeAccess = 'publish' | 'read' | 'none'

/** Items kept on `announcements`; the same as the mock's seed. */
export const ANNOUNCEMENTS_MAX_ITEMS = 100

/**
 * Items kept on `retired`: one per deleted force or role (§3 rule 1). ejabberd's default
 * `max_items_node` is 1000; a game deletes far fewer.
 */
export const RETIRED_MAX_ITEMS = 1000

/**
 * Items kept on `templates`: one per template (Annex A, TPL-1), at most the profile's limit,
 * which `checkDesign` enforces; within ejabberd's default `max_items_node` of 1000.
 */
export const TEMPLATES_MAX_ITEMS = TEMPLATE_LIMITS.templates

/**
 * The admin's item on an objectives node: the only item it holds, since only the admin publishes
 * objectives (§3 rule 14, D21).
 */
export const OBJECTIVES_ADMIN_ITEM_ID = OBJECTIVES_ITEM_ID

/** §3 rule 14: one item, the admin's, replaced on each edit. */
export const OBJECTIVES_MAX_ITEMS = 1

/** A room's settings: every RoomConfig field except the name and description. */
export type RoomSetting = Exclude<keyof RoomConfig, 'name' | 'description'>

// A record, so adding a field to RoomConfig without listing it here is a type error: the room
// comparisons once missed the side channels, which let them drift unseen (review F6).
const SETTING_KEYS: Readonly<Record<RoomSetting, true>> = Object.freeze({
  membersOnly: true,
  moderated: true,
  persistent: true,
  public: true,
  whois: true,
  archive: true,
  visitorPrivateMessages: true,
  visitorStatus: true,
  visitorNickChange: true,
  voiceRequests: true,
  subscriptions: true,
})

export const ROOM_SETTINGS: readonly RoomSetting[] = Object.freeze(
  Object.keys(SETTING_KEYS) as RoomSetting[],
)

/** Whether two room configs agree in name, description and every setting. */
export function sameRoomConfig(a: RoomConfig, b: RoomConfig): boolean {
  return (
    a.name === b.name &&
    (a.description ?? '') === (b.description ?? '') &&
    ROOM_SETTINGS.every((key) => a[key] === b[key])
  )
}

/**
 * NFR-3: members-only, moderated (R-C, ADM-37), non-anonymous, persistent, unlisted, archived
 * (PLY-49), with the observer's side channels closed (spike S1b, review F6). There is
 * deliberately no way to ask for an unmoderated room.
 */
export function gameRoomConfig(name: string, description?: string): RoomConfig {
  return {
    name,
    ...(description === undefined || description === '' ? {} : { description }),
    membersOnly: true,
    moderated: true,
    persistent: true,
    public: false,
    whois: 'anyone',
    archive: true,
    ...CLOSED_SIDE_CHANNELS,
  }
}

/**
 * NFR-3 and §3 rule 15: `publishers` always; `whitelist` except for `game-setup` and the game
 * theme's assets, which anonymous users read (D20).
 */
export function gameNodeConfig(accessModel: 'open' | 'whitelist', maxItems: number): NodeConfig {
  return { accessModel, publishModel: 'publishers', maxItems, notifyRetract: true }
}

export interface TargetDocument {
  readonly itemId: string
  /** JSON text, as published. */
  readonly payload: string
}

export interface TargetRoom {
  readonly roomId: string
  readonly config: RoomConfig
  /** Every role with access; roles not listed have none. */
  readonly access: ReadonlyMap<string, 'write' | 'read'>
}

export interface TargetNode {
  readonly node: string
  readonly config: NodeConfig
  /** Every role with an affiliation; roles not listed have none. The admin owns every node. */
  readonly access: ReadonlyMap<string, 'publish' | 'read'>
  readonly documents: readonly TargetDocument[]
}

export interface TargetState {
  /** Login names of the design's roles: the account localparts (§3 rule 1). */
  readonly roles: readonly string[]
  /**
   * Roles that are read-only in at least one room: observers, and roles with an `access: read`
   * entry (§3 rule 5). Revoking their voice needs their password, so the vault must hold it.
   */
  readonly readOnlyRoles: readonly string[]
  readonly rooms: readonly TargetRoom[]
  readonly nodes: readonly TargetNode[]
  /** Each role's login name, by role GUID. */
  readonly loginNames: ReadonlyMap<string, string>
}

/** The state publishing `design` should leave on the server. Assumes a design that passed `checkDesign`. */
export function targetState(design: DesignFile): TargetState {
  const matrix = effectiveAccess(design)
  const loginNames = new Map(design.roles.map((r) => [r.id, r.loginName]))
  const roles = design.roles.map((r) => r.loginName)
  const everyRole = (access: 'read' | 'publish'): Map<string, 'read' | 'publish'> =>
    new Map(roles.map((id) => [id, access]))
  const doc = (value: unknown, itemId = DOCUMENT_ITEM_ID): TargetDocument => ({
    itemId,
    payload: JSON.stringify(value),
  })

  const readOnly = new Set<string>()
  const rooms: TargetRoom[] = design.rooms.map((room) => {
    const access = new Map<string, 'write' | 'read'>()
    for (const [roleId, cell] of matrix.cells.get(room.id) ?? []) {
      const login = loginNames.get(roleId)
      if (cell.access === 'none' || login === undefined) continue
      access.set(login, cell.access)
      if (cell.access === 'read') readOnly.add(login)
    }
    return { roomId: room.id, config: gameRoomConfig(room.name), access }
  })

  // Every White Force role (the umpire-flag force), observer or not, reads every force's
  // objectives; only the admin, the node's owner, publishes them (§3 rule 14, D21, WP 3.5).
  const whiteForces = new Set(design.forces.filter((f) => f.isUmpire).map((f) => f.id))
  const white = design.roles.filter((r) => whiteForces.has(r.forceId)).map((r) => r.loginName)
  const publicAssets = new Set(publicAssetIds(design.game))
  const whitelist1 = gameNodeConfig('whitelist', 1)

  const nodes: TargetNode[] = [
    {
      node: SINGLETON_NODES.gameSetup,
      config: gameNodeConfig('open', 1),
      access: new Map(),
      documents: [doc(design.game)],
    },
    {
      node: SINGLETON_NODES.announcements,
      config: gameNodeConfig('whitelist', ANNOUNCEMENTS_MAX_ITEMS),
      access: everyRole('read'),
      documents: [],
    },
    {
      node: SINGLETON_NODES.gameState,
      config: whitelist1,
      access: everyRole('read'),
      documents: [],
    },
    // §3 rule 1: deleted forces' and roles' last names, read by every role, for message authors.
    // Published with the other documents, before any removal (ADM-39).
    {
      node: SINGLETON_NODES.retired,
      config: gameNodeConfig('whitelist', RETIRED_MAX_ITEMS),
      access: everyRole('read'),
      documents: design.retired.map((record) => doc(record, record.id)),
    },
    // §3 rule 1: where each document is, and each role's GUID by login name, so a role finds
    // its own document without listing nodes (WP 3.4). Read by every role.
    {
      node: SINGLETON_NODES.directory,
      config: whitelist1,
      access: everyRole('read'),
      documents: [doc(directoryOf(design))],
    },
    // Annex A: message templates, one item each, item id the template GUID (TPL-1, provisional
    // answer 1: a leaf, not a collection). Read by every role, published by the admin only
    // (TD2). The planner sets each `lockedAt` before this is built (`withTemplateLocks`).
    {
      node: SINGLETON_NODES.templates,
      config: gameNodeConfig('whitelist', TEMPLATES_MAX_ITEMS),
      access: everyRole('read'),
      documents: design.templates.map((template) => doc(template, template.id)),
    },
    ...design.forces.map((force) => ({
      node: nodeName.force(force.id),
      config: whitelist1,
      access: everyRole('read'),
      documents: [doc(force)],
    })),
    ...design.roles.map((role) => ({
      node: nodeName.role(role.id),
      config: whitelist1,
      access: everyRole('read'),
      documents: [doc(role)],
    })),
    // §3: room participants SHOULD read their room's document and all users MAY; the client's
    // store reads every room document, so every role does (as the mock's seed).
    ...design.rooms.map((room) => ({
      node: nodeName.room(room.id),
      config: whitelist1,
      access: everyRole('read'),
      documents: [doc(room)],
    })),
    ...design.forces.map((force) => {
      // §3 rule 14, D21: the force's roles and every White Force role read; nobody but the
      // admin, who owns the node, publishes.
      const access = new Map<string, 'publish' | 'read'>()
      for (const role of design.roles) {
        if (role.forceId === force.id) access.set(role.loginName, 'read')
      }
      for (const id of white) access.set(id, 'read')
      const objectives = design.objectives.find((o) => o.forceId === force.id)
      return {
        node: nodeName.objectives(force.id),
        config: gameNodeConfig('whitelist', OBJECTIVES_MAX_ITEMS),
        access,
        documents: objectives === undefined ? [] : [doc(objectives, OBJECTIVES_ADMIN_ITEM_ID)],
      }
    }),
    ...design.assets.map((asset) => {
      const open = publicAssets.has(asset.id)
      return {
        node: nodeName.asset(asset.id),
        config: gameNodeConfig(open ? 'open' : 'whitelist', 1),
        access: open ? new Map<string, 'publish' | 'read'>() : everyRole('read'),
        documents: [doc(asset)],
      }
    }),
  ]

  return {
    roles,
    readOnlyRoles: roles.filter((id) => readOnly.has(id)),
    rooms,
    nodes,
    loginNames,
  }
}
