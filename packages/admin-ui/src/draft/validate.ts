// Live validation of the draft (WP 2.2): the design file schema, `checkDesign`, and each room's
// config against its room type (ARC-5). Errors block publishing; warnings are shown (ADM-9).
import { roomConfig } from '@wrx/domain'
import type { RoomTypeRegistry } from '@wrx/domain'
import { checkDesign, designFileSchema } from '@wrx/schemas'
import type { DesignCheckOptions, DesignFile, DesignIssue } from '@wrx/schemas'

export interface DraftValidation {
  /** Every issue: schema errors first, then `checkDesign`, then room types. */
  readonly issues: readonly DesignIssue[]
  readonly errorCount: number
  readonly warningCount: number
  /** True when nothing blocks publishing. */
  readonly publishable: boolean
  /** Issues at `path` or inside it: `at('forces[0]')` includes `forces[0].name`. */
  readonly at: (path: string) => readonly DesignIssue[]
}

export interface ValidateOptions extends DesignCheckOptions {
  /** When given, each room's type must be registered and its config must pass the type's schema. */
  readonly registry?: RoomTypeRegistry
}

export function validateDraft(design: DesignFile, options: ValidateOptions = {}): DraftValidation {
  const issues: DesignIssue[] = []
  const seen = new Set<string>()
  const add = (issue: DesignIssue) => {
    const key = `${issue.severity}|${issue.path}|${issue.message}`
    if (seen.has(key)) return
    seen.add(key)
    issues.push(issue)
  }

  const parsed = designFileSchema.safeParse(design)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add({ severity: 'error', path: formatPath(issue.path), message: issue.message })
    }
  }
  for (const issue of checkDesign(design, options)) add(issue)

  const registry = options.registry
  if (registry !== undefined) {
    design.rooms.forEach((room, i) => {
      if (registry.get(room.roomType) === undefined) {
        add({
          severity: 'error',
          path: `rooms[${i}].roomType`,
          message: `room type "${room.roomType}" is not supported`,
        })
        return
      }
      const config = roomConfig(registry, room, design.game)
      if (!config.ok) add({ severity: 'error', path: `rooms[${i}].config`, message: config.error })
    })
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length
  return {
    issues,
    errorCount,
    warningCount: issues.length - errorCount,
    publishable: errorCount === 0,
    at: (path) => issues.filter((issue) => isWithin(issue.path, path)),
  }
}

/** A Zod issue path in `checkDesign`'s form: `['rooms', 2, 'participants']` → `rooms[2].participants`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = ''
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`
    else out += out === '' ? String(key) : `.${String(key)}`
  }
  return out
}

function isWithin(path: string, prefix: string): boolean {
  return (
    path === prefix ||
    (path.startsWith(prefix) && (path[prefix.length] === '.' || path[prefix.length] === '['))
  )
}
