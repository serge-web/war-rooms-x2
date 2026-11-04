import { z } from 'zod'
import { ANONYMOUS_LIKE_NAME, LIMITS, isReservedLoginName, isoDateTimeSchema } from './common.ts'
import {
  assetSchema,
  forceSchema,
  gameSetupSchema,
  objectivesSchema,
  retiredSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import type { GameSetup } from './documents.ts'
import type { Theme } from './theme.ts'
import {
  TEMPLATE_LIMITS,
  chatRoomConfigSchema,
  templateFields,
  templateSchema,
} from './template.ts'
import type { Template } from './template.ts'
import { MAP_ROOM_TYPE, hasMapParticipants, mapParticipants, mapRoomConfigReader } from './world.ts'

/** The design file's current `schemaVersion`: 2 since GUID ids (§3 rule 1, WP 3.5). */
export const DESIGN_FILE_VERSION = 2

/**
 * The design export file (ADM-16): everything publishing provisions, in one versioned JSON
 * document that moves between mock and real backends. A `password` field on a role is
 * rejected, so a file carrying passwords cannot be imported (§3 rule 9). Version 1 files, from
 * before GUID ids, are read by `readDesignFile` (legacy.ts), which converts them.
 */
export const designFileSchema = z
  .object({
    format: z.literal('wrx1-design'),
    schemaVersion: z.literal(DESIGN_FILE_VERSION),
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
    retired: z
      .array(retiredSchema)
      .describe(
        'The last names of deleted forces and roles that were published, kept so old messages show them (§3 rule 1)',
      ),
    templates: z
      .array(templateSchema)
      .default([])
      .describe(
        'Message templates (Annex A); a file from before templates has none. Each locks when a published room makes it available (TPL-4)',
      ),
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
  const roomIds = uniqueIds('rooms', design.rooms, error)
  const assetIds = uniqueIds('assets', design.assets, error)

  // §3 rule 1: ids are never reused, and a retired login name is never given to another role.
  uniqueIds('retired', design.retired, error)
  const retiredLogins = new Set<string>()
  design.retired.forEach((r, i) => {
    if (forceIds.has(r.id) || roleIds.has(r.id) || roomIds.has(r.id) || assetIds.has(r.id)) {
      error(`retired[${i}].id`, `"${r.id}" belongs to a deleted ${r.kind} and cannot be reused`)
    }
    if (r.loginName !== undefined) retiredLogins.add(r.loginName)
  })

  const assetRef = (path: string, id: string | undefined) => {
    if (id !== undefined && !assetIds.has(id)) error(path, `unknown asset "${id}"`)
  }
  const themeRefs = (path: string, theme: Theme | undefined) => {
    assetRef(`${path}.logoAssetId`, theme?.logoAssetId)
    assetRef(`${path}.iconAssetId`, theme?.iconAssetId)
  }

  themeRefs('game.theme', design.game.theme)

  // ADM-4: exactly one force carries the umpire flag, the White Force, which the admin belongs
  // to as umpire. Live play takes the first in order if there are several.
  const umpires = design.forces.filter((f) => f.isUmpire)
  if (umpires.length > 1) {
    warn(
      'forces',
      `${umpires.length} forces carry the umpire flag; exactly one is expected (ADM-4)`,
    )
  } else if (umpires.length === 0 && design.forces.length > 0) {
    warn(
      'forces',
      'no force carries the umpire flag; exactly one, the White Force, is expected (ADM-4)',
    )
  }
  design.forces.forEach((force, i) => {
    assetRef(`forces[${i}].iconAssetId`, force.iconAssetId)
    themeRefs(`forces[${i}].theme`, force.theme)
  })

  const logins = new Set<string>()
  design.roles.forEach((role, i) => {
    const login = role.loginName
    if (isReservedLoginName(login)) {
      error(
        `roles[${i}].loginName`,
        ANONYMOUS_LIKE_NAME.test(login)
          ? `"${login}" looks like an anonymous session and cannot be a login name`
          : `"${login}" is reserved and cannot be a login name`,
      )
    }
    if (logins.has(login)) {
      error(`roles[${i}].loginName`, `another role has the login name "${login}"`)
    }
    logins.add(login)
    if (retiredLogins.has(login)) {
      error(
        `roles[${i}].loginName`,
        `"${login}" was a deleted role's login name and cannot be given to another role`,
      )
    }
    if (!forceIds.has(role.forceId)) error(`roles[${i}].forceId`, `unknown force "${role.forceId}"`)
    // The admin's messages are labelled "Umpire" (SC-5); a role of that name would look the same.
    if (role.name.trim().toLowerCase() === 'umpire') {
      warn(
        `roles[${i}].name`,
        'a role named "Umpire" looks like the admin, who plays as the umpire',
      )
    }
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

  checkMapRoom(design, error)

  const objectiveForces = new Set<string>()
  design.objectives.forEach((o, i) => {
    if (!forceIds.has(o.forceId)) error(`objectives[${i}].forceId`, `unknown force "${o.forceId}"`)
    if (objectiveForces.has(o.forceId)) {
      error(`objectives[${i}].forceId`, `second objectives document for force "${o.forceId}"`)
    }
    objectiveForces.add(o.forceId)
  })

  checkTemplates(design, forceIds, roleIds, error, warn)

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

/**
 * Templates (Annex A): unique GUIDs no other entity has, at most the node's item limit, force
 * filters naming known forces; and each chat room's config version 2 naming known forces, roles
 * and templates (TPL-2). A room config that is neither version 1 nor 2 is an error.
 */
function checkTemplates(
  design: DesignFile,
  forceIds: ReadonlySet<string>,
  roleIds: ReadonlySet<string>,
  error: (path: string, message: string) => void,
  warn: (path: string, message: string) => void,
): void {
  const templateIds = uniqueIds('templates', design.templates, error)
  if (design.templates.length > TEMPLATE_LIMITS.templates) {
    error(
      'templates',
      `${design.templates.length} templates; the limit is ${TEMPLATE_LIMITS.templates}`,
    )
  }
  const others = new Set([
    ...forceIds,
    ...roleIds,
    ...design.rooms.map((r) => r.id),
    ...design.assets.map((a) => a.id),
    ...design.retired.map((r) => r.id),
  ])
  design.templates.forEach((template, i) => {
    if (others.has(template.id)) {
      error(`templates[${i}].id`, `"${template.id}" is another entity's id`)
    }
    for (const field of templateFields(template.schema)) {
      if (field.forceFilter !== undefined && !forceIds.has(field.forceFilter)) {
        warn(
          `templates[${i}].schema.properties.${field.name}`,
          `the role picker's force filter names an unknown force "${field.forceFilter}", so it offers no role`,
        )
      }
    }
  })
  design.rooms.forEach((room, i) => {
    if (room.roomType !== 'chat') return
    const version = room.config.schemaVersion
    if (version === undefined || version === 1) return
    const parsed = chatRoomConfigSchema.safeParse(room.config)
    if (!parsed.success) {
      error(`rooms[${i}].config`, `not a valid chat room config: ${z.prettifyError(parsed.error)}`)
      return
    }
    parsed.data.templates.forEach((entry, j) => {
      const known = entry.kind === 'force' ? forceIds : roleIds
      if (!known.has(entry.id)) {
        error(`rooms[${i}].config.templates[${j}]`, `unknown ${entry.kind} "${entry.id}"`)
      }
      entry.templateIds.forEach((id, k) => {
        if (!templateIds.has(id)) {
          error(`rooms[${i}].config.templates[${j}].templateIds[${k}]`, `unknown template "${id}"`)
        }
      })
    })
    if (!parsed.data.freeText && parsed.data.templates.every((e) => e.templateIds.length === 0)) {
      warn(
        `rooms[${i}].config`,
        'free text is off and the room offers no template, so nobody can post in it',
      )
    }
  })
}

/**
 * §3 rule 18: at most one map room (the draft always has exactly one; a design without one, such
 * as one from before Phase 5, is still valid), its participants fixed to every force as a read
 * entry, and its config a map room config.
 */
function checkMapRoom(design: DesignFile, error: (path: string, message: string) => void): void {
  let seen = false
  design.rooms.forEach((room, i) => {
    if (room.roomType !== MAP_ROOM_TYPE) return
    if (seen) {
      error(`rooms[${i}].roomType`, 'a game has one map room (§3 rule 18); this is a second')
    }
    seen = true
    if (!hasMapParticipants(room, design.forces)) {
      error(
        `rooms[${i}].participants`,
        'the map room’s participants are fixed: every force, with write access (§3 rule 18)',
      )
    }
    const config = mapRoomConfigReader.safeParse(room.config)
    if (!config.success) {
      error(`rooms[${i}].config`, `not a valid map room config: ${z.prettifyError(config.error)}`)
    }
  })
}

/** The name a new map room is given; the admin may rename it. */
export const MAP_ROOM_NAME = 'Map'

/**
 * The design with exactly one map room as far as it can tell (§3 rule 18): every map room's
 * participants set to the fixed set (every force, write), and a new map room, named
 * {@link MAP_ROOM_NAME} with the id `newId()` gives, added last when there is none. The same
 * design is returned when nothing changes. A second map room is left for `checkDesign` to report.
 */
export function withMapRoom(design: DesignFile, newId: () => string): DesignFile {
  const participants = mapParticipants(design.forces)
  let changed = false
  const rooms = design.rooms.map((room) => {
    if (room.roomType !== MAP_ROOM_TYPE || hasMapParticipants(room, design.forces)) return room
    changed = true
    return { ...room, participants }
  })
  if (!rooms.some((r) => r.roomType === MAP_ROOM_TYPE)) {
    changed = true
    rooms.push({
      schemaVersion: 1,
      id: newId(),
      name: MAP_ROOM_NAME,
      roomType: MAP_ROOM_TYPE,
      participants,
      config: {},
      order: rooms.reduce((max, r) => Math.max(max, r.order + 1), 0),
    })
  }
  return changed ? { ...design, rooms } : design
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

/**
 * Templates the design's rooms make available: named by any entry of a `chat` room's config
 * version 2 (TPL-2). Publishing the design locks these (TD6, provisional answer 2).
 */
export function templatesInRooms(design: Pick<DesignFile, 'rooms'>): Set<string> {
  const ids = new Set<string>()
  for (const room of design.rooms) {
    if (room.roomType !== 'chat') continue
    const parsed = chatRoomConfigSchema.safeParse(room.config)
    if (!parsed.success) continue
    for (const entry of parsed.data.templates) for (const id of entry.templateIds) ids.add(id)
  }
  return ids
}

/**
 * The design with each template's lock as publishing it leaves the server (TD6, TPL-4,
 * provisional answer 2): the server's `lockedAt` if the published template has one, else the
 * design's, else, for a template a room makes available, the design's export time (planning
 * keeps no clock, as with `retired` records). A lock is never taken away. The same design is
 * returned when nothing changes.
 */
export function withTemplateLocks(
  design: DesignFile,
  published: readonly Pick<Template, 'id' | 'lockedAt'>[],
): DesignFile {
  const offered = templatesInRooms(design)
  const templates = design.templates.map((template) => {
    const lockedAt =
      published.find((p) => p.id === template.id)?.lockedAt ??
      template.lockedAt ??
      (offered.has(template.id) ? design.exportedAt : undefined)
    return lockedAt === template.lockedAt ? template : { ...template, lockedAt }
  })
  const changed = templates.some((t, i) => t !== design.templates[i])
  return changed ? { ...design, templates } : design
}
