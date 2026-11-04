// Design export and import (ADM-16): the draft as a versioned JSON file, with no passwords. The
// draft never holds a password, and the export strips any `password` field all the same; an
// import is checked with `designFileSchema` (which refuses a `password` field) and `checkDesign`.
// The file also carries a world state (WP 5.6): the host passes the admin's world-state draft, or
// the latest published state, to export, and an import hands the file's back as `worldState`, for
// the host to keep as the admin's world-state draft. The design draft never holds one.
import { MAP_ROOM_TYPE, checkDesign, readDesignFile } from '@wrx/schemas'
import type { DesignFile, DesignIssue, Result, WorldState } from '@wrx/schemas'
import type { Draft } from '../draft/index.ts'
import { createDraft, draftFromDesign, toDesignFile } from '../draft/index.ts'
import { formatPath } from '../draft/index.ts'

/**
 * The export file's text and a file name for it, with `worldState` when one is given (ADM-16):
 * the admin's world-state draft if this browser holds one, otherwise the latest published state.
 */
export function exportDesign(
  draft: Draft,
  now: Date = new Date(),
  worldState?: WorldState,
): { name: string; text: string } {
  const design = toDesignFile(draft, now)
  const clean: DesignFile = {
    ...design,
    ...(worldState === undefined ? {} : { worldState }),
    roles: design.roles.map((role) => {
      const { password: _password, ...rest } = role as typeof role & { password?: unknown }
      return rest
    }),
  }
  const slug = design.game.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const stamp = now.toISOString().slice(0, 10)
  return {
    name: `${slug === '' ? 'game' : slug}-design-${stamp}.json`,
    text: `${JSON.stringify(clean, null, 2)}\n`,
  }
}

/**
 * The world state for an export, and where it came from (ADM-16): the admin's draft, the latest
 * published state, none published, or none because the published state could not be read (the
 * map room did not answer in time, or could not be joined). The last is never silent: the export
 * says the file holds no world state, and why (WP 5.7 review).
 */
export type WorldStateForExport =
  | { readonly source: 'draft'; readonly state: WorldState }
  | { readonly source: 'published'; readonly state: WorldState }
  | { readonly source: 'none' }
  | { readonly source: 'unavailable'; readonly reason: string }

/**
 * The host's side of the world state in a design file (ADM-16, WP 5.6): the admin's world-state
 * draft lives in the browser, apart from the design draft, and the published state on the server.
 */
export interface WorldStateTransfer {
  /**
   * The world state to export for the game whose map room is `mapRoomId`: the admin's draft if
   * this browser holds one, otherwise the latest published state, otherwise none, saying which.
   */
  forExport(mapRoomId: string): Promise<WorldStateForExport>
  /**
   * Keeps an imported world state as the admin's world-state draft of that game, to be published
   * by the admin (ADM-45). Returns why it could not be kept, if it could not.
   */
  importDraft(mapRoomId: string, state: WorldState): string | undefined
}

/** Most bytes an import may be; designs with large assets stay well under it. */
export const IMPORT_LIMIT_BYTES = 20_000_000

/** A design import: the new draft, its warnings, and the file's world state if it had one. */
export interface ImportedDesign {
  readonly draft: Draft
  readonly warnings: readonly DesignIssue[]
  /**
   * The file's world state and the imported design's map room (§3 rule 18), for the host to keep
   * as the admin's world-state draft of that game (ADM-16, ADM-45). Undefined when the file has
   * none, e.g. a version 1 or 2 file.
   */
  readonly worldState?: { readonly mapRoomId: string; readonly state: WorldState } | undefined
}

/** The id of a draft's map room; the draft always has one (§3 rule 18). */
export function mapRoomIdOf(draft: Draft): string | undefined {
  return draft.design.rooms.find((r) => r.roomType === MAP_ROOM_TYPE)?.id
}

/**
 * Reads an export. On success, a draft over the imported design that keeps the current draft's
 * retired and published ids (they describe the server, not the file), any warnings, and the
 * file's world state. On failure, the issues that block it.
 */
export function importDesign(
  text: string,
  current: Draft,
): Result<ImportedDesign, readonly DesignIssue[]> {
  if (text.length > IMPORT_LIMIT_BYTES) {
    return { ok: false, error: [{ severity: 'error', path: '', message: 'the file is too large' }] }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: [{ severity: 'error', path: '', message: 'the file is not JSON' }] }
  }
  // A file from before GUID ids is converted (ADM-16): new ids, each old role id a login name.
  const parsed = readDesignFile(json)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error.map((issue) => ({
        severity: 'error' as const,
        path: formatPath(issue.path),
        message:
          issue.path.at(-1) === 'password'
            ? 'the file holds a password; designs never carry passwords (ADM-16)'
            : issue.message,
      })),
    }
  }
  const design = parsed.value.design
  const issues = checkDesign(design)
  const errors = issues.filter((i) => i.severity === 'error')
  if (errors.length > 0) return { ok: false, error: errors }
  const converted: DesignIssue[] =
    parsed.value.converted === undefined
      ? []
      : [
          {
            severity: 'warning',
            path: '',
            message:
              'This file is from before GUID ids: every force, role, room and asset has a new id, and each role keeps its old id as its login name. A game already published from it is moved by reset, then publish; its room history is not kept (ADM-16).',
          },
        ]
  const draft = draftFromDesign(design, current.meta)
  const mapRoomId = mapRoomIdOf(draft)
  return {
    ok: true,
    value: {
      draft,
      warnings: [...converted, ...issues.filter((i) => i.severity === 'warning')],
      worldState:
        design.worldState === undefined || mapRoomId === undefined
          ? undefined
          : { mapRoomId, state: design.worldState },
    },
  }
}

/**
 * An empty design (the White Force only) in place of the draft, e.g. to design a game from
 * nothing on the mock, whose draft starts as its demo game (SC-1). Like an import, it keeps the
 * current draft's retired and published ids: they describe the server, not the design.
 */
export function newDesign(current: Draft, now: Date = new Date()): Draft {
  return { ...createDraft({ name: 'New exercise', now }), meta: current.meta }
}
