// The target state of a design (§3, NFR-3), and that it matches what the mock's seed provisions,
// so a seeded mock and a published server agree.
import { stateFromDesign } from '@wrx/mock-server'
import { describe, expect, it } from 'vitest'
// @wrx/schemas does not export its fixtures; the mock server imports them the same way.
import { sampleDesign } from '../../schemas/src/fixtures.ts'
import { objectivesMaxItems, targetState } from './target.ts'

describe('targetState(sampleDesign())', () => {
  const target = targetState(sampleDesign())

  it('makes every room NFR-3 and moderated, with the observer read-only and the umpire writing', () => {
    for (const room of target.rooms) {
      expect(room.config).toMatchObject({
        membersOnly: true,
        moderated: true,
        persistent: true,
        public: false,
        whois: 'anyone',
        archive: true,
      })
      expect(room.access.get('umpire-1')).toBe('write')
    }
    const blueHq = target.rooms.find((r) => r.roomId === 'blue-hq')
    expect(Object.fromEntries(blueHq?.access ?? [])).toEqual({
      'blue-co': 'write',
      'blue-observer': 'read',
      'umpire-1': 'write',
    })
    expect(target.readOnlyRoles).toEqual(['blue-observer'])
  })

  it('opens only game-setup and the game theme asset; everything is publishers', () => {
    const open = target.nodes.filter((n) => n.config.accessModel === 'open').map((n) => n.node)
    expect(open).toEqual(['game-setup', 'assets:game-logo'])
    expect(target.nodes.every((n) => n.config.publishModel === 'publishers')).toBe(true)
  })

  it('sizes objectives for the admin and every umpire, with the force reading (§3 rule 14)', () => {
    const blue = target.nodes.find((n) => n.node === 'objectives:blue')
    expect(Object.fromEntries(blue?.access ?? [])).toEqual({
      'blue-co': 'read',
      'blue-observer': 'read',
      'umpire-1': 'publish',
    })
    expect(blue?.config.maxItems).toBe(objectivesMaxItems(1))
    expect(objectivesMaxItems(20)).toBe(21)
    expect(blue?.documents.map((d) => d.itemId)).toEqual(['admin'])
  })

  it('matches the mock seed: room members, stored visitors, node configs and affiliations', () => {
    const seeded = stateFromDesign({ design: sampleDesign(), domain: 'wrx.test' })
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
  })
})
