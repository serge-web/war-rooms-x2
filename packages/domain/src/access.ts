// Effective access (SRD §3 rules 4 and 5): who can write, read or not see each room. One pure
// function, shared by the admin's access matrix (ADM-9) and the player's room list (PLY-4).
import type { Force, Role, Room } from '@wrx/schemas'

export type Access = 'write' | 'read' | 'none'

/** Why a role has the access it has, for the admin matrix's explanations. */
export type AccessReason =
  /** A `force` participant entry for the role's force. */
  | 'force-entry'
  /** A `role` participant entry for the role itself; it overrides the force entry. */
  | 'role-entry'
  /** The role belongs to an umpire force, a member of every room with write access (D8). */
  | 'umpire'
  /** The role is an observer, so read-only in all its rooms (rule 5). */
  | 'observer'

export interface AccessCell {
  readonly access: Access
  /** Every rule that applied, in the order applied. Empty when access is `none`. */
  readonly reasons: readonly AccessReason[]
}

/** The documents effective access depends on: a design file, or the live documents. */
export interface AccessInput {
  readonly forces: readonly Force[]
  readonly roles: readonly Role[]
  readonly rooms: readonly Room[]
}

export interface AccessProblem {
  readonly roomId: string
  readonly message: string
}

export interface AccessMatrix {
  /** Room ids in display order (order, then id: rule 7). */
  readonly roomIds: readonly string[]
  /** Role ids in display order: by force order, then role order, then id. */
  readonly roleIds: readonly string[]
  /** `cells.get(roomId).get(roleId)`; every room × role pair is present. */
  readonly cells: ReadonlyMap<string, ReadonlyMap<string, AccessCell>>
  /** Participant entries that name an unknown force or role; they grant nothing. */
  readonly problems: readonly AccessProblem[]
}

const NONE: AccessCell = Object.freeze({ access: 'none', reasons: Object.freeze([]) })

/**
 * Expands each room's participant entries to roles. Precedence, from weakest to strongest:
 *
 * 1. A force entry gives its access to every role of that force.
 * 2. A role entry replaces the force entry's access for that role, so one member of a writing
 *    force can be made read-only in one room (rule 5's per-entry read access), or the reverse.
 * 3. Umpire-force roles have write access to every room, whatever the entries say (D8, PLY-15).
 * 4. Observers are capped at read in every room they can see, umpire or not (rule 5, D8).
 *
 * Roles whose force is unknown still get role entries and the observer cap, but not umpire
 * access. Rooms with an unknown type are included: whether a type is supported is not access.
 */
export function effectiveAccess(input: AccessInput): AccessMatrix {
  const forces = new Map(input.forces.map((f) => [f.id, f]))
  const roles = [...new Map(input.roles.map((r) => [r.id, r])).values()].sort((a, b) =>
    compareRoles(a, b, forces),
  )
  const rooms = [...new Map(input.rooms.map((r) => [r.id, r])).values()].sort(byOrderThenId)
  const roleIds = new Set(roles.map((r) => r.id))
  const problems: AccessProblem[] = []
  const cells = new Map<string, ReadonlyMap<string, AccessCell>>()

  for (const room of rooms) {
    const forceAccess = new Map<string, 'write' | 'read'>()
    const roleAccess = new Map<string, 'write' | 'read'>()
    for (const entry of room.participants) {
      if (entry.kind === 'force') {
        if (forces.has(entry.id)) forceAccess.set(entry.id, entry.access)
        else problems.push({ roomId: room.id, message: `unknown force "${entry.id}"` })
      } else if (roleIds.has(entry.id)) {
        roleAccess.set(entry.id, entry.access)
      } else {
        problems.push({ roomId: room.id, message: `unknown role "${entry.id}"` })
      }
    }

    const row = new Map<string, AccessCell>()
    for (const role of roles) {
      let access: Access = 'none'
      const reasons: AccessReason[] = []
      const viaForce = forceAccess.get(role.forceId)
      if (viaForce !== undefined) {
        access = viaForce
        reasons.push('force-entry')
      }
      const viaRole = roleAccess.get(role.id)
      if (viaRole !== undefined) {
        access = viaRole
        reasons.push('role-entry')
      }
      if (forces.get(role.forceId)?.isUmpire === true) {
        access = 'write'
        reasons.push('umpire')
      }
      if (role.isObserver && access === 'write') {
        access = 'read'
        reasons.push('observer')
      }
      row.set(role.id, access === 'none' ? NONE : Object.freeze({ access, reasons }))
    }
    cells.set(room.id, row)
  }

  return Object.freeze({
    roomIds: rooms.map((r) => r.id),
    roleIds: roles.map((r) => r.id),
    cells,
    problems,
  })
}

/** One cell; `none` for an unknown room or role. */
export function accessOf(matrix: AccessMatrix, roomId: string, roleId: string): Access {
  return matrix.cells.get(roomId)?.get(roleId)?.access ?? 'none'
}

/** The rooms a role can see, in display order, with its access to each (PLY-4). */
export function roomsForRole(
  matrix: AccessMatrix,
  roleId: string,
): readonly { readonly roomId: string; readonly access: 'write' | 'read' }[] {
  const rooms: { roomId: string; access: 'write' | 'read' }[] = []
  for (const roomId of matrix.roomIds) {
    const access = accessOf(matrix, roomId, roleId)
    if (access !== 'none') rooms.push({ roomId, access })
  }
  return rooms
}

/** The roles in a room, in display order, with their access: the expanded participant set. */
export function participantsOf(
  matrix: AccessMatrix,
  roomId: string,
): readonly { readonly roleId: string; readonly access: 'write' | 'read' }[] {
  const roles: { roleId: string; access: 'write' | 'read' }[] = []
  for (const roleId of matrix.roleIds) {
    const access = accessOf(matrix, roomId, roleId)
    if (access !== 'none') roles.push({ roleId, access })
  }
  return roles
}

/** Display order for forces, roles and rooms: `order`, then id (rule 7). */
export function byOrderThenId(
  a: { readonly order: number; readonly id: string },
  b: { readonly order: number; readonly id: string },
): number {
  return a.order - b.order || compareIds(a.id, b.id)
}

function compareRoles(a: Role, b: Role, forces: ReadonlyMap<string, Force>): number {
  const fa = forces.get(a.forceId)
  const fb = forces.get(b.forceId)
  // Roles of unknown forces sort last.
  const forceOrder =
    (fa?.order ?? Number.MAX_SAFE_INTEGER) - (fb?.order ?? Number.MAX_SAFE_INTEGER) ||
    compareIds(a.forceId, b.forceId)
  return forceOrder || byOrderThenId(a, b)
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
