// Keeping the draft in browser storage until it is published (WP 2.2, 2.3). The host chooses
// the key, so each server, or each mock deployment, has its own draft (mock-host's
// `names.storageKey`). Reading and writing go through a `DraftPersistence`, so tests inject one.
import {
  designFileSchema,
  forceSchema,
  gameSetupSchema,
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
})

const idList = z.array(slugSchema)

const storedDraftSchema = z.object({
  format: z.literal(DRAFT_FORMAT),
  schemaVersion: z.literal(1),
  design: draftDesignSchema,
  meta: z.object({
    retiredIds: z.object({ forces: idList, roles: idList, rooms: idList }),
    publishedRoleIds: idList,
  }),
})

export function serialiseDraft(draft: Draft): string {
  return JSON.stringify({
    format: DRAFT_FORMAT,
    schemaVersion: 1,
    design: draft.design,
    meta: draft.meta,
  })
}

/** Reads a saved draft; fails on text that is not one, without throwing. */
export function parseStoredDraft(text: string): Result<Draft, string> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'the saved draft is not valid JSON' }
  }
  const parsed = storedDraftSchema.safeParse(json)
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
