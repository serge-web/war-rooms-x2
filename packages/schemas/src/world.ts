// Turns and the world state (SRD D7, D25, §3 rules 16–18): the map room's config, the world
// state its messages carry, and the assets in it. The turn state, `game-state`, is a PubSub
// document (documents.ts). Every schema here is exported as JSON Schema too (D26, P8:
// `pnpm json-schema`), so external reconcilers read the same shapes.
import { z } from 'zod'
import { LIMITS, idSchema, nameSchema } from './common.ts'

/** The room type of the game's one map room (§3 rule 18, ARC-5). */
export const MAP_ROOM_TYPE = 'map'

/**
 * A MIL-STD-2525 or APP-6 symbol identification code, as milsymbol reads it (PLY-57):
 *
 * - letter-based, 15 characters (2525B/C, APP-6 B/C): coding scheme, affiliation, battle
 *   dimension, status, function id (6), modifiers (2), country (2) and order of battle, with `-`
 *   or `*` for an unset position, e.g. `SFGPUCI----K---`;
 * - number-based, 20 digits (2525D, APP-6 D), or 30 with the 2525E extension.
 *
 * Fixed length and no alternation inside a repeat, so the check cannot backtrack.
 */
export const SIDC_PATTERN =
  /^(?:[SGWIOE][PUAFNSHGWMDLJK*-][A-Z*-][APCDXF*-][A-Z0-9*-]{8}[A-Z*-]{3}|[0-9]{20}|[0-9]{30})$/

export const sidcSchema = z
  .string()
  .regex(
    SIDC_PATTERN,
    'must be a MIL-STD-2525/APP-6 symbol code: 15 letter-based characters, or 20 or 30 digits',
  )
  .describe(
    'MIL-STD-2525/APP-6 symbol identification code (SIDC): 15 letter-based characters (2525C, APP-6 B/C) or 20 or 30 digits (2525D/E, APP-6 D)',
  )

/** A short free-text label: an asset's category or state. */
const labelSchema = z.string().trim().min(1).max(LIMITS.worldLabelChars)

/**
 * One asset in the world state, with the fixed fields of v1 (§3 rule 17); an admin-defined
 * asset schema is post-v1. Not the theme image assets of §3 (`assets:<id>` nodes).
 */
export const worldAssetSchema = z
  .object({
    id: idSchema.describe('The asset GUID; also its key in `assets` (§3 rules 1, 16)'),
    forceId: idSchema.describe('The force that owns the asset'),
    title: nameSchema.describe('Display name, e.g. "1st Armoured Squadron"'),
    category: labelSchema.describe('What kind of asset it is, e.g. "armour" or "frigate"'),
    sidc: sidcSchema,
    lat: z.number().min(-90).max(90).describe('Latitude, WGS 84 decimal degrees'),
    lon: z.number().min(-180).max(180).describe('Longitude, WGS 84 decimal degrees'),
    state: labelSchema.describe('Its condition in words, e.g. "operational" or "damaged"'),
    health: z.number().min(0).max(100).describe('Health, 0 (destroyed) to 100 (full)'),
    fuel: z.number().min(0).max(100).describe('Fuel, 0 (empty) to 100 (full)'),
  })
  .describe('A unit or platform on the map, with the fixed fields of v1 (§3 rule 17)')

export const turnNumberSchema = z
  .int()
  .min(1)
  .max(LIMITS.turnMax)
  .describe('The turn number, from 1 (D7)')

/**
 * The world state (§3 rule 16): the turn it describes, and every asset keyed by its GUID, not
 * an array, so later JSON Patch deltas have stable paths (§8).
 */
export const worldStateSchema = z
  .object({
    turn: turnNumberSchema.describe('The turn this state belongs to'),
    assets: z
      .record(idSchema, worldAssetSchema)
      .refine(
        (assets) => Object.keys(assets).length <= LIMITS.worldStateAssets,
        `at most ${LIMITS.worldStateAssets} assets`,
      )
      .refine(
        (assets) => Object.entries(assets).every(([key, asset]) => key === asset.id),
        'each asset is keyed by its own id',
      )
      .describe('Every asset, keyed by its GUID; each key is its asset’s `id`'),
  })
  .describe('The full world state: every asset with its position and status (D25)')

/**
 * The body of a map-room message: the full world state (D25). Clients accept it only from the
 * admin's real JID (§3 rule 3, PLY-58). Up to 500,000 bytes as a stanza (PLY-53).
 */
export const worldStateMessageBodySchema = z
  .object({
    type: z.literal('world-state'),
    schemaVersion: z.literal(1),
    content: worldStateSchema,
  })
  .describe('A world-state message in the map room, posted by the admin only')

export const latLonSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .describe('A point, WGS 84 decimal degrees')

/**
 * The map room's config, version 1 (ARC-5). The tile URL is the deployment's (NFR-9), not the
 * room's. A room with `{}` reads as the defaults: the map fits the assets.
 */
export const mapRoomConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    centre: latLonSchema.optional().describe('Where the map opens; unset, it fits the assets'),
    zoom: z
      .int()
      .min(0)
      .max(LIMITS.mapZoomMax)
      .optional()
      .describe('The zoom it opens at; unset, it fits the assets'),
  })
  .describe('Map room config: the opening view')

/** Reads a map room's config: version 1 as it is, and `{}` (no version) as the defaults. */
export const mapRoomConfigReader: z.ZodType<MapRoomConfig> = z.preprocess(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !('schemaVersion' in value)
      ? { ...value, schemaVersion: 1 }
      : value,
  mapRoomConfigSchema,
)

export type WorldAsset = z.infer<typeof worldAssetSchema>
export type WorldState = z.infer<typeof worldStateSchema>
export type WorldStateMessageBody = z.infer<typeof worldStateMessageBodySchema>
export type MapRoomConfig = z.infer<typeof mapRoomConfigSchema>

/**
 * The fixed participants of the map room (§3 rule 18, product owner Nov 4, 2026): every force as
 * a read entry, in the forces' order. The White Force's writers still write, under rule 4.
 */
export function mapParticipants(
  forces: readonly { readonly id: string; readonly order: number }[],
): { kind: 'force'; id: string; access: 'read' }[] {
  return [...forces]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => ({ kind: 'force' as const, id: f.id, access: 'read' as const }))
}

/** Whether a room's participants are the map room's fixed set, in any order. */
export function hasMapParticipants(
  room: { readonly participants: readonly { kind: string; id: string; access: string }[] },
  forces: readonly { readonly id: string; readonly order: number }[],
): boolean {
  const want = new Set(mapParticipants(forces).map((p) => `${p.kind}:${p.id}:${p.access}`))
  const have = room.participants.map((p) => `${p.kind}:${p.id}:${p.access}`)
  return have.length === want.size && have.every((key) => want.has(key))
}
