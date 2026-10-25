// The target state of a design (§3, NFR-3), and that it matches what the mock's seed provisions,
// so a seeded mock and a published server agree.
import { stateFromDesign } from '@wrx/mock-server'
import { describe, expect, it } from 'vitest'
// @wrx/schemas does not export its fixtures; the mock server imports them the same way.
import { sampleDesign } from '../../schemas/src/fixtures.ts'
import { objectivesMaxItems, targetState } from './target.ts'

/** The sample design with a White Force writer, and a White observer assigned to one room. */
function withWhiteRoles() {
  const design = sampleDesign()
  const role = (id: string, name: string, isObserver: boolean, order: number) => ({
    schemaVersion: 1 as const,
    id,
    name,
    forceId: 'white',
    isObserver,
    order,
  })
  return {
    ...design,
    roles: [
      ...design.roles,
      role('white-cell', 'White Cell', false, 1),
      role('mediator', 'Mediator', true, 2),
    ],
    rooms: design.rooms.map((r) =>
      r.id === 'negotiation'
        ? {
            ...r,
            participants: [
              ...r.participants,
              { kind: 'role' as const, id: 'mediator', access: 'write' as const },
            ],
          }
        : r,
    ),
  }
}

describe('targetState(sampleDesign())', () => {
  const target = targetState(sampleDesign())

  it('makes every room NFR-3 and moderated, with the observers read-only', () => {
    for (const room of target.rooms) {
      expect(room.config).toMatchObject({
        membersOnly: true,
        moderated: true,
        persistent: true,
        public: false,
        whois: 'anyone',
        archive: true,
      })
      // The White observer has no assigned rooms, so it reads every room (§3 rule 4).
      expect(room.access.get('white-observer')).toBe('read')
    }
    const blueHq = target.rooms.find((r) => r.roomId === 'blue-hq')
    expect(Object.fromEntries(blueHq?.access ?? [])).toEqual({
      'blue-co': 'write',
      'blue-observer': 'read',
      'white-observer': 'read',
    })
    expect(target.readOnlyRoles).toEqual(['blue-observer', 'white-observer'])
  })

  it('opens only game-setup and the game theme asset; everything is publishers', () => {
    const open = target.nodes.filter((n) => n.config.accessModel === 'open').map((n) => n.node)
    expect(open).toEqual(['game-setup', 'assets:game-logo'])
    expect(target.nodes.every((n) => n.config.publishModel === 'publishers')).toBe(true)
  })

  it('sizes objectives for the admin, with the force and the White observer reading (§3 rule 14)', () => {
    const blue = target.nodes.find((n) => n.node === 'objectives:blue')
    expect(Object.fromEntries(blue?.access ?? [])).toEqual({
      'blue-co': 'read',
      'blue-observer': 'read',
      'white-observer': 'read',
    })
    expect(blue?.config.maxItems).toBe(objectivesMaxItems(0))
    expect(objectivesMaxItems(0)).toBe(10)
    expect(objectivesMaxItems(20)).toBe(21)
    expect(blue?.documents.map((d) => d.itemId)).toEqual(['admin'])
  })

  it('F5: White Force observers read objectives and never publish; its other roles publish', () => {
    const white = targetState(withWhiteRoles())
    for (const forceId of ['blue', 'red', 'white']) {
      const node = white.nodes.find((n) => n.node === `objectives:${forceId}`)
      expect(node?.access.get('white-cell'), forceId).toBe('publish')
      expect(node?.access.get('white-observer'), forceId).toBe('read')
      expect(node?.access.get('mediator'), forceId).toBe('read')
      expect(node?.config.maxItems).toBe(objectivesMaxItems(1))
    }
    const publishers = white.nodes.flatMap((n) =>
      [...n.access].filter(([, a]) => a === 'publish').map(([id]) => `${n.node}:${id}`),
    )
    expect(publishers.every((p) => p.endsWith(':white-cell'))).toBe(true)
  })

  it('F5: a White observer with an assigned room is a read-only member of that room only', () => {
    const white = targetState(withWhiteRoles())
    const access = (roomId: string, roleId: string) =>
      white.rooms.find((r) => r.roomId === roomId)?.access.get(roleId)
    expect(access('negotiation', 'mediator')).toBe('read')
    expect(access('blue-hq', 'mediator')).toBeUndefined()
    expect(access('red-hq', 'mediator')).toBeUndefined()
    for (const roomId of ['blue-hq', 'red-hq', 'negotiation']) {
      expect(access(roomId, 'white-cell')).toBe('write')
      expect(access(roomId, 'white-observer')).toBe('read')
    }
    expect(white.readOnlyRoles).toEqual(['blue-observer', 'white-observer', 'mediator'])
  })

  it.each([
    ['the sample design', sampleDesign],
    ['White Force writers and assigned observers', withWhiteRoles],
  ])(
    'matches the mock seed for %s: members, stored visitors, node configs and affiliations',
    (_, make) => {
      const target = targetState(make())
      const seeded = stateFromDesign({ design: make(), domain: 'wrx.test' })
      if (!seeded.ok) throw new Error(seeded.error)
      const jid = (id: string) => `${id}@wrx.test`
      for (const room of target.rooms) {
        const seed = seeded.value.rooms.find((r) => r.jid === `${room.roomId}@conference.wrx.test`)
        const members = (seed?.affiliations ?? [])
          .filter((a) => a.affiliation === 'member')
          .map((a) => a.jid)
          .sort()
        expect(members, room.roomId).toEqual([...room.access.keys()].map(jid).sort())
        const visitors = (seed?.storedRoles ?? []).map((r) => r.jid).sort()
        const readOnly = [...room.access].filter(([, a]) => a === 'read').map(([id]) => jid(id))
        expect(visitors, room.roomId).toEqual(readOnly.sort())
        expect(seed?.config).toEqual(room.config)
      }
      expect(seeded.value.nodes.map((n) => n.name).sort()).toEqual(
        target.nodes.map((n) => n.node).sort(),
      )
      for (const node of target.nodes) {
        const seed = seeded.value.nodes.find((n) => n.name === node.node)
        expect(seed?.config, node.node).toMatchObject(node.config)
        const affiliations = (seed?.affiliations ?? [])
          .filter((a) => a.affiliation !== 'owner')
          .map((a) => `${a.jid}=${a.affiliation}`)
          .sort()
        const wanted = [...node.access]
          .map(([id, a]) => `${jid(id)}=${a === 'publish' ? 'publisher' : 'member'}`)
          .sort()
        expect(affiliations, node.node).toEqual(wanted)
        expect(
          seed?.items.map((i) => i.id),
          node.node,
        ).toEqual(node.documents.map((d) => d.itemId))
      }
    },
  )
})
