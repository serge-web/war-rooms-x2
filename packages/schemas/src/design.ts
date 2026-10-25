import { z } from 'zod'
import { LIMITS, isReservedRoleId, isoDateTimeSchema } from './common.ts'
import {
  assetSchema,
  forceSchema,
  gameSetupSchema,
  objectivesSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import type { GameSetup } from './documents.ts'
import type { Theme } from './theme.ts'

/**
 * The design export file (ADM-16): everything publishing provisions, in one versioned JSON
 * document that moves between mock and real backends. A `password` field on a role is
 * rejected, so a file carrying passwords cannot be imported (§3 rule 9).
 */
export const designFileSchema = z
  .object({
    format: z.literal('wrx1-design'),
    schemaVersion: z.literal(1),
    exportedAt: isoDateTimeSchema,
    game: gameSetupSchema.describe('The game setup document'),
    forces: z.array(forceSchema).describe('Force documents'),
    roles: z
      .array(
        roleSchema.extend({
          password: z.never().optional().describe('Never exported (ADM-16)'),
        }),
      )
      .describe('Role documents; a `password` field is rejected'),
    rooms: z.array(roomSchema).describe('Room documents'),
    objectives: z.array(objectivesSchema).describe('Objectives documents, at most one per force'),
    assets: z.array(assetSchema).describe('Asset documents'),
  })
  .describe('A complete game design, as exported and imported by the admin')

export type DesignFile = z.infer<typeof designFileSchema>

export interface DesignIssue {
  readonly severity: 'error' | 'warning'
  /** Where the problem is, e.g. `rooms[2].participants[0]`. */
  readonly path: string
  readonly message: string
}

export interface DesignCheckOptions {
  /** The admin's asset size limit; defaults to {@link LIMITS.assetDefaultBytes}. */
  readonly assetLimitBytes?: number
}

/**
 * Checks what single-document schemas cannot: unique ids, references that resolve, and the
 * SHOULD rules. Errors block publishing; warnings are shown to the admin.
 */
export function checkDesign(design: DesignFile, options: DesignCheckOptions = {}): DesignIssue[] {
  const issues: DesignIssue[] = []
  const error = (path: string, message: string) => issues.push({ severity: 'error', path, message })
  const warn = (path: string, message: string) =>
    issues.push({ severity: 'warning', path, message })

  const forceIds = uniqueIds('forces', design.forces, error)
  const roleIds = uniqueIds('roles', design.roles, error)
  uniqueIds('rooms', design.rooms, error)
  const assetIds = uniqueIds('assets', design.assets, error)

  const assetRef = (path: string, id: string | undefined) => {
    if (id !== undefined && !assetIds.has(id)) error(path, `unknown asset "${id}"`)
  }
  const themeRefs = (path: string, theme: Theme | undefined) => {
    assetRef(`${path}.logoAssetId`, theme?.logoAssetId)
    assetRef(`${path}.iconAssetId`, theme?.iconAssetId)
  }

  themeRefs('game.theme', design.game.theme)

  const umpires = design.forces.filter((f) => f.isUmpire)
  if (umpires.length > 1) {
    warn('forces', `${umpires.length} umpire forces; at most one is expected (ADM-4)`)
  }
  design.forces.forEach((force, i) => {
    assetRef(`forces[${i}].iconAssetId`, force.iconAssetId)
    themeRefs(`forces[${i}].theme`, force.theme)
  })

  design.roles.forEach((role, i) => {
    if (isReservedRoleId(role.id)) {
      error(`roles[${i}].id`, `"${role.id}" is reserved and cannot be a role id`)
    }
    if (!forceIds.has(role.forceId)) error(`roles[${i}].forceId`, `unknown force "${role.forceId}"`)
  })

  design.rooms.forEach((room, i) => {
    themeRefs(`rooms[${i}].theme`, room.theme)
    room.participants.forEach((p, j) => {
      const known = p.kind === 'force' ? forceIds : roleIds
      if (!known.has(p.id)) error(`rooms[${i}].participants[${j}]`, `unknown ${p.kind} "${p.id}"`)
    })
    if (room.participants.length === 0 && umpires.length === 0) {
      warn(`rooms[${i}].participants`, 'room has no participants')
    }
  })

  const objectiveForces = new Set<string>()
  design.objectives.forEach((o, i) => {
    if (!forceIds.has(o.forceId)) error(`objectives[${i}].forceId`, `unknown force "${o.forceId}"`)
    if (objectiveForces.has(o.forceId)) {
      error(`objectives[${i}].forceId`, `second objectives document for force "${o.forceId}"`)
    }
    objectiveForces.add(o.forceId)
  })

  const limit = options.assetLimitBytes ?? LIMITS.assetDefaultBytes
  design.assets.forEach((a, i) => {
    if (a.size > limit) warn(`assets[${i}].size`, `${a.size} bytes is over the ${limit}-byte limit`)
  })

  return issues
}

/**
 * Asset ids used by the game theme. These are the only assets anonymous users may read
 * (D20, NFR-21, §3 rule 15); every other asset node is whitelist-only.
 */
export function publicAssetIds(game: GameSetup): string[] {
  const ids = [game.theme.logoAssetId, game.theme.iconAssetId].filter(
    (id): id is string => id !== undefined,
  )
  return [...new Set(ids)]
}

function uniqueIds(
  collection: string,
  items: readonly { readonly id: string }[],
  error: (path: string, message: string) => void,
): Set<string> {
  const seen = new Set<string>()
  items.forEach((item, i) => {
    if (seen.has(item.id)) error(`${collection}[${i}].id`, `duplicate id "${item.id}"`)
    seen.add(item.id)
  })
  return seen
}
