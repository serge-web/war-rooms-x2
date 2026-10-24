import { describe, expect, it } from 'vitest'
import { sampleDesign } from './fixtures.ts'
import { parseDocument } from './parse.ts'
import type { MigrationTable } from './parse.ts'

const force = sampleDesign().forces[0]!

describe('parseDocument (ARC-6, NFR-5)', () => {
  it('parses JSON text and decoded values alike', () => {
    expect(parseDocument('force', JSON.stringify(force))).toEqual({ ok: true, value: force })
    expect(parseDocument('force', force)).toEqual({ ok: true, value: force })
  })

  it('reports invalid JSON without throwing', () => {
    const result = parseDocument('force', '{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-json')
  })

  it.each([null, [], 42, 'true'])('rejects non-object payload %j', (payload) => {
    const result = parseDocument('force', payload)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid')
  })

  it('reports a missing schemaVersion', () => {
    const { schemaVersion: _v, ...rest } = force
    const result = parseDocument('force', rest)
    expect(!result.ok && result.error.code).toBe('missing-version')
  })

  it('reports a version newer than this client supports', () => {
    const result = parseDocument('force', { ...force, schemaVersion: 9 })
    expect(!result.ok && result.error.code).toBe('unsupported-version')
  })

  it('reports field errors with issues', () => {
    const result = parseDocument('force', { ...force, colour: 'blue' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid')
      expect(result.error.issues?.[0]?.path).toEqual(['colour'])
    }
  })

  it('validates message bodies', () => {
    const body = { type: 'chat', schemaVersion: 1, content: { text: 'hi' } }
    expect(parseDocument('message', JSON.stringify(body))).toEqual({ ok: true, value: body })
  })

  describe('migration by schemaVersion', () => {
    // A pretend history: version 0 called the colour "color".
    const migrations: MigrationTable = {
      force: {
        0: ({ color, ...rest }) => ({ ...rest, colour: color, schemaVersion: 1 }),
      },
    }

    it('migrates an older document forward before validating', () => {
      const { colour, ...rest } = force
      const old = { ...rest, color: colour, schemaVersion: 0 }
      expect(parseDocument('force', old, { migrations })).toEqual({ ok: true, value: force })
    })

    it('leaves current documents alone', () => {
      expect(parseDocument('force', force, { migrations })).toEqual({ ok: true, value: force })
    })

    it('stops on a migration that never advances the version', () => {
      const stuck: MigrationTable = { force: { 0: (doc) => ({ ...doc }) } }
      const result = parseDocument('force', { ...force, schemaVersion: 0 }, { migrations: stuck })
      expect(!result.ok && result.error.code).toBe('unsupported-version')
    })
  })
})
