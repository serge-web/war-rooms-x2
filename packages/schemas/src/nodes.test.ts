import { describe, expect, it } from 'vitest'
import { NODE_PREFIXES, SINGLETON_NODES, nodeName, parseNodeName } from './nodes.ts'

describe('node names (§3)', () => {
  it('builds per-entity node names', () => {
    expect(nodeName.force('blue')).toBe('forces:blue')
    expect(nodeName.role('blue-co')).toBe('roles:blue-co')
    expect(nodeName.room('negotiation')).toBe('rooms:negotiation')
    expect(nodeName.objectives('red')).toBe('objectives:red')
    expect(nodeName.asset('game-logo')).toBe('assets:game-logo')
  })

  it('refuses ids that are not slugs', () => {
    expect(() => nodeName.force('Blue Force')).toThrow(RangeError)
    expect(() => nodeName.role('')).toThrow(RangeError)
  })

  it('round-trips every prefix', () => {
    for (const prefix of NODE_PREFIXES) {
      expect(parseNodeName(`${prefix}:abc-1`)).toEqual({ kind: prefix, id: 'abc-1' })
    }
  })

  it('recognises singleton nodes', () => {
    for (const node of Object.values(SINGLETON_NODES)) {
      expect(parseNodeName(node)).toEqual({ kind: 'singleton', node })
    }
  })

  it.each(['templates:x', 'forces:', 'forces:Blue', 'forces', 'urn:xmpp:mam:2', 'forces:a:b'])(
    'ignores %s',
    (node) => {
      expect(parseNodeName(node)).toBeUndefined()
    },
  )
})
