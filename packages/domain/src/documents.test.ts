import { LIMITS } from '@wrx/schemas'
import type { TransportError } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { documentValue, nodeSpec, parseItem, safeNodeName } from './documents.ts'
import { fromTransport } from './errors.ts'
import { force, objectives } from './fixtures.ts'
import { bareJid, domainpart, localpart } from './jid.ts'
import { consoleLogger } from './logger.ts'
import { escapedByteLength, fitsInStanza } from './size.ts'

describe('node specs and items (ARC-6, NFR-5)', () => {
  it('maps every WRX1 node to its document kind', () => {
    expect(nodeSpec('game-setup')).toEqual({ kind: 'game-setup', id: undefined })
    expect(nodeSpec('game-state')).toEqual({ kind: 'game-state', id: undefined })
    expect(nodeSpec('announcements')).toEqual({ kind: 'announcement', id: undefined })
    expect(nodeSpec('forces:blue')).toEqual({ kind: 'force', id: 'blue' })
    expect(nodeSpec('roles:blue-co')).toEqual({ kind: 'role', id: 'blue-co' })
    expect(nodeSpec('rooms:hq')).toEqual({ kind: 'room', id: 'hq' })
    expect(nodeSpec('objectives:blue')).toEqual({ kind: 'objectives', id: 'blue' })
    expect(nodeSpec('assets:logo')).toEqual({ kind: 'asset', id: 'logo' })
    expect(nodeSpec('something-else')).toBeUndefined()
  })

  it('parses valid items and rejects invalid ones without throwing', () => {
    const spec = { kind: 'force' as const, id: 'blue' }
    const parsed = parseItem(spec, JSON.stringify(force('blue')))
    expect(parsed.ok && documentValue(parsed.value, 'force')?.id).toBe('blue')
    expect(parsed.ok && documentValue(parsed.value, 'role')).toBeUndefined()
    expect(parseItem(spec, '{not json').ok).toBe(false)
    expect(parseItem(spec, JSON.stringify({ ...force('blue'), colour: 'blue' })).ok).toBe(false)
  })

  it('rejects a document that names a different node', () => {
    expect(parseItem({ kind: 'force', id: 'blue' }, JSON.stringify(force('red')))).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
    expect(
      parseItem({ kind: 'objectives', id: 'blue' }, JSON.stringify(objectives('red', 'x'))).ok,
    ).toBe(false)
    expect(
      parseItem({ kind: 'objectives', id: 'blue' }, JSON.stringify(objectives('blue', 'x'))).ok,
    ).toBe(true)
  })

  it('parses every kind', () => {
    const cases: [Parameters<typeof parseItem>[0], unknown][] = [
      [{ kind: 'game-state', id: undefined }, { schemaVersion: 1 }],
      [
        { kind: 'announcement', id: undefined },
        { schemaVersion: 1, text: 'Lunch', postedAt: '2026-10-24T12:00:00Z' },
      ],
      [
        { kind: 'role', id: 'a' },
        { schemaVersion: 1, id: 'a', name: 'A', forceId: 'b', isObserver: false, order: 0 },
      ],
      [
        { kind: 'room', id: 'r' },
        {
          schemaVersion: 1,
          id: 'r',
          name: 'R',
          roomType: 'chat',
          participants: [],
          config: {},
          order: 0,
        },
      ],
      [
        { kind: 'asset', id: 'px' },
        {
          schemaVersion: 1,
          id: 'px',
          mimeType: 'image/png',
          size: 3,
          sha256: '0'.repeat(64),
          data: 'AAAA',
        },
      ],
    ]
    for (const [spec, doc] of cases) expect(parseItem(spec, JSON.stringify(doc)).ok).toBe(true)
  })

  it('builds node names without throwing', () => {
    expect(safeNodeName('force', 'blue')).toBe('forces:blue')
    expect(safeNodeName('force', 'Not Valid')).toBeUndefined()
  })
})

describe('errors, JIDs, size and logging', () => {
  it('maps transport conditions to domain codes (PLY-52)', () => {
    const map = (condition: TransportError['condition']) => fromTransport({ condition }, 'x').code
    expect(map('forbidden')).toBe('access-withdrawn')
    expect(map('not-allowed')).toBe('access-withdrawn')
    expect(map('registration-required')).toBe('access-withdrawn')
    expect(map('item-not-found')).toBe('not-found')
    expect(map('too-large')).toBe('too-large')
    expect(map('disconnected')).toBe('session-ended')
    expect(map('timeout')).toBe('transport')
    expect(fromTransport({ condition: 'timeout', text: 'slow' }, 'Reading').message).toBe(
      'Reading failed (timeout): slow',
    )
  })

  it('splits JIDs', () => {
    expect(bareJid('Blue-CO@wrx.test/pane')).toBe('blue-co@wrx.test')
    expect(localpart('blue-co@wrx.test/x')).toBe('blue-co')
    expect(localpart('wrx.test')).toBeUndefined()
    expect(domainpart('blue-co@wrx.test/x')).toBe('wrx.test')
  })

  it('measures stanzas as escaped UTF-8 (PLY-53)', () => {
    expect(escapedByteLength('<&>')).toBe('&lt;&amp;&gt;'.length)
    expect(escapedByteLength('é')).toBe(2)
    expect(fitsInStanza('x'.repeat(1_000)).ok).toBe(true)
    expect(fitsInStanza('<'.repeat(LIMITS.messageStanzaBytes / 4)).ok).toBe(false)
  })

  it('logs warnings to the console, and debug nowhere', () => {
    const logger = consoleLogger('test')
    const original = console.warn
    const seen: unknown[] = []
    console.warn = (...args: unknown[]) => seen.push(args)
    try {
      logger.warn('hello', { a: 1 })
      logger.debug('quiet')
    } finally {
      console.warn = original
    }
    expect(seen).toEqual([['[test] hello', { a: 1 }]])
  })
})
