import { z } from 'zod'
import {
  announcementSchema,
  assetSchema,
  forceSchema,
  gameSetupSchema,
  gameStateSchema,
  objectivesSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import { messageBodySchema } from './message.ts'

/** Every kind of JSON payload WRX1 reads from the network (ARC-6). */
export const DOCUMENT_SCHEMAS = Object.freeze({
  'game-setup': gameSetupSchema,
  force: forceSchema,
  role: roleSchema,
  room: roomSchema,
  objectives: objectivesSchema,
  asset: assetSchema,
  announcement: announcementSchema,
  'game-state': gameStateSchema,
  message: messageBodySchema,
})

export type DocumentKind = keyof typeof DOCUMENT_SCHEMAS
export type DocumentOf<K extends DocumentKind> = z.infer<(typeof DOCUMENT_SCHEMAS)[K]>

/** Upgrades a document from one `schemaVersion` to the next. */
export type Migration = (doc: Readonly<Record<string, unknown>>) => Record<string, unknown>

/**
 * Migrations per kind, keyed by the version they upgrade *from*. v1 has none; adding version 2
 * of a document means adding `{ 1: (doc) => ... }` here and changing its schema's literal.
 */
export type MigrationTable = Readonly<
  Partial<Record<DocumentKind, Readonly<Record<number, Migration>>>>
>

export const MIGRATIONS: MigrationTable = Object.freeze({})

export type ParseErrorCode = 'invalid-json' | 'missing-version' | 'unsupported-version' | 'invalid'

export interface ParseError {
  readonly code: ParseErrorCode
  readonly message: string
  readonly issues?: readonly z.core.$ZodIssue[]
}

/**
 * The parse result. Network data never throws (NFR-5): callers log and ignore failures.
 * This is the result convention for both transport layers (ARC-14).
 */
export type Result<T, E = ParseError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export interface ParseOptions {
  /** Defaults to {@link MIGRATIONS}; tests pass their own. */
  readonly migrations?: MigrationTable
}

/**
 * Parses a payload of the given kind: JSON text or an already-decoded value. Migrates older
 * `schemaVersion`s forward, then validates against the current schema.
 */
export function parseDocument<K extends DocumentKind>(
  kind: K,
  input: unknown,
  options: ParseOptions = {},
): Result<DocumentOf<K>> {
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch (e) {
      return fail('invalid-json', e instanceof Error ? e.message : 'invalid JSON')
    }
  }
  if (!isRecord(value)) return fail('invalid', 'expected a JSON object')

  const migrations: Readonly<Record<number, Migration>> =
    (options.migrations ?? MIGRATIONS)[kind] ?? {}
  let doc: Record<string, unknown> = value
  // Bounded by the number of migrations, so a bad table cannot loop forever.
  for (let step = 0; step <= Object.keys(migrations).length; step++) {
    const version = doc.schemaVersion
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      return fail('missing-version', 'schemaVersion must be an integer')
    }
    const migrate = migrations[version]
    if (migrate === undefined) break
    doc = migrate(doc)
  }

  // TypeScript can't correlate a generic key with its map entry; the map's own type guarantees it.
  const schema = DOCUMENT_SCHEMAS[kind] as unknown as z.ZodType<DocumentOf<K>>
  const parsed = schema.safeParse(doc)
  if (parsed.success) return { ok: true, value: parsed.data }
  const versionIssue = parsed.error.issues.find(
    (issue) => issue.path.length === 1 && issue.path[0] === 'schemaVersion',
  )
  if (versionIssue !== undefined) {
    return fail('unsupported-version', `unsupported schemaVersion ${String(doc.schemaVersion)}`)
  }
  return fail('invalid', z.prettifyError(parsed.error), parsed.error.issues)
}

function fail(
  code: ParseErrorCode,
  message: string,
  issues?: readonly z.core.$ZodIssue[],
): { ok: false; error: ParseError } {
  return { ok: false, error: issues === undefined ? { code, message } : { code, message, issues } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
