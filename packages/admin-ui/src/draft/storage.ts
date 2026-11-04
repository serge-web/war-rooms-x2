// Keeping the draft in browser storage until it is published (WP 2.2, 2.3). The host chooses
// the key, so each server, or each mock deployment, has its own draft (mock-host's
// `names.storageKey`). Reading and writing go through a `DraftPersistence`, so tests inject one.
import {
  DESIGN_FILE_VERSION,
  convertDesignV1,
  designFileSchema,
  designFileV1Schema,
  forceSchema,
  gameSetupSchema,
  idSchema,
  isoDateTimeSchema,
  objectivesSchema,
  participantSchema,
  roleSchema,
  roomSchema,
  slugSchema,
} from '@wrx/schemas'
import type { DesignFile, Result } from '@wrx/schemas'
import { z } from 'zod'
import type { Draft, DraftMeta } from './draft.ts'
import { draftFromDesign } from './draft.ts'

export const DRAFT_FORMAT = 'wrx1-admin-draft'

/**
 * A draft is saved as it is being edited, so it may break rules that publishing enforces: an
 * empty name, a briefing over the limit, a duplicate participant. This schema checks the
 * structure only; `validateDraft` reports the rest.
 */
const draftDesignSchema = designFileSchema.extend({
  game: gameSetupSchema.extend({
    name: z.string(),
    description: z.string(),
    briefing: z.string(),
  }),
  forces: z.array(forceSchema.extend({ name: z.string(), colour: z.string() })),
  roles: z.array(roleSchema.extend({ name: z.string(), password: z.never().optional() })),
  rooms: z.array(roomSchema.extend({ name: z.string(), participants: z.array(participantSchema) })),
  objectives: z.array(objectivesSchema.extend({ markdown: z.string() })),
  // A template being edited may be outside the WRX profile (the raw editor, WP 4.3): its
  // structure only; `validateDraft` reports the profile's issues.
  templates: z
    .array(
      z.object({
        schemaVersion: z.literal(1),
        id: idSchema,
        name: z.string(),
        description: z.string().optional(),
        schema: z.record(z.string(), z.unknown()),
        uiSchema: z.record(z.string(), z.unknown()).optional(),
        createdAt: isoDateTimeSchema,
        lockedAt: isoDateTimeSchema.optional(),
      }),
    )
    .default([]),
})

const idList = z.array(idSchema)

/** The stored draft's version: 2 since GUID ids (§3 rule 1, WP 3.5). */
export const DRAFT_VERSION = 2

const storedDraftSchema = z.object({
  format: z.literal(DRAFT_FORMAT),
  schemaVersion: z.literal(DRAFT_VERSION),
  design: draftDesignSchema,
  meta: z.object({ publishedRoleIds: idList, publishedForceIds: idList }),
})

/**
 * A draft saved before GUID ids: a version 1 design, possibly mid-edit, and the slug ids it had
 * retired or published. Its design is checked with the same leniency as today's.
 */
const v1Lenient = designFileV1Schema.shape
const storedDraftV1Schema = z.object({
  format: z.literal(DRAFT_FORMAT),
  schemaVersion: z.literal(1),
  design: designFileV1Schema.extend({
    game: v1Lenient.game.extend({
      name: z.string(),
      description: z.string(),
      briefing: z.string(),
    }),
    forces: z.array(v1Lenient.forces.element.extend({ name: z.string(), colour: z.string() })),
    roles: z.array(v1Lenient.roles.element.extend({ name: z.string() })),
    rooms: z.array(v1Lenient.rooms.element.extend({ name: z.string() })),
    objectives: z.array(v1Lenient.objectives.element.extend({ markdown: z.string() })),
  }),
  meta: z.object({ publishedRoleIds: z.array(slugSchema) }).loose(),
})

export function serialiseDraft(draft: Draft): string {
  return JSON.stringify({
    format: DRAFT_FORMAT,
    schemaVersion: DRAFT_VERSION,
    design: draft.design,
    meta: draft.meta,
  })
}

/**
 * Converts a draft saved before GUID ids the way an import converts a version 1 file (ADM-16):
 * new GUIDs, references rewritten, each role's old id its login name. Roles it had published
 * stay published, by their new ids, so their login names stay fixed while the server still has
 * their accounts; their forces count as published too.
 */
function migrateDraftV1(stored: z.infer<typeof storedDraftV1Schema>): Draft {
  // Names may be empty mid-edit: the conversion only rewrites ids.
  const { design, ids } = convertDesignV1(stored.design)
  const publishedRoleIds = stored.meta.publishedRoleIds.flatMap((old) => {
    const id = ids.roles.get(old)
    return id === undefined ? [] : [id]
  })
  const publishedForceIds = [
    ...new Set(design.roles.filter((r) => publishedRoleIds.includes(r.id)).map((r) => r.forceId)),
  ]
  return draftFromDesign(design, { publishedRoleIds, publishedForceIds })
}

/**
 * A draft saved while design files were version 2 holds a version 2 design: version 3 without a
 * world state (WP 5.6), so it is read as version 3. A world state is never part of the design
 * draft; the admin's world-state draft is kept apart (ADM-45).
 */
function withDesignVersion3(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || !('design' in json)) return json
  const design = json.design
  if (typeof design !== 'object' || design === null || !('schemaVersion' in design)) return json
  if (design.schemaVersion !== 2 || 'worldState' in design) return json
  return { ...json, design: { ...design, schemaVersion: DESIGN_FILE_VERSION } }
}

/** Reads a saved draft; fails on text that is not one, without throwing. */
export function parseStoredDraft(text: string): Result<Draft, string> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'the saved draft is not valid JSON' }
  }
  if (typeof json === 'object' && json !== null && 'schemaVersion' in json) {
    if (json.schemaVersion === 1) {
      const old = storedDraftV1Schema.safeParse(json)
      if (old.success) return { ok: true, value: migrateDraftV1(old.data) }
      return {
        ok: false,
        error: `the saved draft, from before GUID ids, is not readable: ${z.prettifyError(old.error)}`,
      }
    }
  }
  const parsed = storedDraftSchema.safeParse(withDesignVersion3(json))
  if (!parsed.success) {
    return { ok: false, error: `the saved draft is not readable: ${z.prettifyError(parsed.error)}` }
  }
  const design: DesignFile = parsed.data.design
  const meta: DraftMeta = parsed.data.meta
  return { ok: true, value: draftFromDesign(design, meta) }
}

/** Where a draft is kept. `load` returns undefined when nothing is saved. */
export interface DraftPersistence {
  load(): string | undefined
  save(text: string): void
  clear(): void
}

/** The parts of `Storage` used, so tests can pass a stub. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * A draft in `localStorage` (or `storage`) under `key`. Storage errors (quota, a blocked
 * storage) are thrown to the store, which reports them.
 */
export function browserDraftPersistence(key: string, storage?: StorageLike): DraftPersistence {
  const target = () => storage ?? globalThis.localStorage
  return {
    load: () => target().getItem(key) ?? undefined,
    save: (text) => {
      target().setItem(key, text)
    },
    clear: () => {
      target().removeItem(key)
    },
  }
}

/** A draft kept in memory: for tests and for hosts without storage. */
export function memoryDraftPersistence(initial?: string): DraftPersistence {
  const box = { text: initial }
  return {
    load: () => box.text,
    save: (text) => {
      box.text = text
    },
    clear: () => {
      box.text = undefined
    },
  }
}
