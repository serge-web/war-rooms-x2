import { z } from 'zod'
import {
  LIMITS,
  hexColourSchema,
  isoDateTimeSchema,
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
      .describe('Incremented on each publish that changes the design; keys saved layouts (PLY-5)'),
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
    id: slugSchema,
    name: nameSchema,
    colour: hexColourSchema.describe('Colour for message authors; not a theme token (§3 rule 13)'),
    iconAssetId: slugSchema.optional().describe('Id of an `assets:<id>` node'),
    isUmpire: z.boolean().describe('Umpire-force roles are members of every room (D8)'),
    order: orderSchema,
    theme: themeSchema.optional().describe('Styles the force panel only (D19)'),
  })
  .describe('A side in the game')

/** `roles:<roleId>`. The role id is also the XMPP account's localpart. Never holds a password. */
export const roleSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: slugSchema.describe('Role id and login id: the XMPP localpart'),
    name: nameSchema,
    forceId: slugSchema.describe("Id of the role's force"),
    isObserver: z.boolean().describe('Observers read but never post, in all their rooms (D8)'),
    order: orderSchema,
  })
  .describe('A player position; one XMPP account')

export const participantSchema = z
  .object({
    kind: z.enum(['force', 'role']),
    id: slugSchema.describe('Force or role id'),
    access: z.enum(['write', 'read']).describe('Read-only entries join as MUC visitors'),
  })
  .describe('A room participant entry (§3 rule 4)')

/** `rooms:<roomId>` */
export const roomSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: slugSchema,
    name: nameSchema,
    roomType: slugSchema.describe('Room type id from the registry (v1: chat)'),
    participants: z
      .array(participantSchema)
      .refine(
        (entries) => new Set(entries.map((p) => `${p.kind}:${p.id}`)).size === entries.length,
        'each force or role may appear only once',
      )
      .describe('Mixed force and role entries; umpire-force roles are added implicitly'),
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
    forceId: slugSchema.describe('Id of the force these objectives belong to'),
    markdown: z.string().max(LIMITS.objectivesChars).describe('Objectives as Markdown'),
    updatedAt: isoDateTimeSchema.describe(
      "When this version was written. The node holds one item per author, because a publisher cannot overwrite another publisher's item; readers take the newest (§3 rule 14)",
    ),
  })
  .describe("A force's objectives; confidential to that force, umpires and admin")

export const ASSET_MIME_TYPES = Object.freeze(['image/png', 'image/webp', 'image/svg+xml'] as const)

/** `assets:<assetId>` (§3 rule 12). SVG is sanitised on upload and shown only via `<img>`. */
export const assetSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: slugSchema,
    mimeType: z.enum(ASSET_MIME_TYPES),
    size: z.int().min(1).max(LIMITS.assetHardBytes).describe('Decoded size in bytes'),
    sha256: sha256Schema,
    data: z.base64().describe('The image, base64-encoded'),
  })
  .refine((a) => base64DecodedLength(a.data) === a.size, {
    message: 'size does not match the decoded data',
    path: ['size'],
  })
  .describe('An image used by themes')

/** One item of the `announcements` node (PLY-37). */
export const announcementSchema = z
  .object({
    schemaVersion: z.literal(1),
    text: z.string().trim().min(1).max(LIMITS.announcementTextChars).describe('Plain text'),
    postedAt: isoDateTimeSchema.describe("Admin's clock when posted; display only"),
  })
  .describe('An out-of-game announcement from the admin')

/** `game-state`: reserved for the turn model; created empty in v1 (§8). */
export const gameStateSchema = z
  .object({
    schemaVersion: z.literal(1),
  })
  .describe('Reserved for turns and the game clock')

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

/** Decoded byte length of valid base64 text. */
export function base64DecodedLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return (data.length / 4) * 3 - padding
}
