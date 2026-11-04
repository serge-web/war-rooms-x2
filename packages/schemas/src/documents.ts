import { z } from 'zod'
import {
  LIMITS,
  hexColourSchema,
  idSchema,
  isoDateTimeSchema,
  loginNameSchema,
  nameSchema,
  orderSchema,
  sha256Schema,
  slugSchema,
} from './common.ts'
import { themeSchema } from './theme.ts'

/** `game-setup`: anonymously readable, so it must hold nothing sensitive (D20, §3 rule 15). */
export const gameSetupSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: nameSchema,
    description: z.string().max(LIMITS.descriptionChars).describe('Short description'),
    briefing: z
      .string()
      .max(LIMITS.briefingChars)
      .describe('Public Markdown briefing for the welcome page (PLY-46–48)'),
    designVersion: z
      .int()
      .min(1)
      .describe(
        'Incremented by a publish that changes the structure: a room added or removed, or the effective access to a room of a role in both designs (§3 rule 8); keys saved layouts (PLY-5)',
      ),
    theme: themeSchema,
    roomTypeDefaults: z
      .record(slugSchema, z.record(z.string(), z.unknown()))
      .describe('Default config per room type, validated by that type (ARC-5)'),
  })
  .describe('Game properties and the game theme')

/** `forces:<forceId>` */
export const forceSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    name: nameSchema,
    colour: hexColourSchema.describe('Colour for message authors; not a theme token (§3 rule 13)'),
    iconAssetId: idSchema.optional().describe('Id of an `assets:<id>` node'),
    isUmpire: z
      .boolean()
      .describe(
        'The umpire flag: this is the White Force, which the admin plays in as umpire; exactly one force has it (ADM-4, D8)',
      ),
    order: orderSchema,
    theme: themeSchema.optional().describe('Styles the force panel only (D19)'),
  })
  .describe('A side in the game')

/**
 * `roles:<roleId>`. The id is a GUID; the login name, a separate readable field, is the XMPP
 * account's localpart (§3 rule 1). Never holds a password.
 */
export const roleSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema.describe('Role id, a GUID'),
    loginName: loginNameSchema,
    name: nameSchema,
    forceId: idSchema.describe("Id of the role's force"),
    isObserver: z.boolean().describe('Observers read but never post, in all their rooms (D8)'),
    order: orderSchema,
  })
  .describe('A player position; one XMPP account')

export const participantSchema = z
  .object({
    kind: z.enum(['force', 'role']),
    id: idSchema.describe('Force or role id'),
    access: z.enum(['write', 'read']).describe('Read-only entries join as MUC visitors'),
  })
  .describe('A room participant entry (§3 rule 4)')

/** `rooms:<roomId>` */
export const roomSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    name: nameSchema,
    roomType: slugSchema.describe('Room type id from the registry (v1: chat and map)'),
    participants: z
      .array(participantSchema)
      .refine(
        (entries) => new Set(entries.map((p) => `${p.kind}:${p.id}`)).size === entries.length,
        'each force or role may appear only once',
      )
      .describe(
        'Mixed force and role entries; White Force roles are added implicitly, and a role entry assigns a White Force observer the room (§3 rule 4)',
      ),
    config: z
      .record(z.string(), z.unknown())
      .describe('Type-specific config, validated by the room type (ARC-5)'),
    order: orderSchema,
    theme: themeSchema.optional().describe("Styles this room's panel and tab"),
  })
  .describe('A channel: one MUC room plus this config')

/** `objectives:<forceId>` (§3 rule 14, D21) */
export const objectivesSchema = z
  .object({
    schemaVersion: z.literal(1),
    forceId: idSchema.describe('Id of the force these objectives belong to'),
    markdown: z.string().max(LIMITS.objectivesChars).describe('Objectives as Markdown'),
    updatedAt: isoDateTimeSchema.describe(
      "When the admin wrote this version, by the admin's clock; display only. The node holds one item, the admin's, replaced on each edit; a live notification replaces the copy fetched at login, whatever this says (§3 rule 14)",
    ),
  })
  .describe("A force's objectives; confidential to that force, the White Force and the admin")

/** The phases of a turn, in order (D7). */
export const GAME_PHASES = Object.freeze(['planning', 'adjudication'] as const)

export const ASSET_MIME_TYPES = Object.freeze(['image/png', 'image/webp', 'image/svg+xml'] as const)

/** The asset's fields, before the size check; design files before GUIDs extend it. */
export const assetFieldsSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  mimeType: z.enum(ASSET_MIME_TYPES),
  size: z.int().min(1).max(LIMITS.assetHardBytes).describe('Decoded size in bytes'),
  sha256: sha256Schema,
  data: z.base64().describe('The image, base64-encoded'),
})

/** That an asset's `size` is its decoded data's. */
export function assetSizeMatches(a: { readonly data: string; readonly size: number }): boolean {
  return base64DecodedLength(a.data) === a.size
}

/** The refinement's error, a fresh object each time (zod takes a mutable path). */
export function assetSizeError(): { message: string; path: string[] } {
  return { message: 'size does not match the decoded data', path: ['size'] }
}

/** `assets:<assetId>` (§3 rule 12). SVG is sanitised on upload and shown only via `<img>`. */
export const assetSchema = assetFieldsSchema
  .refine(assetSizeMatches, assetSizeError())
  .describe('An image used by themes')

/** One item of the `announcements` node (PLY-37). */
export const announcementSchema = z
  .object({
    schemaVersion: z.literal(1),
    text: z.string().trim().min(1).max(LIMITS.announcementTextChars).describe('Plain text'),
    postedAt: isoDateTimeSchema.describe("Admin's clock when posted; display only"),
  })
  .describe('An out-of-game announcement from the admin')

/**
 * One item of the `retired` node, its id the deleted entity's GUID (§3 rule 1, ADM-14): the last
 * name of a deleted force or role, so old messages still show it, marked as deleted. Nothing
 * that decides access reads it.
 */
export const retiredSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema.describe('The deleted force or role GUID; also the item id'),
    kind: z.enum(['force', 'role']),
    name: nameSchema.describe('Its last display name'),
    loginName: loginNameSchema
      .optional()
      .describe('A role’s login name, which no other role may take (§3 rule 1)'),
    colour: hexColourSchema
      .optional()
      .describe('The force’s colour, or a role’s force’s colour when it was deleted'),
    deletedAt: isoDateTimeSchema.describe("Admin's clock when the deletion was recorded"),
  })
  .refine((r) => (r.kind === 'role') === (r.loginName !== undefined), {
    message: 'a role record has a login name, a force record none',
    path: ['loginName'],
  })
  .describe('The last name of a deleted force or role')

/**
 * `directory`: the game's entity GUIDs, and each role's login name with its GUID, so a role
 * finds its own `roles:<guid>` document from its login name alone, without listing nodes
 * (§3 rule 1). Read by every role; publish: admin. A pointer only: the client takes its role
 * from the role document, and only if that document carries its login name.
 */
export const directorySchema = z
  .object({
    schemaVersion: z.literal(1),
    roles: z
      .array(
        z.object({
          id: idSchema.describe('The role GUID'),
          loginName: loginNameSchema,
        }),
      )
      .describe('Every role: its GUID and its login name'),
    forces: z.array(idSchema).describe('Every force GUID'),
    rooms: z.array(idSchema).describe('Every room GUID'),
  })
  .describe('Where each entity document is, by GUID, and each role by login name')

/**
 * `game-state`: the turn state (D7, §3 table). Read by every role, published by the admin only
 * (rule 15); the admin advances it (ADM-43), and a first publish starts it at turn 1, planning.
 */
export const gameStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    turn: z.int().min(1).max(LIMITS.turnMax).describe('The turn number, from 1'),
    phase: z
      .enum(GAME_PHASES)
      .describe('Each turn has a planning phase, then an adjudication phase (D7)'),
  })
  .describe('The current turn and phase')

/** The turn state a first publish leaves: turn 1, planning (WP 5.2). */
export const INITIAL_GAME_STATE: Readonly<z.infer<typeof gameStateSchema>> = Object.freeze({
  schemaVersion: 1,
  turn: 1,
  phase: 'planning',
})

export type GameSetup = z.infer<typeof gameSetupSchema>
export type Force = z.infer<typeof forceSchema>
export type Role = z.infer<typeof roleSchema>
export type Participant = z.infer<typeof participantSchema>
export type Room = z.infer<typeof roomSchema>
export type Objectives = z.infer<typeof objectivesSchema>
export type Asset = z.infer<typeof assetSchema>
export type AssetMimeType = (typeof ASSET_MIME_TYPES)[number]
export type Announcement = z.infer<typeof announcementSchema>
export type GameState = z.infer<typeof gameStateSchema>
export type GamePhase = (typeof GAME_PHASES)[number]
export type Retired = z.infer<typeof retiredSchema>
export type Directory = z.infer<typeof directorySchema>

/** Decoded byte length of valid base64 text. */
export function base64DecodedLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return (data.length / 4) * 3 - padding
}
