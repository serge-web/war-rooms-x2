// Stored mock state across releases (DOC-17): the demo's database lives in each visitor's
// browser while the app is redeployed under it. State saved by an older release is migrated
// forward one version at a time; anything that cannot be read or migrated is reported, and the
// caller resets to the seed with a notice. Nothing here throws.
import { MOCK_STATE_FORMAT, mockStateSchema, parseMockState } from '@wrx/mock-server'
import type { MockState } from '@wrx/mock-server'
import type { Result } from '@wrx/schemas'

/** The `version` the current mock server reads and writes. */
export const MOCK_STATE_VERSION: number = mockStateSchema.shape.version.value

/** Turns a version-N document into a version-(N+1) one. It may assume `version === N`. */
export type StateMigration = (state: Readonly<Record<string, unknown>>) => Record<string, unknown>

/** Keyed by the version a migration reads. */
export type StateMigrations = Readonly<Record<number, StateMigration>>

/**
 * The migrations for this release. Empty while version 1 is the only one: when `MockState`
 * changes, bump its `version` in mock-server and add the step from the old version here, e.g.
 * `1: (old) => ({ ...old, version: 2, newField: [] })`.
 */
export const MOCK_STATE_MIGRATIONS: StateMigrations = Object.freeze({})

export interface Migrated {
  readonly state: MockState
  /** The version read from storage; equal to the current one when nothing was migrated. */
  readonly from: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads stored state: JSON text or a decoded value. Older versions go through `migrations` in
 * turn, then the result is validated against the current schema.
 */
export function migrateMockState(
  input: unknown,
  migrations: StateMigrations = MOCK_STATE_MIGRATIONS,
  current: number = MOCK_STATE_VERSION,
): Result<Migrated, string> {
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch (e) {
      return { ok: false, error: `not JSON: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  if (!isRecord(value)) return { ok: false, error: 'not a JSON object' }
  if (value.format !== MOCK_STATE_FORMAT) return { ok: false, error: 'not a mock database' }
  const from = value.version
  if (typeof from !== 'number' || !Number.isInteger(from)) {
    return { ok: false, error: 'the version is not an integer' }
  }
  if (from > current) {
    return { ok: false, error: `version ${from} is newer than this release reads (${current})` }
  }
  let doc: Record<string, unknown> = value
  for (let version = from; version < current; version++) {
    const migrate = migrations[version]
    if (migrate === undefined) {
      return { ok: false, error: `no migration from version ${version}` }
    }
    try {
      doc = migrate(doc)
    } catch (e) {
      return {
        ok: false,
        error: `migration from ${version} failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
    if (!isRecord(doc) || doc.version !== version + 1) {
      return {
        ok: false,
        error: `migration from ${version} did not produce version ${version + 1}`,
      }
    }
  }
  const parsed = parseMockState(doc)
  if (!parsed.ok) return { ok: false, error: `invalid after reading: ${parsed.error}` }
  return { ok: true, value: { state: parsed.value, from } }
}
