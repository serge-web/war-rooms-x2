import { demoState } from '@wrx/mock-server'
import { describe, expect, it } from 'vitest'
import { MOCK_STATE_MIGRATIONS, MOCK_STATE_VERSION, migrateMockState } from './migrate.ts'
import type { StateMigrations } from './migrate.ts'

const current = demoState()

/** A hypothetical version 0 that called private storage `vault`. */
function versionZero(): Record<string, unknown> {
  const { privateStorage, ...rest } = current
  return { ...rest, version: 0, vault: privateStorage }
}

const fromZero: StateMigrations = {
  0: ({ vault, ...rest }) => ({ ...rest, version: 1, privateStorage: vault }),
}

describe('stored mock state migration (DOC-17)', () => {
  it('reads the current version unchanged, as text or value', () => {
    expect(MOCK_STATE_VERSION).toBe(1)
    expect(Object.keys(MOCK_STATE_MIGRATIONS)).toEqual([])
    expect(migrateMockState(JSON.stringify(current))).toEqual({
      ok: true,
      value: { state: current, from: 1 },
    })
    expect(migrateMockState(current)).toEqual({ ok: true, value: { state: current, from: 1 } })
  })

  it('migrates an older version through the table', () => {
    const result = migrateMockState(JSON.stringify(versionZero()), fromZero)
    expect(result).toEqual({ ok: true, value: { state: current, from: 0 } })
  })

  it('applies migrations in order across several versions', () => {
    const steps: number[] = []
    const chain: StateMigrations = {
      [-1]: (doc) => {
        steps.push(-1)
        return { ...doc, version: 0 }
      },
      0: (doc) => {
        steps.push(0)
        return fromZero[0]!(doc)
      },
    }
    const result = migrateMockState({ ...versionZero(), version: -1 }, chain)
    expect(result.ok).toBe(true)
    expect(steps).toEqual([-1, 0])
  })

  it('fails when no migration exists for the stored version', () => {
    const result = migrateMockState(versionZero())
    expect(result).toEqual({ ok: false, error: 'no migration from version 0' })
  })

  it('fails on a newer version than this release reads', () => {
    const result = migrateMockState({ ...current, version: 2 })
    expect(!result.ok && result.error).toMatch(/newer/)
  })

  it('fails when a migration throws or skips a version', () => {
    const throws: StateMigrations = {
      0: () => {
        throw new Error('boom')
      },
    }
    expect(migrateMockState(versionZero(), throws)).toEqual({
      ok: false,
      error: 'migration from 0 failed: boom',
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
