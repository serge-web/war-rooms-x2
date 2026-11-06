// The umpire room and White Force proposals (SRD Annex C PD6, PD8, PY-8; §3 rule 18; WP 6.4).
// Every game has one umpire room, made with the map room and fixed like it: the admin and the
// White Force are its only members. A White Force role proposes a world state there as a
// `world-proposal` message, which the admin may load into the world-state draft after the change
// summary (ADM-45, ADM-46). Like the map room's world state, a proposal may be up to 500 KB
// (PLY-53); every other message in the room keeps the 64 KiB cap.
import { z } from 'zod'
import { LIMITS } from './common.ts'
import { worldStateSchema } from './world.ts'

/** The room type of the game's one umpire room (§3 rule 18, PD8, ARC-5). */
export const UMPIRE_ROOM_TYPE = 'umpire'

/** The name a new umpire room is given; the admin may rename it. */
export const UMPIRE_ROOM_NAME = 'Umpires'

/**
 * A White Force proposal (PD6, PY-8): a full world state and a summary of what it changes, for
 * the admin. Posted only in the umpire room, never a player room; clients accept it only there
 * and only from the admin or a White Force role. Up to 500,000 bytes as a stanza (PLY-53).
 */
export const worldProposalContentSchema = z
  .object({
    state: worldStateSchema.describe('The proposed world state, in full (D25)'),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(LIMITS.proposalSummaryChars)
      .describe('What the proposal changes, in words, for the admin; plain text'),
  })
  .describe('A proposed world state and its summary')

export const worldProposalMessageBodySchema = z
  .object({
    type: z.literal('world-proposal'),
    schemaVersion: z.literal(1),
    content: worldProposalContentSchema,
  })
  .describe('A White Force proposal in the umpire room (PY-8)')

/**
 * The umpire room's config, version 1 (ARC-5): nothing to set. Free text only; it offers no
 * templates. `{}` reads as version 1.
 */
export const umpireRoomConfigSchema = z
  .strictObject({ schemaVersion: z.literal(1) })
  .describe('Umpire room config: nothing to set')

export const umpireRoomConfigReader: z.ZodType<UmpireRoomConfig> = z.preprocess(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !('schemaVersion' in value)
      ? { ...value, schemaVersion: 1 }
      : value,
  umpireRoomConfigSchema,
)

export type WorldProposalContent = z.infer<typeof worldProposalContentSchema>
export type WorldProposalMessageBody = z.infer<typeof worldProposalMessageBodySchema>
export type UmpireRoomConfig = z.infer<typeof umpireRoomConfigSchema>

interface Entry {
  kind: 'force' | 'role'
  id: string
  access: 'write' | 'read'
}

interface FixedInput {
  readonly forces: readonly {
    readonly id: string
    readonly order: number
    readonly isUmpire: boolean
  }[]
  readonly roles: readonly {
    readonly id: string
    readonly forceId: string
    readonly order: number
    readonly isObserver: boolean
  }[]
  readonly rooms: readonly {
    readonly id: string
    readonly roomType: string
    readonly participants: readonly { readonly kind: string; readonly id: string }[]
  }[]
}

const byOrderThenId = (
  a: { readonly id: string; readonly order: number },
  b: { readonly id: string; readonly order: number },
) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The fixed participants of the umpire room (§3 rule 18, PD8): the admin, who writes in every
 * room, and every White Force role.
 *
 * - Each White Force (umpire-flag force) as a write entry: its roles that are not observers
 *   write, and its observers read (rule 4). A force entry is not an observer's assignment, so it
 *   changes no other room.
 * - A read entry for each White Force observer that is assigned rooms elsewhere (named in a role
 *   entry of another room): such an observer reads only the rooms naming it (rule 4), so without
 *   it the observer would not see the umpire room. It is already assigned, so the entry changes
 *   nothing else. Assignment is judged without the umpire room's own entries, so an observer
 *   whose other entries go loses this one too.
 *
 * No other force or role is a participant.
 */
export function umpireParticipants(input: FixedInput): Entry[] {
  const umpires = input.forces.filter((f) => f.isUmpire).sort(byOrderThenId)
  const white = new Set(umpires.map((f) => f.id))
  const assigned = new Set<string>()
  for (const room of input.rooms) {
    if (room.roomType === UMPIRE_ROOM_TYPE) continue
    for (const entry of room.participants) if (entry.kind === 'role') assigned.add(entry.id)
  }
  const observers = input.roles
    .filter((r) => r.isObserver && white.has(r.forceId) && assigned.has(r.id))
    .sort(byOrderThenId)
  return [
    ...umpires.map((f) => ({ kind: 'force' as const, id: f.id, access: 'write' as const })),
    ...observers.map((r) => ({ kind: 'role' as const, id: r.id, access: 'read' as const })),
  ]
}

/** Whether a room's participants are the umpire room's fixed set, in any order. */
export function hasUmpireParticipants(
  room: { readonly participants: readonly { kind: string; id: string; access: string }[] },
  input: FixedInput,
): boolean {
  const key = (p: { kind: string; id: string; access: string }) => `${p.kind}:${p.id}:${p.access}`
  const want = new Set(umpireParticipants(input).map(key))
  const have = room.participants.map(key)
  return have.length === want.size && have.every((k) => want.has(k))
}
