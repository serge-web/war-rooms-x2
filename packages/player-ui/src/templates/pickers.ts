// Force and role pickers (Annex A special fields, TPL-8, TPL-9): what a picker offers, fed live
// from the session's documents, and how a stored GUID reads back as a name. Pure: no React.
import { byOrderThenId } from '@wrx/domain'
import type { FieldInfo, Force, PickerKind, Retired, Role } from '@wrx/schemas'

/** The documents pickers and cards read; the wired panel fills it from the store, live. */
export interface PickerSource {
  readonly forces: readonly Force[]
  readonly roles: readonly Role[]
  /** Deleted forces and roles, so a stored GUID still shows its last name (TPL-9). */
  readonly retired: readonly Retired[]
  /**
   * The roles in this room (effective access, §3 rule 4), for `x-wrx-scope: room`;
   * `undefined` when not known, and a room-scoped picker then offers the whole game.
   */
  readonly roomRoleIds?: ReadonlySet<string> | undefined
}

export const NO_PICKER_SOURCE: PickerSource = Object.freeze({
  forces: Object.freeze([]),
  roles: Object.freeze([]),
  retired: Object.freeze([]),
})

export interface PickerOption {
  /** The GUID stored in the message (TPL-8). */
  readonly value: string
  readonly label: string
  /** A deleted force or role, offered only because the field already holds it. */
  readonly deleted: boolean
}

/** A force's or role's current name, or its last name marked deleted; `undefined` if unknown. */
export interface EntityName {
  readonly name: string
  readonly deleted: boolean
}

/** The current name for a picker's GUID, or the deleted entity's last name (TPL-8, TPL-9). */
export function entityName(
  kind: PickerKind,
  id: string,
  source: PickerSource,
): EntityName | undefined {
  const live =
    kind === 'force'
      ? source.forces.find((f) => f.id === id)
      : source.roles.find((r) => r.id === id)
  if (live !== undefined) return { name: live.name, deleted: false }
  const gone = source.retired.find((r) => r.kind === kind && r.id === id)
  return gone === undefined ? undefined : { name: gone.name, deleted: true }
}

/** `entityName` as one line of text: "Blue Force", or "Old Force (deleted)". */
export function entityLabel(
  kind: PickerKind,
  id: string,
  source: PickerSource,
): string | undefined {
  const found = entityName(kind, id, source)
  if (found === undefined) return undefined
  return found.deleted ? `${found.name} (deleted)` : found.name
}

/**
 * What a picker field offers, in display order (rule 7): every force or role of the game, or
 * with `x-wrx-scope: room` only those with players in this room, and for a role picker with
 * `x-wrx-force` only that force's roles. A value the field already holds that the list would
 * not offer (a deleted force, or a role that left the room) is kept as an option, so the form
 * never hides what it would send.
 */
export function pickerOptions(
  field: Pick<FieldInfo, 'picker' | 'scope' | 'forceFilter'>,
  source: PickerSource,
  current?: unknown,
): readonly PickerOption[] {
  const forces = [...source.forces].sort(byOrderThenId)
  const forceRank = new Map(forces.map((f, i) => [f.id, i]))
  const inRoom = field.scope === 'room' ? source.roomRoleIds : undefined
  let options: PickerOption[]
  if (field.picker === 'force') {
    const roomForces =
      inRoom === undefined
        ? undefined
        : new Set(source.roles.filter((r) => inRoom.has(r.id)).map((r) => r.forceId))
    options = forces
      .filter((f) => roomForces === undefined || roomForces.has(f.id))
      .map((f) => ({ value: f.id, label: f.name, deleted: false }))
  } else {
    const forceName = new Map(forces.map((f) => [f.id, f.name]))
    const rank = (r: Role) => forceRank.get(r.forceId) ?? Number.MAX_SAFE_INTEGER
    options = [...source.roles]
      .filter((r) => field.forceFilter === undefined || r.forceId === field.forceFilter)
      .filter((r) => inRoom === undefined || inRoom.has(r.id))
      .sort((a, b) => rank(a) - rank(b) || byOrderThenId(a, b))
      .map((r) => {
        const force = forceName.get(r.forceId)
        // The force is named unless the field already filters to one.
        const label =
          field.forceFilter === undefined && force !== undefined ? `${r.name} (${force})` : r.name
        return { value: r.id, label, deleted: false }
      })
  }
  if (
    typeof current === 'string' &&
    current !== '' &&
    !options.some((o) => o.value === current) &&
    field.picker !== undefined
  ) {
    const found = entityName(field.picker, current, source)
    options.push({
      value: current,
      label:
        found === undefined
          ? `Unknown ${field.picker}`
          : found.deleted
            ? `${found.name} (deleted)`
            : found.name,
      deleted: found?.deleted ?? false,
    })
  }
  return options
}
