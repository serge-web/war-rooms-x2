import { demoState } from '@wrx/mock-server'
import { describe, expect, it } from 'vitest'
import { MOCK_STATE_MIGRATIONS, MOCK_STATE_VERSION, migrateMockState } from './migrate.ts'
import type { StateMigrations } from './migrate.ts'

const current = demoState()
/** The version before this one. */
const PREV = MOCK_STATE_VERSION - 1

/** A hypothetical previous version that called private storage `vault`. */
function versionZero(): Record<string, unknown> {
  const { privateStorage, ...rest } = current
  return { ...rest, version: PREV, vault: privateStorage }
}

const fromZero: StateMigrations = {
  [PREV]: ({ vault, ...rest }) => ({ ...rest, version: PREV + 1, privateStorage: vault }),
}

describe('stored mock state migration (DOC-17)', () => {
  it('reads the current version unchanged, as text or value', () => {
    expect(MOCK_STATE_VERSION).toBe(2)
    expect(Object.keys(MOCK_STATE_MIGRATIONS)).toEqual([])
    expect(migrateMockState(JSON.stringify(current))).toEqual({
      ok: true,
      value: { state: current, from: 2 },
    })
    expect(migrateMockState(current)).toEqual({ ok: true, value: { state: current, from: 2 } })
  })

  it('does not migrate a state from before GUID ids: the caller resets it (WP 3.5)', () => {
    // Version 1 named nodes and rooms by slug ids (`forces:blue`); its history is not kept.
    expect(migrateMockState({ ...current, version: 1 })).toEqual({
      ok: false,
      error: 'no migration from version 1',
    })
  })

  it('migrates an older version through the table', () => {
    const result = migrateMockState(JSON.stringify(versionZero()), fromZero)
    expect(result).toEqual({ ok: true, value: { state: current, from: PREV } })
  })

  it('applies migrations in order across several versions', () => {
    const steps: number[] = []
    const chain: StateMigrations = {
      [PREV - 1]: (doc) => {
        steps.push(PREV - 1)
        return { ...doc, version: PREV }
      },
      [PREV]: (doc) => {
        steps.push(PREV)
        return fromZero[PREV]!(doc)
      },
    }
    const result = migrateMockState({ ...versionZero(), version: PREV - 1 }, chain)
    expect(result.ok).toBe(true)
    expect(steps).toEqual([PREV - 1, PREV])
  })

  it('fails when no migration exists for the stored version', () => {
    const result = migrateMockState(versionZero())
    expect(result).toEqual({ ok: false, error: `no migration from version ${PREV}` })
  })

  it('fails on a newer version than this release reads', () => {
    const result = migrateMockState({ ...current, version: MOCK_STATE_VERSION + 1 })
    expect(!result.ok && result.error).toMatch(/newer/)
  })

  it('fails when a migration throws or skips a version', () => {
    const throws: StateMigrations = {
      [PREV]: () => {
        throw new Error('boom')
      },
    }
    expect(migrateMockState(versionZero(), throws)).toEqual({
      ok: false,
      error: `migration from ${PREV} failed: boom`,
    })
    const skips: StateMigrations = { 0: (doc) => ({ ...doc, version: 3 }) }
    expect(!migrateMockState(versionZero(), skips).ok).toBe(true)
  })

  it('fails on anything that is not a mock database', () => {
    for (const input of ['{not json', '[]', 'null', '42', { format: 'other', version: 1 }]) {
      expect(migrateMockState(input).ok).toBe(false)
    }
    expect(migrateMockState({ ...current, version: '1' }).ok).toBe(false)
    expect(migrateMockState({ ...current, accounts: 'nobody' }).ok).toBe(false)
  })
})
