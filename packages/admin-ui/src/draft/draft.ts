// The admin's design draft (WP 2.2): a `DesignFile` being edited, plus the local metadata of what
// has been published. Framework-free and immutable: every operation returns a new draft and
// leaves its input untouched, and unchanged items keep their identity. Operations on an unknown
// id return the draft unchanged.
//
// Ids are GUIDs, generated at creation and never derived from names, so they are never reused
// (§3 rule 1). A role's login name is a readable slug, made from its name at creation, editable
// until the role is first published, then fixed (ADM-5). Deleting a published force or role
// records its last name in the design's `retired` list, which also holds its login name for good.
//
// The draft always has exactly one map room (§3 rule 18): a new draft, an import and a stored
// draft gain one if they have none, its participants follow the forces (every force, write),
// and it cannot be deleted, retyped, duplicated or given other participants.
import { byOrderThenId } from '@wrx/domain'
import {
  ANONYMOUS_LIKE_NAME,
  DESIGN_FILE_VERSION,
  LIMITS,
  MAP_ROOM_TYPE,
  RESERVED_LOGIN_NAMES,
  chatRoomConfigReader,
  chatRoomConfigSchema,
  hasMapParticipants,
  isReservedLoginName,
  mapParticipants,
  newEntityId,
  withMapRoom,
} from '@wrx/schemas'
import type {
  ChatRoomConfig,
  DesignFile,
  Force,
  GameSetup,
  Objectives,
  Participant,
  Result,
  Retired,
  Role,
  Room,
  Template,
  TemplateEntry,
} from '@wrx/schemas'
import { isSlug, slugify, uniqueSlug } from './slug.ts'

/** The collections whose items carry generated ids. */
export type IdKind = 'forces' | 'roles' | 'rooms'

export interface DraftMeta {
  /**
   * GUIDs of roles that a publish has provisioned as XMPP accounts (WP 2.3 records them with
   * {@link markPublished}). A published role's login name can no longer change (ADM-5), and
   * deleting it records its last name (§3 rule 1).
   */
  readonly publishedRoleIds: readonly string[]
  /** GUIDs of forces a publish has provisioned; deleting one records its last name. */
  readonly publishedForceIds: readonly string[]
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

/** Where new ids come from: `newEntityId()`; tests may pass their own. */
export type IdSource = () => string
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
  publishedRoleIds: Object.freeze([]),
  publishedForceIds: Object.freeze([]),
})

export interface NewDraftOptions {
  readonly name?: string
  readonly now?: Date
  /** The id of the White Force the design starts with; a new GUID by default. */
  readonly whiteForceId?: string
  /** The id of the map room the design starts with (§3 rule 18); a new GUID by default. */
  readonly mapRoomId?: string
}

/**
 * An empty design: a game, the White Force (ADM-4: the umpire flag) and the map room (§3 rule
 * 18), nothing else.
 */
export function createDraft(options: NewDraftOptions = {}): Draft {
  const now = options.now ?? new Date()
  const mapRoomId = options.mapRoomId ?? newEntityId()
  const design: DesignFile = {
    format: 'wrx1-design',
    schemaVersion: DESIGN_FILE_VERSION,
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
    forces: [
      {
        schemaVersion: 1,
        id: options.whiteForceId ?? newEntityId(),
        name: 'White',
        colour: DEFAULT_FORCE_COLOUR,
        isUmpire: true,
        order: 0,
      },
    ],
    roles: [],
    rooms: [],
    objectives: [],
    assets: [],
    retired: [],
    templates: [],
  }
  return { design: withMapRoom(design, () => mapRoomId), meta: EMPTY_META }
}

/**
 * A draft over an existing design (an import, the published one, or a stored draft), with orders
 * made consistent and the map room added if it has none (§3 rule 18), its id from `newId`.
 */
export function draftFromDesign(
  design: DesignFile,
  meta: Partial<DraftMeta> = {},
  newId: IdSource = newEntityId,
): Draft {
  return {
    design: normalise(withMapRoom(design, newId)),
    meta: {
      publishedRoleIds: meta.publishedRoleIds ?? EMPTY_META.publishedRoleIds,
      publishedForceIds: meta.publishedForceIds ?? EMPTY_META.publishedForceIds,
    },
  }
}

/** The draft as a design file for export or publishing, stamped with `now`. */
export function toDesignFile(draft: Draft, now: Date = new Date()): DesignFile {
  return { ...draft.design, exportedAt: now.toISOString() }
}

/**
 * Records that every current force and role has been provisioned, so each role's login name is
 * fixed (ADM-5) and deleting any of them records its last name (§3 rule 1).
 */
export function markPublished(draft: Draft): Draft {
  const roles = new Set([...draft.meta.publishedRoleIds, ...draft.design.roles.map((r) => r.id)])
  const forces = new Set([...draft.meta.publishedForceIds, ...draft.design.forces.map((f) => f.id)])
  return {
    ...draft,
    meta: { ...draft.meta, publishedRoleIds: [...roles], publishedForceIds: [...forces] },
  }
}

/**
 * Records that the draft's roles with these login names exist on the server (e.g. the server's
 * plan shows those accounts), so their login names are fixed (ADM-5). Names of no current role,
 * and roles already recorded, are ignored; the same draft is returned when nothing changes.
 */
export function markRolesPublished(draft: Draft, loginNames: readonly string[]): Draft {
  const known = new Set(loginNames)
  const added = draft.design.roles
    .filter((r) => known.has(r.loginName) && !draft.meta.publishedRoleIds.includes(r.id))
    .map((r) => r.id)
  if (added.length === 0) return draft
  return {
    ...draft,
    meta: { ...draft.meta, publishedRoleIds: [...draft.meta.publishedRoleIds, ...added] },
  }
}

/**
 * Takes the server's template locks into the draft (TD6, TPL-4): a template a published room has
 * offered is locked on the server, whichever browser published it, so the editor shows it read
 * only and offers a copy (WP 4.3). A lock is never taken away. The same draft is returned when
 * nothing changes.
 */
export function mergeTemplateLocks(draft: Draft, published: readonly Template[]): Draft {
  const design = draft.design
  const templates = design.templates.map((template) => {
    if (template.lockedAt !== undefined) return template
    const lockedAt = published.find((p) => p.id === template.id)?.lockedAt
    return lockedAt === undefined ? template : { ...template, lockedAt }
  })
  if (templates.every((t, i) => t === design.templates[i])) return draft
  return { ...draft, design: { ...design, templates } }
}

/**
 * Adds the server's `retired` records the draft does not hold (another browser deleted the
 * entity, or the publish recorded it as a safety net), so the draft never offers their login
 * names to a new role (§3 rule 1). Records of entities the draft still has are ignored; the same
 * draft is returned when nothing changes.
 */
export function mergeRetired(draft: Draft, records: readonly Retired[]): Draft {
  const design = draft.design
  const has = new Set([
    ...design.retired.map((r) => r.id),
    ...design.forces.map((f) => f.id),
    ...design.roles.map((r) => r.id),
  ])
  const added = records.filter((r) => !has.has(r.id))
  if (added.length === 0) return draft
  return { ...draft, design: { ...design, retired: [...design.retired, ...added] } }
}

export function isRolePublished(draft: Draft, roleId: string): boolean {
  return draft.meta.publishedRoleIds.includes(roleId)
}

// --- Game -------------------------------------------------------------------------------------

export function updateGame(draft: Draft, patch: GamePatch): Draft {
  return withDesign(draft, { game: { ...draft.design.game, ...patch } })
}

// --- Forces -----------------------------------------------------------------------------------

export function addForce(draft: Draft, name: string, newId: IdSource = newEntityId): Added {
  const id = newId()
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

/** Changes a force. Setting the umpire flag clears it on every other force (ADM-4: exactly one). */
export function updateForce(draft: Draft, id: string, patch: ForcePatch): Draft {
  const forces =
    patch.isUmpire === true
      ? draft.design.forces.map((f) => (f.id !== id && f.isUmpire ? { ...f, isUmpire: false } : f))
      : draft.design.forces
  return withDesign(draft, {
    forces: replaceById(forces, id, (force) => {
      const { iconAssetId, ...rest } = patch
      const next: Force = { ...force, ...rest }
      if (iconAssetId === null) delete next.iconAssetId
      else if (iconAssetId !== undefined) next.iconAssetId = iconAssetId
      return next
    }),
  })
}

/**
 * Deletes a force, its objectives and every participant entry naming it; a published force's
 * last name goes into `retired` (§3 rule 1). Refused while the force still has roles: they must
 * be moved or deleted first, so no role is deleted without its own history warning (ADM-14).
 */
export function deleteForce(
  draft: Draft,
  id: string,
  now: Date = new Date(),
): Result<Draft, string> {
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
  const published = draft.meta.publishedForceIds.includes(id)
  const record: Retired = {
    schemaVersion: 1,
    id,
    kind: 'force',
    name: force.name,
    colour: force.colour,
    deletedAt: now.toISOString(),
  }
  return {
    ok: true,
    value: withDesign(draft, {
      forces: design.forces.filter((f) => f.id !== id),
      rooms: withoutEntries(design.rooms, 'force', id),
      objectives: design.objectives.filter((o) => o.forceId !== id),
      ...(published ? { retired: withRecord(design.retired, record) } : {}),
    }),
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

/**
 * Adds a role at the end of its force, with a new GUID and a login name made from its name.
 * Throws for an unknown force: that is a caller bug.
 */
export function addRole(
  draft: Draft,
  forceId: string,
  name: string,
  newId: IdSource = newEntityId,
): Added {
  if (!draft.design.forces.some((f) => f.id === forceId)) {
    throw new RangeError(`Unknown force "${forceId}"`)
  }
  const id = newId()
  const role: Role = {
    schemaVersion: 1,
    id,
    loginName: newLoginName(draft, name),
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
 * Why `loginName` cannot be this role's login name, or undefined if it can. Login names are
 * XMPP localparts, so they are slugs, unique, not reserved, never a deleted role's, and fixed
 * once published (§3 rule 1, ADM-5).
 */
export function loginNameProblem(
  draft: Draft,
  roleId: string,
  loginName: string,
): string | undefined {
  const role = draft.design.roles.find((r) => r.id === roleId)
  if (role === undefined || loginName === role.loginName) return undefined
  if (isRolePublished(draft, roleId)) {
    return 'the login name cannot change after the role has been published'
  }
  if (!isSlug(loginName)) return 'use lowercase letters, digits and single hyphens'
  if (isReservedLoginName(loginName)) return `"${loginName}" is reserved`
  if (draft.design.roles.some((r) => r.id !== roleId && r.loginName === loginName)) {
    return `another role is "${loginName}"`
  }
  if (draft.design.retired.some((r) => r.loginName === loginName)) {
    return `"${loginName}" was used by a deleted role and cannot be reused`
  }
  return undefined
}

/** Changes a role's login name, before the role is first published (ADM-5). */
export function changeLoginName(
  draft: Draft,
  roleId: string,
  loginName: string,
): Result<Draft, string> {
  const role = draft.design.roles.find((r) => r.id === roleId)
  if (role === undefined || loginName === role.loginName) return { ok: true, value: draft }
  const problem = loginNameProblem(draft, roleId, loginName)
  if (problem !== undefined) return { ok: false, error: problem }
  return {
    ok: true,
    value: withDesign(draft, {
      roles: replaceById(draft.design.roles, roleId, (r) => ({ ...r, loginName })),
    }),
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
 * Deletes a role and its participant entries. A published role's last name and login name go
 * into `retired` (§3 rule 1), so its old messages keep its name and no other role takes its
 * login. The caller warns first that its message history stays with the old login (ADM-14).
 */
export function deleteRole(draft: Draft, id: string, now: Date = new Date()): Draft {
  const role = draft.design.roles.find((r) => r.id === id)
  if (role === undefined) return draft
  const published = isRolePublished(draft, id)
  const colour = draft.design.forces.find((f) => f.id === role.forceId)?.colour
  const record: Retired = {
    schemaVersion: 1,
    id,
    kind: 'role',
    name: role.name,
    loginName: role.loginName,
    ...(colour === undefined ? {} : { colour }),
    deletedAt: now.toISOString(),
  }
  return withDesign(draft, {
    roles: draft.design.roles.filter((r) => r.id !== id),
    rooms: withoutEntries(draft.design.rooms, 'role', id),
    ...(published ? { retired: withRecord(draft.design.retired, record) } : {}),
  })
}

// --- Rooms ------------------------------------------------------------------------------------

export function addRoom(
  draft: Draft,
  name: string,
  roomType: string = DEFAULT_ROOM_TYPE,
  newId: IdSource = newEntityId,
): Added {
  // §3 rule 18: the draft has its one map room already; another is never added.
  if (roomType === MAP_ROOM_TYPE) return { draft, id: '' }
  const id = newId()
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
      // §3 rule 18: the map room stays the map room, and no other room becomes one.
      const retype =
        patch.roomType !== undefined &&
        patch.roomType !== MAP_ROOM_TYPE &&
        room.roomType !== MAP_ROOM_TYPE
      const typeChanged = retype && patch.roomType !== room.roomType
      return {
        ...room,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(retype ? { roomType: patch.roomType } : {}),
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
  if (isMapRoomId(draft, roomId)) return draft
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
  if (isMapRoomId(draft, roomId)) return draft
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

/** Deletes a room; the map room is never deleted (§3 rule 18). */
export function deleteRoom(draft: Draft, id: string): Draft {
  if (!draft.design.rooms.some((r) => r.id === id) || isMapRoomId(draft, id)) return draft
  return withDesign(draft, { rooms: draft.design.rooms.filter((r) => r.id !== id) })
}

/** Whether a room is the game's map room, whose participants are fixed (§3 rule 18). */
export function isMapRoom(room: Pick<Room, 'roomType'>): boolean {
  return room.roomType === MAP_ROOM_TYPE
}

function isMapRoomId(draft: Draft, roomId: string): boolean {
  return draft.design.rooms.some((r) => r.id === roomId && isMapRoom(r))
}

// --- Templates (Annex A, WP 4.3) ---------------------------------------------------------------

export interface TemplatePatch {
  readonly name?: string
  /** An empty description is left out. */
  readonly description?: string
  readonly schema?: Readonly<Record<string, unknown>>
  /** `null` removes the UI schema. */
  readonly uiSchema?: Readonly<Record<string, unknown>> | null
}

/** Whether the template's schema is fixed: a publish made it available in a room (TD6, TPL-4). */
export function isTemplateLocked(template: Pick<Template, 'lockedAt'>): boolean {
  return template.lockedAt !== undefined
}

/** A new template with no fields yet, stamped `now` (display only). */
export function addTemplate(
  draft: Draft,
  name: string,
  now: Date = new Date(),
  newId: IdSource = newEntityId,
): Added {
  const id = newId()
  const template: Template = {
    schemaVersion: 1,
    id,
    name,
    schema: { type: 'object', properties: {} },
    createdAt: now.toISOString(),
  }
  return { draft: withDesign(draft, { templates: [...draft.design.templates, template] }), id }
}

/**
 * Changes a template. A locked template keeps its schema, UI schema and name: a patch that
 * changes them is ignored (the planner would refuse it, `template-locked-changed`); copy it to a
 * new template instead. Its description may change (product owner, Nov 2, 2026; M1).
 */
export function updateTemplate(draft: Draft, id: string, patch: TemplatePatch): Draft {
  const template = draft.design.templates.find((t) => t.id === id)
  if (template === undefined) return draft
  const next: Template = { ...template }
  const locked = isTemplateLocked(template)
  if (patch.name !== undefined && !locked) next.name = patch.name
  if (patch.description !== undefined) {
    if (patch.description === '') delete next.description
    else next.description = patch.description
  }
  if (patch.schema !== undefined && !locked) next.schema = { ...patch.schema }
  if (!locked && patch.uiSchema === null) delete next.uiSchema
  else if (!locked && patch.uiSchema !== undefined) next.uiSchema = { ...patch.uiSchema }
  return withDesign(draft, {
    templates: draft.design.templates.map((t) => (t.id === id ? next : t)),
  })
}

/**
 * A copy of a template with a new GUID, unlocked, named "Copy of …" (TPL-4: the way to change a
 * locked template). Ignored for an unknown id (the draft unchanged, the id empty).
 */
export function copyTemplate(
  draft: Draft,
  id: string,
  now: Date = new Date(),
  newId: IdSource = newEntityId,
): Added {
  const template = draft.design.templates.find((t) => t.id === id)
  if (template === undefined) return { draft, id: '' }
  const copyId = newId()
  const names = new Set(draft.design.templates.map((t) => t.name))
  const base = `Copy of ${template.name}`.slice(0, LIMITS.nameChars - 5)
  let name = base
  for (let n = 2; names.has(name); n++) name = `${base} (${n})`
  const { lockedAt: _locked, ...rest } = template
  const copy: Template = { ...rest, id: copyId, name, createdAt: now.toISOString() }
  return { draft: withDesign(draft, { templates: [...draft.design.templates, copy] }), id: copyId }
}

/** The chat room's config read as version 2 (TPL-2), or undefined for other room types. */
export function chatConfigOf(room: Room): ChatRoomConfig | undefined {
  if (room.roomType !== DEFAULT_ROOM_TYPE) return undefined
  const parsed = chatRoomConfigReader.safeParse(room.config)
  return parsed.success ? parsed.data : undefined
}

/** The rooms whose template config names the template, in display order. */
export function roomsUsingTemplate(design: DesignFile, templateId: string): Room[] {
  return [...design.rooms]
    .sort(byOrderThenId)
    .filter((room) => chatConfigOf(room)?.templates.some((e) => e.templateIds.includes(templateId)))
}

/**
 * Deletes a template. Refused while a room's config offers it: take it out of those rooms first,
 * so no room is left naming an unknown template. A published template the design drops is
 * removed by the next publish, which asks to confirm it (`template-removed`).
 */
export function deleteTemplate(draft: Draft, id: string): Result<Draft, string> {
  const template = draft.design.templates.find((t) => t.id === id)
  if (template === undefined) return { ok: true, value: draft }
  const rooms = roomsUsingTemplate(draft.design, id)
  if (rooms.length > 0) {
    return {
      ok: false,
      error: `${template.name} is offered in ${rooms.map((r) => r.name).join(', ')}; take it out of ${rooms.length === 1 ? 'that room' : 'those rooms'} first`,
    }
  }
  return {
    ok: true,
    value: withDesign(draft, { templates: draft.design.templates.filter((t) => t.id !== id) }),
  }
}

function withChatConfig(
  draft: Draft,
  roomId: string,
  change: (config: ChatRoomConfig) => ChatRoomConfig,
): Draft {
  const room = draft.design.rooms.find((r) => r.id === roomId)
  const config = room === undefined ? undefined : chatConfigOf(room)
  if (config === undefined) return draft
  return updateRoom(draft, roomId, { config: { ...change(config) } })
}

/** Whether free text may be posted beside templates in a chat room (TD3). */
export function setFreeText(draft: Draft, roomId: string, freeText: boolean): Draft {
  return withChatConfig(draft, roomId, (config) => ({ ...config, freeText }))
}

/**
 * The templates a force or role may use in a chat room (TD4, TPL-2): its entry is added,
 * replaced, or with no templates removed. A role entry adds to its force's (provisional answer 4).
 */
export function setTemplateEntry(
  draft: Draft,
  roomId: string,
  kind: TemplateEntry['kind'],
  id: string,
  templateIds: readonly string[],
): Draft {
  return withChatConfig(draft, roomId, (config) => {
    const at = config.templates.findIndex((e) => e.kind === kind && e.id === id)
    const entry: TemplateEntry = { kind, id, templateIds: [...new Set(templateIds)] }
    const templates =
      templateIds.length === 0
        ? config.templates.filter((_, i) => i !== at)
        : at === -1
          ? [...config.templates, entry]
          : config.templates.map((e, i) => (i === at ? entry : e))
    return { ...config, templates }
  })
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
    // The map room's entries follow the forces by themselves (§3 rule 18).
    for (const room of [...design.rooms].sort(byOrderThenId).filter((r) => !isMapRoom(r))) {
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

/**
 * Login names a new role must not take: the other roles', the reserved ones, and those deleted
 * roles keep (§3 rule 1).
 */
export function takenLoginNames(draft: Draft): Set<string> {
  return new Set<string>([
    ...draft.design.roles.map((r) => r.loginName),
    ...RESERVED_LOGIN_NAMES,
    ...draft.design.retired.flatMap((r) => (r.loginName === undefined ? [] : [r.loginName])),
  ])
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
  const design = normalise(withMapParticipants({ ...draft.design, ...changes }))
  return { ...draft, design }
}

/** The map room's participants follow the forces: every force, write (§3 rule 18). */
function withMapParticipants(design: DesignFile): DesignFile {
  if (design.rooms.every((r) => !isMapRoom(r) || hasMapParticipants(r, design.forces))) {
    return design
  }
  const participants = mapParticipants(design.forces)
  return {
    ...design,
    rooms: design.rooms.map((r) => (isMapRoom(r) ? { ...r, participants } : r)),
  }
}

/** A login name from a role's name, unique and never a deleted role's (§3 rule 1). */
function newLoginName(draft: Draft, name: string): string {
  const base = slugify(name, 'role')
  // A long all-digit login name would look like an anonymous session (F4): prefix it.
  const safe = ANONYMOUS_LIKE_NAME.test(base) ? `role-${base}`.slice(0, LIMITS.slugChars) : base
  return uniqueSlug(safe, takenLoginNames(draft))
}

/** `records` with `record`, replacing one with the same id. */
function withRecord(records: readonly Retired[], record: Retired): Retired[] {
  return [...records.filter((r) => r.id !== record.id), record]
}

function replaceById<T extends { readonly id: string }>(
  items: readonly T[],
  id: string,
  change: (item: T) => T,
): T[] {
  return items.map((item) => (item.id === id ? change(item) : item))
}

/**
 * The rooms without a deleted force's or role's entries: its participant entries, and its
 * template entries in a chat room's config (TPL-2), which would otherwise name an unknown entity.
 */
function withoutEntries(rooms: readonly Room[], kind: Participant['kind'], id: string): Room[] {
  return rooms.map((room) => {
    const named = (e: { readonly kind: string; readonly id: string }) =>
      e.kind === kind && e.id === id
    const config = chatRoomConfigSchema.safeParse(room.config)
    const inConfig = config.success && config.data.templates.some(named)
    if (!room.participants.some(named) && !inConfig) return room
    return {
      ...room,
      participants: room.participants.filter((p) => !named(p)),
      ...(inConfig
        ? { config: { ...config.data, templates: config.data.templates.filter((e) => !named(e)) } }
        : {}),
    }
  })
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
