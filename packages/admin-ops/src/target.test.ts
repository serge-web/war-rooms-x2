// The target state of a design (§3, NFR-3), and that it matches what the mock's seed provisions,
// so a seeded mock and a published server agree.
import { stateFromDesign } from '@wrx/mock-server'
import { describe, expect, it } from 'vitest'
// @wrx/schemas does not export its fixtures; the mock server imports them the same way.
import { nodeName, parseDocument } from '@wrx/schemas'
import { TEMPLATE, sampleDesign, templatedDesign, tid } from '../../schemas/src/fixtures.ts'
import {
  OBJECTIVES_MAX_ITEMS,
  RETIRED_MAX_ITEMS,
  TEMPLATES_MAX_ITEMS,
  targetState,
} from './target.ts'

/** The sample design with a White Force writer, and a White observer assigned to one room. */
function withWhiteRoles() {
  const design = sampleDesign()
  const role = (login: string, name: string, isObserver: boolean, order: number) => ({
    schemaVersion: 1 as const,
    id: tid(login),
    loginName: login,
    name,
    forceId: tid('white'),
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
      r.id === tid(tid('negotiation'))
        ? {
            ...r,
            participants: [
              ...r.participants,
              { kind: 'role' as const, id: tid('mediator'), access: 'write' as const },
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
    const blueHq = target.rooms.find((r) => r.roomId === tid(tid('blue-hq')))
    expect(Object.fromEntries(blueHq?.access ?? [])).toEqual({
      'blue-co': 'write',
      'blue-observer': 'read',
      'white-observer': 'read',
    })
    expect(target.readOnlyRoles).toEqual(['blue-observer', 'white-observer'])
  })

  it('names roles by login name, the account, and nodes and rooms by GUID (§3 rule 1)', () => {
    expect(target.roles).toEqual(['blue-co', 'blue-observer', 'red-co', 'white-observer'])
    expect(target.loginNames.get(tid('blue-co'))).toBe('blue-co')
    expect(target.rooms.map((r) => r.roomId)).toEqual([
      tid('blue-hq'),
      tid('red-hq'),
      tid('negotiation'),
    ])
  })

  it('keeps the deleted entities’ records in `retired`, read by every role (§3 rule 1)', () => {
    const design = sampleDesign()
    design.retired.push({
      schemaVersion: 1,
      id: tid('old-co'),
      kind: 'role',
      name: 'Old CO',
      loginName: 'old-co',
      deletedAt: '2026-11-01T10:00:00.000Z',
    })
    const retired = targetState(design).nodes.find((n) => n.node === 'retired')
    expect(retired?.config).toMatchObject({ accessModel: 'whitelist', maxItems: RETIRED_MAX_ITEMS })
    expect([...(retired?.access.values() ?? [])]).toEqual(['read', 'read', 'read', 'read'])
    expect(retired?.documents.map((d) => d.itemId)).toEqual([tid('old-co')])
    // Effective access never reads it: the deleted role has no room or node.
    const target = targetState(design)
    expect(target.roles).not.toContain('old-co')
    expect(target.rooms.some((r) => r.access.has('old-co'))).toBe(false)
    expect(target.nodes.some((n) => n.access.has('old-co'))).toBe(false)
  })

  it('publishes the directory: every role reads each role’s GUID by login name (§3 rule 1)', () => {
    const design = sampleDesign()
    const directory = targetState(design).nodes.find((n) => n.node === 'directory')
    expect(directory?.config).toMatchObject({ accessModel: 'whitelist', maxItems: 1 })
    expect([...(directory?.access.entries() ?? [])].sort()).toEqual(
      design.roles.map((r) => [r.loginName, 'read']).sort(),
    )
    expect(directory?.documents).toHaveLength(1)
    const parsed = parseDocument('directory', directory?.documents[0]?.payload ?? '{}')
    if (!parsed.ok) throw new Error(parsed.error.message)
    expect(parsed.value.roles).toContainEqual({ id: tid('blue-co'), loginName: 'blue-co' })
    expect(parsed.value.roles).toHaveLength(design.roles.length)
    expect(parsed.value.forces).toEqual(design.forces.map((f) => f.id).sort())
    expect(parsed.value.rooms).toEqual(design.rooms.map((r) => r.id).sort())
    // A role's own name for its node is its GUID, never its login name (ADM-42).
    expect(targetState(design).nodes.some((n) => n.node.includes('blue-co'))).toBe(false)
  })

  it('publishes each template as an item of `templates`, read by every role (Annex A, TPL-1)', () => {
    const design = templatedDesign()
    const node = targetState(design).nodes.find((n) => n.node === 'templates')
    expect(node?.config).toMatchObject({
      accessModel: 'whitelist',
      publishModel: 'publishers',
      maxItems: TEMPLATES_MAX_ITEMS,
    })
    expect([...(node?.access.entries() ?? [])].sort()).toEqual(
      design.roles.map((r) => [r.loginName, 'read']).sort(),
    )
    expect(node?.documents.map((d) => d.itemId)).toEqual([
      TEMPLATE.sitrep,
      TEMPLATE.contact,
      TEMPLATE.support,
    ])
    const parsed = parseDocument('template', node?.documents[0]?.payload ?? '{}')
    expect(parsed.ok).toBe(true)
    // A design without templates still has the node, empty.
    const empty = targetState(sampleDesign()).nodes.find((n) => n.node === 'templates')
    expect(empty?.documents).toEqual([])
    // Nothing below it, which stays reserved.
    expect(targetState(design).nodes.some((n) => n.node.startsWith('templates:'))).toBe(false)
  })

  it('opens only game-setup and the game theme asset; everything is publishers', () => {
    const open = target.nodes.filter((n) => n.config.accessModel === 'open').map((n) => n.node)
    expect(open).toEqual(['game-setup', nodeName.asset(tid('game-logo'))])
    expect(target.nodes.every((n) => n.config.publishModel === 'publishers')).toBe(true)
  })

  it('sizes objectives for the admin, with the force and the White observer reading (§3 rule 14)', () => {
    const blue = target.nodes.find((n) => n.node === nodeName.objectives(tid('blue')))
    expect(Object.fromEntries(blue?.access ?? [])).toEqual({
      'blue-co': 'read',
      'blue-observer': 'read',
      'white-observer': 'read',
    })
    expect(blue?.config.maxItems).toBe(OBJECTIVES_MAX_ITEMS)
    expect(OBJECTIVES_MAX_ITEMS).toBe(1)
    expect(blue?.documents.map((d) => d.itemId)).toEqual(['admin'])
  })

  it('D21: every White Force role reads objectives and none publishes, observer or not', () => {
    const white = targetState(withWhiteRoles())
    for (const forceId of ['blue', 'red', 'white']) {
      const node = white.nodes.find((n) => n.node === nodeName.objectives(tid(forceId)))
      // Before WP 3.5 the White Force role that is not an observer published.
      expect(node?.access.get('white-cell'), forceId).toBe('read')
      expect(node?.access.get('white-observer'), forceId).toBe('read')
      expect(node?.access.get('mediator'), forceId).toBe('read')
      expect(node?.config.maxItems).toBe(1)
    }
    // No role publishes anywhere: the admin, as owner, is the only publisher of every node.
    const publishers = white.nodes.flatMap((n) =>
      [...n.access].filter(([, a]) => a === 'publish').map(([id]) => `${n.node}:${id}`),
    )
    expect(publishers).toEqual([])
  })

  it('F5: a White observer with an assigned room is a read-only member of that room only', () => {
    const white = targetState(withWhiteRoles())
    const access = (roomId: string, roleId: string) =>
      white.rooms.find((r) => r.roomId === roomId)?.access.get(roleId)
    expect(access(tid(tid('negotiation')), 'mediator')).toBe('read')
    expect(access(tid(tid('blue-hq')), 'mediator')).toBeUndefined()
    expect(access(tid(tid('red-hq')), 'mediator')).toBeUndefined()
    for (const roomId of [tid(tid('blue-hq')), tid(tid('red-hq')), tid(tid('negotiation'))]) {
      expect(access(roomId, 'white-cell')).toBe('write')
      expect(access(roomId, 'white-observer')).toBe('read')
    }
    expect(white.readOnlyRoles).toEqual(['blue-observer', 'white-observer', 'mediator'])
  })

  it.each([
    ['the sample design', sampleDesign],
    ['White Force writers and assigned observers', withWhiteRoles],
    ['the templated design', templatedDesign],
  ])(
    'matches the mock seed for %s: members, stored visitors, node configs and affiliations',
    (_, make) => {
      const target = targetState(make())
      const seeded = stateFromDesign({ design: make(), domain: 'wrx.test' })
      if (!seeded.ok) throw new Error(seeded.error)
      const jid = (login: string) => `${login}@wrx.test`
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
