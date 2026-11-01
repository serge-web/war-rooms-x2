import { describe, expect, it } from 'vitest'
import { FORCE, ROLE, ROOM, ASSET } from './fixtures.ts'
import {
  NODE_PREFIXES,
  RESERVED_NODE_NAMES,
  SINGLETON_NODES,
  isGameNodeName,
  isReservedNodeName,
  nodeName,
  parseNodeName,
} from './nodes.ts'

describe('node names (§3)', () => {
  it('builds per-entity node names from GUIDs', () => {
    expect(nodeName.force(FORCE.blue)).toBe(`forces:${FORCE.blue}`)
    expect(nodeName.role(ROLE.blueCo)).toBe(`roles:${ROLE.blueCo}`)
    expect(nodeName.room(ROOM.negotiation)).toBe(`rooms:${ROOM.negotiation}`)
    expect(nodeName.objectives(FORCE.red)).toBe(`objectives:${FORCE.red}`)
    expect(nodeName.asset(ASSET.gameLogo)).toBe(`assets:${ASSET.gameLogo}`)
  })

  it('refuses ids that are not GUIDs, slugs from before WP 3.5 included', () => {
    expect(() => nodeName.force('Blue Force')).toThrow(RangeError)
    expect(() => nodeName.force('blue')).toThrow(RangeError)
    expect(() => nodeName.role('')).toThrow(RangeError)
  })

  it('round-trips every prefix', () => {
    for (const prefix of NODE_PREFIXES) {
      expect(parseNodeName(`${prefix}:${FORCE.white}`)).toEqual({ kind: prefix, id: FORCE.white })
    }
  })

  it('recognises singleton nodes, `retired` included', () => {
    expect(Object.values(SINGLETON_NODES)).toContain('retired')
    for (const node of Object.values(SINGLETON_NODES)) {
      expect(parseNodeName(node)).toEqual({ kind: 'singleton', node })
    }
  })

  it.each([
    'templates',
    'templates:x',
    'forces:',
    'forces:Blue',
    'forces:blue',
    'forces',
    'urn:xmpp:mam:2',
    `forces:${FORCE.blue}:b`,
  ])('ignores %s', (node) => {
    expect(parseNodeName(node)).toBeUndefined()
  })

  it('reserves `templates` (Annex A): no singleton or prefix takes it', () => {
    expect(RESERVED_NODE_NAMES).toEqual(['templates'])
    for (const name of RESERVED_NODE_NAMES) {
      expect(Object.values<string>(SINGLETON_NODES)).not.toContain(name)
      expect(NODE_PREFIXES).not.toContain(name)
    }
    expect(isReservedNodeName('templates')).toBe(true)
    expect(isReservedNodeName(`templates:${FORCE.blue}`)).toBe(true)
    expect(isReservedNodeName('templatesx')).toBe(false)
  })

  it('treats GUID nodes, nodes from before GUIDs and singletons as the game’s, never `templates`', () => {
    for (const node of [`forces:${FORCE.blue}`, 'forces:blue', 'roles:blue-co', 'retired']) {
      expect(isGameNodeName(node), node).toBe(true)
    }
    for (const node of ['templates', 'templates:x', 'forces:Blue', 'other', 'urn:xmpp:mam:2']) {
      expect(isGameNodeName(node), node).toBe(false)
    }
  })
})
