// Design export and import (ADM-16): the draft as a versioned JSON file, with no passwords. The
// draft never holds a password, and the export strips any `password` field all the same; an
// import is checked with `designFileSchema` (which refuses a `password` field) and `checkDesign`.
import { checkDesign, designFileSchema } from '@wrx/schemas'
import type { DesignFile, DesignIssue, Result } from '@wrx/schemas'
import type { Draft } from '../draft/index.ts'
import { draftFromDesign, toDesignFile } from '../draft/index.ts'
import { formatPath } from '../draft/index.ts'

/** The export file's text and a file name for it. */
export function exportDesign(draft: Draft, now: Date = new Date()): { name: string; text: string } {
  const design = toDesignFile(draft, now)
  const clean: DesignFile = {
    ...design,
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

/** Most bytes an import may be; designs with large assets stay well under it. */
export const IMPORT_LIMIT_BYTES = 20_000_000

/**
 * Reads an export. On success, a draft over the imported design that keeps the current draft's
 * retired and published ids (they describe the server, not the file), and any warnings. On
 * failure, the issues that block it.
 */
export function importDesign(
  text: string,
  current: Draft,
): Result<{ draft: Draft; warnings: readonly DesignIssue[] }, readonly DesignIssue[]> {
  if (text.length > IMPORT_LIMIT_BYTES) {
    return { ok: false, error: [{ severity: 'error', path: '', message: 'the file is too large' }] }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: [{ severity: 'error', path: '', message: 'the file is not JSON' }] }
  }
  const parsed = designFileSchema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => ({
        severity: 'error' as const,
        path: formatPath(issue.path),
        message:
          issue.path.at(-1) === 'password'
            ? 'the file holds a password; designs never carry passwords (ADM-16)'
            : issue.message,
      })),
    }
  }
  const issues = checkDesign(parsed.data)
  const errors = issues.filter((i) => i.severity === 'error')
  if (errors.length > 0) return { ok: false, error: errors }
  return {
    ok: true,
    value: {
      draft: draftFromDesign(parsed.data, current.meta),
      warnings: issues.filter((i) => i.severity === 'warning'),
    },
  }
}
