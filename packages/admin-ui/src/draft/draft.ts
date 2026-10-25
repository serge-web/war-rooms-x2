// The admin's design draft (WP 2.2): a `DesignFile` being edited, plus the local metadata that
// keeps generated ids unique and never reused (SRD §3 rule 1). Framework-free and immutable:
// every operation returns a new draft and leaves its input untouched, and unchanged items keep
// their identity. Operations on an unknown id return the draft unchanged.
import { byOrderThenId } from '@wrx/domain'
import { ANONYMOUS_LIKE_ID, LIMITS, RESERVED_ROLE_IDS, isReservedRoleId } from '@wrx/schemas'
import type {
  DesignFile,
  Force,
  GameSetup,
  Objectives,
  Participant,
  Result,
  Role,
  Room,
} from '@wrx/schemas'
import { isSlug, slugify, uniqueSlug } from './slug.ts'

/** The collections whose items carry generated ids. */
export type IdKind = 'forces' | 'roles' | 'rooms'

export interface DraftMeta {
  /**
   * Ids that were used in this draft and then deleted or renamed, by kind. They are never
   * generated again (§3 rule 1), even before the draft is published.
   */
  readonly retiredIds: Readonly<Record<IdKind, readonly string[]>>
  /**
   * Role ids that a publish has provisioned as XMPP accounts (WP 2.3 records them with
   * {@link markPublished}). A published role's login id can no longer change (ADM-5).
   */
  readonly publishedRoleIds: readonly string[]
}

export interface Draft {
  readonly design: DesignFile
  readonly meta: DraftMeta
}

/** An operation that created an item: the new draft and the item's generated id. */
export interface Added {
  readonly draft: Draft
  readonly id: string
}

export type GamePatch = Partial<Pick<GameSetup, 'name' | 'description' | 'briefing'>>
export interface ForcePatch {
  readonly name?: string
  readonly colour?: string
  /** `null` clears the icon. */
  readonly iconAssetId?: string | null
  readonly isUmpire?: boolean
}
export type RolePatch = Partial<Pick<Role, 'name' | 'isObserver'>>
export interface RoomPatch {
  readonly name?: string
  /** Changing the type resets `config` to `{}` unless a config is given too. */
  readonly roomType?: string
  readonly config?: Readonly<Record<string, unknown>>
}

/** Something that refers to an item about to be deleted, for the delete confirmation. */
export interface Reference {
  readonly kind: 'role' | 'room' | 'objectives'
  readonly id: string
  readonly name: string
  /** What deleting does to it, e.g. "its participant entry is removed". */
  readonly effect: string
  /** True when it stops the delete until the admin deals with it first. */
  readonly blocks: boolean
}

export const DEFAULT_FORCE_COLOUR = '#6b7280'
export const DEFAULT_ROOM_TYPE = 'chat'

const EMPTY_META: DraftMeta = Object.freeze({
  retiredIds: Object.freeze({ forces: [], roles: [], rooms: [] }),
  publishedRoleIds: Object.freeze([]),
})

export interface NewDraftOptions {
  readonly name?: string
  readonly now?: Date
}

/** An empty design: a game and nothing else. */
export function createDraft(options: NewDraftOptions = {}): Draft {
  const now = options.now ?? new Date()
  return {
    design: {
      format: 'wrx1-design',
      schemaVersion: 1,
      exportedAt: now.toISOString(),
      game: {
        schemaVersion: 1,
        name: options.name ?? 'Untitled game',
        description: '',
        briefing: '',
        designVersion: 1,
        theme: { tokens: {} },
        roomTypeDefaults: {},
      },
      forces: [],
      roles: [],
      rooms: [],
      objectives: [],
      assets: [],
    },
    meta: EMPTY_META,
  }
}

/** A draft over an existing design (an import, or the published one), with orders made consistent. */
export function draftFromDesign(design: DesignFile, meta: Partial<DraftMeta> = {}): Draft {
  return {
    design: normalise(design),
    meta: {
      retiredIds: meta.retiredIds ?? EMPTY_META.retiredIds,
      publishedRoleIds: meta.publishedRoleIds ?? EMPTY_META.publishedRoleIds,
    },
  }
}

/** The draft as a design file for export or publishing, stamped with `now`. */
export function toDesignFile(draft: Draft, now: Date = new Date()): DesignFile {
  return { ...draft.design, exportedAt: now.toISOString() }
}

/** Records that every current role has been provisioned, so its login id is fixed (ADM-5). */
export function markPublished(draft: Draft): Draft {
  const ids = new Set([...draft.meta.publishedRoleIds, ...draft.design.roles.map((r) => r.id)])
  return { ...draft, meta: { ...draft.meta, publishedRoleIds: [...ids] } }
}

/**
 * Records that these of the draft's roles exist on the server (e.g. the server's plan shows
 * them), so their login ids are fixed (ADM-5). Ids of no current role, and ids already recorded,
 * are ignored; the same draft is returned when nothing changes.
 */
export function markRolesPublished(draft: Draft, roleIds: readonly string[]): Draft {
  const known = new Set(roleIds)
  const added = draft.design.roles
    .map((r) => r.id)
    .filter((id) => known.has(id) && !draft.meta.publishedRoleIds.includes(id))
  if (added.length === 0) return draft
  return {
    ...draft,
    meta: { ...draft.meta, publishedRoleIds: [...draft.meta.publishedRoleIds, ...added] },
  }
}

export function isRolePublished(draft: Draft, roleId: string): boolean {
  return draft.meta.publishedRoleIds.includes(roleId)
}

// --- Game -------------------------------------------------------------------------------------

export function updateGame(draft: Draft, patch: GamePatch): Draft {
  return withDesign(draft, { game: { ...draft.design.game, ...patch } })
}

// --- Forces -----------------------------------------------------------------------------------

export function addForce(draft: Draft, name: string): Added {
  const id = newId(draft, 'forces', name, 'force')
  const force: Force = {
    schemaVersion: 1,
    id,
    name,
    colour: DEFAULT_FORCE_COLOUR,
    isUmpire: false,
    order: draft.design.forces.length,
  }
  return { draft: withDesign(draft, { forces: [...draft.design.forces, force] }), id }
}

export function updateForce(draft: Draft, id: string, patch: ForcePatch): Draft {
  return withDesign(draft, {
    forces: replaceById(draft.design.forces, id, (force) => {
      const { iconAssetId, ...rest } = patch
      const next: Force = { ...force, ...rest }
      if (iconAssetId === null) delete next.iconAssetId
      else if (iconAssetId !== undefined) next.iconAssetId = iconAssetId
      return next
    }),
  })
}

/**
 * Deletes a force, its objectives and every participant entry naming it, and retires its id.
 * Refused while the force still has roles: they must be moved or deleted first, so no role is
 * deleted without its own history warning (ADM-14).
 */
export function deleteForce(draft: Draft, id: string): Result<Draft, string> {
  const force = draft.design.forces.find((f) => f.id === id)
  if (force === undefined) return { ok: true, value: draft }
  const roles = draft.design.roles.filter((r) => r.forceId === id)
  if (roles.length > 0) {
    return {
      ok: false,
      error: `${force.name} still has ${plural(roles.length, 'role')}; move or delete them first`,
    }
  }
  const design = draft.design
  return {
    ok: true,
    value: retire(
      withDesign(draft, {
        forces: design.forces.filter((f) => f.id !== id),
        rooms: withoutEntries(design.rooms, 'force', id),
        objectives: design.objectives.filter((o) => o.forceId !== id),
      }),
      'forces',
      id,
    ),
  }
}

/** Moves a force to `index` in display order (ADM-8); orders stay 0…n-1 (§3 rule 7). */
export function moveForce(draft: Draft, id: string, index: number): Draft {
  return withDesign(draft, { forces: moveInOrder(draft.design.forces, id, index) })
}

// --- Objectives (ADM-23) ----------------------------------------------------------------------

export function objectivesOf(design: DesignFile, forceId: string): Objectives | undefined {
  return design.objectives.find((o) => o.forceId === forceId)
}

/**
 * Sets a force's objectives, as the admin's own item (§3 rule 14), stamped `now`. Ignored for an
 * unknown force.
 */
export function setObjectives(
  draft: Draft,
  forceId: string,
  markdown: string,
  now: Date = new Date(),
): Draft {
  if (!draft.design.forces.some((f) => f.id === forceId)) return draft
  const objectives: Objectives = {
    schemaVersion: 1,
    forceId,
    markdown,
    updatedAt: now.toISOString(),
  }
  const others = draft.design.objectives.filter((o) => o.forceId !== forceId)
  return withDesign(draft, { objectives: [...others, objectives] })
}

// --- Roles ------------------------------------------------------------------------------------

/** Adds a role at the end of its force. Throws for an unknown force: that is a caller bug. */
export function addRole(draft: Draft, forceId: string, name: string): Added {
  if (!draft.design.forces.some((f) => f.id === forceId)) {
    throw new RangeError(`Unknown force "${forceId}"`)
  }
  const id = newId(draft, 'roles', name, 'role')
  const role: Role = {
    schemaVersion: 1,
    id,
    name,
    forceId,
    isObserver: false,
    order: draft.design.roles.filter((r) => r.forceId === forceId).length,
  }
  return { draft: withDesign(draft, { roles: [...draft.design.roles, role] }), id }
}

export function updateRole(draft: Draft, id: string, patch: RolePatch): Draft {
  return withDesign(draft, {
    roles: replaceById(draft.design.roles, id, (role) => ({ ...role, ...patch })),
  })
}

/**
 * Why `newId` cannot be this role's login id, or undefined if it can. Login ids are XMPP
 * localparts, so they are slugs, unique, not reserved, never reused, and fixed once published.
 */
export function roleIdProblem(draft: Draft, id: string, newId: string): string | undefined {
  if (newId === id) return undefined
  if (isRolePublished(draft, id)) {
    return 'the login id cannot change after the role has been published'
  }
  if (!isSlug(newId)) return 'use lowercase letters, digits and single hyphens'
  if (isReservedRoleId(newId)) return `"${newId}" is reserved`
  if (draft.design.roles.some((r) => r.id === newId)) return `another role is "${newId}"`
  if (draft.meta.retiredIds.roles.includes(newId) || draft.meta.publishedRoleIds.includes(newId)) {
    return `"${newId}" was used by a deleted role and cannot be reused`
  }
  return undefined
}

/**
 * Changes a role's id (its login id), before the role is first published. Room entries follow
 * it, and the old id is retired.
 */
export function changeRoleId(draft: Draft, id: string, newId: string): Result<Draft, string> {
  if (!draft.design.roles.some((r) => r.id === id) || newId === id)
    return { ok: true, value: draft }
  const problem = roleIdProblem(draft, id, newId)
  if (problem !== undefined) return { ok: false, error: problem }
  const design = draft.design
  const rooms = design.rooms.map((room) =>
    room.participants.some((p) => p.kind === 'role' && p.id === id)
      ? {
          ...room,
          participants: room.participants.map((p) =>
            p.kind === 'role' && p.id === id ? { ...p, id: newId } : p,
          ),
        }
      : room,
  )
  return {
    ok: true,
    value: retire(
      withDesign(draft, {
        roles: replaceById(design.roles, id, (role) => ({ ...role, id: newId })),
        rooms,
      }),
      'roles',
      id,
    ),
  }
}

/**
 * Moves a role to `index` among the roles of `forceId` (ADM-5, ADM-8): reordering within its
 * force, or a move to another force. The role keeps its id; both forces' orders stay 0…n-1.
 * Ignored for an unknown role or force.
 */
export function moveRole(
  draft: Draft,
  id: string,
  forceId: string,
  index: number = Number.MAX_SAFE_INTEGER,
): Draft {
  const role = draft.design.roles.find((r) => r.id === id)
  if (role === undefined || !draft.design.forces.some((f) => f.id === forceId)) return draft
  const target = draft.design.roles
    .filter((r) => r.forceId === forceId && r.id !== id)
    .sort(byOrderThenId)
  target.splice(clamp(index, 0, target.length), 0, { ...role, forceId })
  const orders = new Map(target.map((r, i) => [r.id, i]))
  return withDesign(draft, {
    roles: draft.design.roles.map((r) => {
      const order = orders.get(r.id)
      if (order === undefined) return r
      return r.id === id ? { ...r, forceId, order } : r.order === order ? r : { ...r, order }
    }),
  })
}

/**
 * Deletes a role and its participant entries, and retires its id. The caller warns first that
 * its message history stays attributed to the old JID (ADM-14).
 */
export function deleteRole(draft: Draft, id: string): Draft {
  if (!draft.design.roles.some((r) => r.id === id)) return draft
  return retire(
    withDesign(draft, {
      roles: draft.design.roles.filter((r) => r.id !== id),
      rooms: withoutEntries(draft.design.rooms, 'role', id),
    }),
    'roles',
    id,
  )
}

// --- Rooms ------------------------------------------------------------------------------------

export function addRoom(draft: Draft, name: string, roomType: string = DEFAULT_ROOM_TYPE): Added {
  const id = newId(draft, 'rooms', name, 'room')
  const room: Room = {
    schemaVersion: 1,
    id,
    name,
    roomType,
    participants: [],
    config: {},
    order: draft.design.rooms.length,
  }
  return { draft: withDesign(draft, { rooms: [...draft.design.rooms, room] }), id }
}

export function updateRoom(draft: Draft, id: string, patch: RoomPatch): Draft {
  return withDesign(draft, {
    rooms: replaceById(draft.design.rooms, id, (room) => {
      const typeChanged = patch.roomType !== undefined && patch.roomType !== room.roomType
      return {
        ...room,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.roomType === undefined ? {} : { roomType: patch.roomType }),
        config: patch.config !== undefined ? { ...patch.config } : typeChanged ? {} : room.config,
      }
    }),
  })
}

/**
 * Adds a participant entry, or changes the access of the entry for the same force or role, so
 * each force or role appears at most once (ADM-6, §3 rule 4).
 */
export function setParticipant(draft: Draft, roomId: string, entry: Participant): Draft {
  return withDesign(draft, {
    rooms: replaceById(draft.design.rooms, roomId, (room) => {
      const at = room.participants.findIndex((p) => p.kind === entry.kind && p.id === entry.id)
      const participants =
        at === -1
          ? [...room.participants, { ...entry }]
          : room.participants.map((p, i) => (i === at ? { ...entry } : p))
      return { ...room, participants }
    }),
  })
}

export function removeParticipant(
  draft: Draft,
  roomId: string,
  kind: Participant['kind'],
  id: string,
): Draft {
  return withDesign(draft, {
    rooms: replaceById(draft.design.rooms, roomId, (room) => ({
      ...room,
      participants: room.participants.filter((p) => !(p.kind === kind && p.id === id)),
    })),
  })
}

export function moveRoom(draft: Draft, id: string, index: number): Draft {
  return withDesign(draft, { rooms: moveInOrder(draft.design.rooms, id, index) })
}

export function deleteRoom(draft: Draft, id: string): Draft {
  if (!draft.design.rooms.some((r) => r.id === id)) return draft
  return retire(
    withDesign(draft, { rooms: draft.design.rooms.filter((r) => r.id !== id) }),
    'rooms',
    id,
  )
}

// --- References -------------------------------------------------------------------------------

/** What refers to an item, and what deleting it would do to each (ADM-14). */
export function referencesTo(design: DesignFile, kind: IdKind, id: string): Reference[] {
  const refs: Reference[] = []
  if (kind === 'forces') {
    for (const role of sortedRoles(design).filter((r) => r.forceId === id)) {
      refs.push({
        kind: 'role',
        id: role.id,
        name: role.name,
        effect: 'belongs to this force; move or delete it first',
        blocks: true,
      })
    }
    if (objectivesOf(design, id) !== undefined) {
      refs.push({
        kind: 'objectives',
        id,
        name: 'Objectives',
        effect: "the force's objectives are deleted",
        blocks: false,
      })
    }
  }
  if (kind === 'forces' || kind === 'roles') {
    const entryKind = kind === 'forces' ? 'force' : 'role'
    for (const room of [...design.rooms].sort(byOrderThenId)) {
      if (room.participants.some((p) => p.kind === entryKind && p.id === id)) {
        refs.push({
          kind: 'room',
          id: room.id,
          name: room.name,
          effect: 'its participant entry is removed',
          blocks: false,
        })
      }
    }
  }
  return refs
}

// --- Helpers ----------------------------------------------------------------------------------

/** Ids that a new item of `kind` must not take. */
export function takenIds(draft: Draft, kind: IdKind): Set<string> {
  const taken = new Set<string>([
    ...draft.design[kind].map((item) => item.id),
    ...draft.meta.retiredIds[kind],
  ])
  if (kind === 'roles') {
    for (const id of [...RESERVED_ROLE_IDS, ...draft.meta.publishedRoleIds]) taken.add(id)
  }
  return taken
}

/** Roles in display order: by force order, then role order, then id (as `effectiveAccess`). */
export function sortedRoles(design: DesignFile): Role[] {
  const forceIndex = new Map([...design.forces].sort(byOrderThenId).map((f, i) => [f.id, i]))
  const indexOf = (r: Role) => forceIndex.get(r.forceId) ?? Number.MAX_SAFE_INTEGER
  return [...design.roles].sort((a, b) => indexOf(a) - indexOf(b) || byOrderThenId(a, b))
}

/**
 * Makes `order` fields consistent (§3 rule 7): forces and rooms 0…n-1 and roles 0…k-1 within each
 * force, keeping the current display order; arrays are sorted into that order.
 */
export function normalise(design: DesignFile): DesignFile {
  const forces = renumber([...design.forces].sort(byOrderThenId))
  const rooms = renumber([...design.rooms].sort(byOrderThenId))
  const byForce = new Map<string, Role[]>()
  for (const role of design.roles) {
    byForce.set(role.forceId, [...(byForce.get(role.forceId) ?? []), role])
  }
  const roles = sortedRoles({
    ...design,
    forces,
    roles: [...byForce.values()].flatMap((group) => renumber(group.sort(byOrderThenId))),
  })
  const same = <T>(a: readonly T[], b: readonly T[]) => a.every((item, i) => item === b[i])
  if (same(forces, design.forces) && same(rooms, design.rooms) && same(roles, design.roles)) {
    return design
  }
  return { ...design, forces, roles, rooms }
}

function withDesign(draft: Draft, changes: Partial<DesignFile>): Draft {
  const design = normalise({ ...draft.design, ...changes })
  return { ...draft, design }
}

function newId(draft: Draft, kind: IdKind, name: string, fallback: string): string {
  const base = slugify(name, fallback)
  // A long all-digit login id would look like an anonymous session (F4): prefix it.
  const safe =
    kind === 'roles' && ANONYMOUS_LIKE_ID.test(base)
      ? `${fallback}-${base}`.slice(0, LIMITS.slugChars)
      : base
  return uniqueSlug(safe, takenIds(draft, kind))
}

function retire(draft: Draft, kind: IdKind, id: string): Draft {
  const retired = draft.meta.retiredIds[kind]
  if (retired.includes(id)) return draft
  return {
    ...draft,
    meta: { ...draft.meta, retiredIds: { ...draft.meta.retiredIds, [kind]: [...retired, id] } },
  }
}

function replaceById<T extends { readonly id: string }>(
  items: readonly T[],
  id: string,
  change: (item: T) => T,
): T[] {
  return items.map((item) => (item.id === id ? change(item) : item))
}

function withoutEntries(rooms: readonly Room[], kind: Participant['kind'], id: string): Room[] {
  return rooms.map((room) =>
    room.participants.some((p) => p.kind === kind && p.id === id)
      ? {
          ...room,
          participants: room.participants.filter((p) => !(p.kind === kind && p.id === id)),
        }
      : room,
  )
}

function moveInOrder<T extends { readonly id: string; readonly order: number }>(
  items: readonly T[],
  id: string,
  index: number,
): T[] {
  const sorted = [...items].sort(byOrderThenId)
  const from = sorted.findIndex((item) => item.id === id)
  if (from === -1) return [...items]
  const [item] = sorted.splice(from, 1)
  if (item !== undefined) sorted.splice(clamp(index, 0, sorted.length), 0, item)
  return renumber(sorted)
}

function renumber<T extends { readonly order: number }>(items: T[]): T[] {
  return items.map((item, order) => (item.order === order ? item : { ...item, order }))
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(n), min), max)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
