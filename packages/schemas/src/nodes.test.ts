import { describe, expect, it } from 'vitest'
import { FORCE, ROLE, ROOM, ASSET } from './fixtures.ts'
import {
  NODE_PREFIXES,
  RESERVED_NODE_NAMES,
  RESERVED_NODE_PREFIXES,
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
    'templates:x',
    `templates:${FORCE.blue}`,
    'forces:',
    'forces:Blue',
    'forces:blue',
    'forces',
    'urn:xmpp:mam:2',
    `forces:${FORCE.blue}:b`,
  ])('ignores %s', (node) => {
    expect(parseNodeName(node)).toBeUndefined()
  })

  it('makes `templates` a managed singleton and keeps every name below it reserved (WP 4.1)', () => {
    expect(SINGLETON_NODES.templates).toBe('templates')
    expect(parseNodeName('templates')).toEqual({ kind: 'singleton', node: 'templates' })
    expect(RESERVED_NODE_NAMES).toEqual([])
    expect(RESERVED_NODE_PREFIXES).toEqual(['templates'])
    expect(NODE_PREFIXES).not.toContain('templates')
    expect(isReservedNodeName('templates')).toBe(false)
    expect(isReservedNodeName(`templates:${FORCE.blue}`)).toBe(true)
    expect(isReservedNodeName('templates:x:y')).toBe(true)
    expect(isReservedNodeName('templatesx')).toBe(false)
  })

  it('treats GUID nodes, nodes from before GUIDs and singletons as the game’s, never below `templates`', () => {
    for (const node of [
      `forces:${FORCE.blue}`,
      'forces:blue',
      'roles:blue-co',
      'retired',
      'templates',
    ]) {
      expect(isGameNodeName(node), node).toBe(true)
    }
    for (const node of [
      'templates:x',
      `templates:${FORCE.blue}`,
      'forces:Blue',
      'other',
      'urn:xmpp:mam:2',
    ]) {
      expect(isGameNodeName(node), node).toBe(false)
    }
  })
})
