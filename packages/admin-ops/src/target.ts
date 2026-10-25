// The server state a design implies (§3, NFR-3): accounts, rooms with each role's access, and
// nodes with their configs, each role's access and the documents they hold. Pure; 2.3 diffs it
// against `AdminOps.readState` and 2.10 audits against it. It provisions the same state as the
// mock's seed (`@wrx/mock-server` seed.ts), so a seeded mock and a published server agree.
import { DOCUMENT_ITEM_ID, effectiveAccess } from '@wrx/domain'
import { SINGLETON_NODES, nodeName, publicAssetIds } from '@wrx/schemas'
import type { DesignFile } from '@wrx/schemas'
import type { NodeConfig, RoomConfig } from '@wrx/transport'

/** A role's access to a room: a MUC member with voice, a member stored as visitor, or neither. */
export type RoomAccess = 'write' | 'read' | 'none'

/** A role's access to a node: the `publisher` affiliation, `member`, or no affiliation. */
export type NodeAccess = 'publish' | 'read' | 'none'

/** Items kept on `announcements`; the same as the mock's seed. */
export const ANNOUNCEMENTS_MAX_ITEMS = 100

/** The admin's own item on an objectives node (§3 rule 14: one item per author). */
export const OBJECTIVES_ADMIN_ITEM_ID = 'admin'

/**
 * §3 rule 14: an objectives node keeps one item per author, so `max_items` must hold the admin's
 * item plus one per umpire-force role. At least 10, as the mock's seed, so adding an umpire
 * during play does not push out an item before the node is reconfigured.
 */
export function objectivesMaxItems(umpireRoles: number): number {
  return Math.max(10, umpireRoles + 1)
}

/**
 * NFR-3: members-only, moderated (R-C, ADM-37), non-anonymous, persistent, unlisted, archived
 * (PLY-49). There is deliberately no way to ask for an unmoderated room.
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
  /** Role ids, which are also the account localparts. */
  readonly roles: readonly string[]
  /**
   * Roles that are read-only in at least one room: observers, and roles with an `access: read`
   * entry (§3 rule 5). Revoking their voice needs their password, so the vault must hold it.
   */
  readonly readOnlyRoles: readonly string[]
  readonly rooms: readonly TargetRoom[]
  readonly nodes: readonly TargetNode[]
}

/** The state publishing `design` should leave on the server. Assumes a design that passed `checkDesign`. */
export function targetState(design: DesignFile): TargetState {
  const matrix = effectiveAccess(design)
  const roles = design.roles.map((r) => r.id)
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
      if (cell.access === 'none') continue
      access.set(roleId, cell.access)
      if (cell.access === 'read') readOnly.add(roleId)
    }
    return { roomId: room.id, config: gameRoomConfig(room.name), access }
  })

  const umpireForces = new Set(design.forces.filter((f) => f.isUmpire).map((f) => f.id))
  const umpires = design.roles.filter((r) => umpireForces.has(r.forceId)).map((r) => r.id)
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
      // §3 rule 14, D21: the force's roles read; umpire-force roles publish (and so read).
      const access = new Map<string, 'publish' | 'read'>()
      for (const role of design.roles) if (role.forceId === force.id) access.set(role.id, 'read')
      for (const umpire of umpires) access.set(umpire, 'publish')
      const objectives = design.objectives.find((o) => o.forceId === force.id)
      return {
        node: nodeName.objectives(force.id),
        config: gameNodeConfig('whitelist', objectivesMaxItems(umpires.length)),
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

  return { roles, readOnlyRoles: roles.filter((id) => readOnly.has(id)), rooms, nodes }
}
