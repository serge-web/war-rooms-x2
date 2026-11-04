// Design files from before GUID ids (ADM-16, §3 rule 1, WP 3.5): `schemaVersion: 1`, where the
// id of every force, role, room and asset was a slug and a role's id was also its login name.
// Import converts one: every entity gets a new GUID, every reference follows, and each role
// keeps its old id as its login name, so typed logins and the credentials sheet do not change.
// A game already published on a server with the old ids is moved by export, import (this),
// reset (ADM-15) and publish; nothing migrates a server in place (merge record N3).
import { z } from 'zod'
import { newEntityId, slugSchema } from './common.ts'
import type { RandomSource } from './common.ts'
import { DESIGN_FILE_VERSION, designFileSchema } from './design.ts'
import type { DesignFile } from './design.ts'
import {
  assetFieldsSchema,
  assetSizeError,
  assetSizeMatches,
  forceSchema,
  gameSetupSchema,
  objectivesSchema,
  participantSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import type { Result } from './parse.ts'
import { themeSchema } from './theme.ts'
import type { Theme } from './theme.ts'

const v1Theme = themeSchema.extend({
  logoAssetId: slugSchema.optional(),
  iconAssetId: slugSchema.optional(),
})

const v1Participant = participantSchema.extend({ id: slugSchema })

/** A version 1 design file: today's documents with slug ids, and no `retired` records. */
export const designFileV1Schema = z.object({
  format: z.literal('wrx1-design'),
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  game: gameSetupSchema.extend({ theme: v1Theme }),
  forces: z.array(
    forceSchema.extend({
      id: slugSchema,
      iconAssetId: slugSchema.optional(),
      theme: v1Theme.optional(),
    }),
  ),
  roles: z.array(
    roleSchema.omit({ loginName: true }).extend({
      id: slugSchema,
      forceId: slugSchema,
      password: z.never().optional(),
    }),
  ),
  rooms: z.array(
    roomSchema.extend({
      id: slugSchema,
      participants: z.array(v1Participant),
      theme: v1Theme.optional(),
    }),
  ),
  objectives: z.array(objectivesSchema.extend({ forceId: slugSchema })),
  assets: z.array(
    assetFieldsSchema.extend({ id: slugSchema }).refine(assetSizeMatches, assetSizeError()),
  ),
})

export type DesignFileV1 = z.infer<typeof designFileV1Schema>

export interface ConvertOptions {
  /** Where new ids come from; tests pass a counter. Default `newEntityId()`. */
  readonly newId?: () => string
  readonly random?: RandomSource
}

/** The old id of each converted entity, by kind, mapped to its new GUID. */
export interface IdMap {
  readonly forces: ReadonlyMap<string, string>
  readonly roles: ReadonlyMap<string, string>
  readonly rooms: ReadonlyMap<string, string>
  readonly assets: ReadonlyMap<string, string>
}

/**
 * Converts a version 1 design: a GUID for every force, role, room and asset, every reference
 * rewritten (a role's force, participant entries, objectives, a force's icon, the game, force
 * and room themes' logo and icon), and each role's old id kept as its login name. A reference to
 * an id the file does not define is kept as a new GUID too, so `checkDesign` still reports it
 * as unknown rather than the conversion hiding it.
 */
export function convertDesignV1(
  v1: DesignFileV1,
  options: ConvertOptions = {},
): { readonly design: DesignFile; readonly ids: IdMap } {
  const newId = options.newId ?? (() => newEntityId(options.random))
  const table = () => {
    const map = new Map<string, string>()
    return {
      map,
      of: (old: string): string => {
        let id = map.get(old)
        if (id === undefined) {
          id = newId()
          map.set(old, id)
        }
        return id
      },
    }
  }
  const forces = table()
  const roles = table()
  const rooms = table()
  const assets = table()
  // Defined entities first, in file order, so ids are given in a predictable order.
  for (const f of v1.forces) forces.of(f.id)
  for (const r of v1.roles) roles.of(r.id)
  for (const r of v1.rooms) rooms.of(r.id)
  for (const a of v1.assets) assets.of(a.id)

  const theme = (t: z.infer<typeof v1Theme>): Theme => ({
    tokens: t.tokens,
    ...(t.logoAssetId === undefined ? {} : { logoAssetId: assets.of(t.logoAssetId) }),
    ...(t.iconAssetId === undefined ? {} : { iconAssetId: assets.of(t.iconAssetId) }),
  })

  const design: DesignFile = {
    format: 'wrx1-design',
    schemaVersion: DESIGN_FILE_VERSION,
    exportedAt: v1.exportedAt,
    game: { ...v1.game, theme: theme(v1.game.theme) },
    forces: v1.forces.map((f) => {
      const { iconAssetId, theme: forceTheme, ...rest } = f
      return {
        ...rest,
        id: forces.of(f.id),
        ...(iconAssetId === undefined ? {} : { iconAssetId: assets.of(iconAssetId) }),
        ...(forceTheme === undefined ? {} : { theme: theme(forceTheme) }),
      }
    }),
    roles: v1.roles.map((r) => {
      const { password: _password, ...rest } = r
      return { ...rest, id: roles.of(r.id), loginName: r.id, forceId: forces.of(r.forceId) }
    }),
    rooms: v1.rooms.map((r) => {
      const { theme: roomTheme, ...rest } = r
      return {
        ...rest,
        id: rooms.of(r.id),
        participants: r.participants.map((p) => ({
          ...p,
          id: p.kind === 'force' ? forces.of(p.id) : roles.of(p.id),
        })),
        ...(roomTheme === undefined ? {} : { theme: theme(roomTheme) }),
      }
    }),
    objectives: v1.objectives.map((o) => ({ ...o, forceId: forces.of(o.forceId) })),
    assets: v1.assets.map((a) => ({ ...a, id: assets.of(a.id) })),
    retired: [],
    templates: [],
  }
  return {
    design,
    ids: { forces: forces.map, roles: roles.map, rooms: rooms.map, assets: assets.map },
  }
}

export interface ReadDesign {
  readonly design: DesignFile
  /** Set when the file was version 1 and was converted. */
  readonly converted?: IdMap
}

/**
 * Reads a design file of any supported version (ADM-16): version 2 as it is, version 1 through
 * `convertDesignV1`. Fails with the schema's issues; a file with a `password` is refused.
 */
export function readDesignFile(
  json: unknown,
  options: ConvertOptions = {},
): Result<ReadDesign, readonly z.core.$ZodIssue[]> {
  const version =
    typeof json === 'object' && json !== null && 'schemaVersion' in json
      ? json.schemaVersion
      : undefined
  if (version === 1) {
    const old = designFileV1Schema.safeParse(json)
    if (!old.success) return { ok: false, error: old.error.issues }
    const { design, ids } = convertDesignV1(old.data, options)
    const checked = designFileSchema.safeParse(design)
    if (!checked.success) return { ok: false, error: checked.error.issues }
    return { ok: true, value: { design: checked.data, converted: ids } }
  }
  const parsed = designFileSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: parsed.error.issues }
  return { ok: true, value: { design: parsed.data } }
}
