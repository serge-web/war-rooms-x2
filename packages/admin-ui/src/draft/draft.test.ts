import { effectiveAccess, accessOf, defaultRoomTypes } from '@wrx/domain'
import type { DesignFile, Result } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
// The schemas package keeps its sample design with its tests and does not export it.
import { sampleDesign } from '../../../schemas/src/fixtures.ts'
import {
  DEFAULT_FORCE_COLOUR,
  addForce,
  addRole,
  addRoom,
  changeRoleId,
  createDraft,
  deleteForce,
  deleteRole,
  deleteRoom,
  draftFromDesign,
  isRolePublished,
  markPublished,
  moveForce,
  moveRole,
  moveRoom,
  normalise,
  objectivesOf,
  referencesTo,
  removeParticipant,
  roleIdProblem,
  setObjectives,
  setParticipant,
  sortedRoles,
  takenIds,
  toDesignFile,
  updateForce,
  updateGame,
  updateRole,
  updateRoom,
  WHITE_FORCE_ID,
} from './draft.ts'
import type { Draft } from './draft.ts'
import { validateDraft } from './validate.ts'

const NOW = new Date('2026-10-25T10:00:00.000Z')

function sample(): Draft {
  return draftFromDesign(sampleDesign())
}

/** Deep-freezes a draft, so any mutation by an operation throws. */
function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child)
    Object.freeze(value)
  }
  return value
}

function ok<T>(result: Result<T, string>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function orders(design: DesignFile) {
  return {
    forces: design.forces.map((f) => `${f.id}:${f.order}`),
    roles: design.roles.map((r) => `${r.forceId}/${r.id}:${r.order}`),
    rooms: design.rooms.map((r) => `${r.id}:${r.order}`),
  }
}

describe('createDraft', () => {
  it('starts a valid design with the White Force only (ADM-4)', () => {
    const draft = createDraft({ name: 'Exercise', now: NOW })
    expect(draft.design.game.name).toBe('Exercise')
    expect(draft.design.exportedAt).toBe(NOW.toISOString())
    expect(draft.design.forces).toEqual([
      {
        schemaVersion: 1,
        id: WHITE_FORCE_ID,
        name: 'White',
        colour: DEFAULT_FORCE_COLOUR,
        isUmpire: true,
        order: 0,
      },
    ])
    expect(draft.design.roles).toEqual([])
    expect(draft.meta).toEqual({
      retiredIds: { forces: [], roles: [], rooms: [] },
      publishedRoleIds: [],
    })
    expect(validateDraft(draft.design).issues).toEqual([])
  })

  it('names the game by default', () => {
    expect(createDraft().design.game.name).toBe('Untitled game')
  })
})

describe('immutability', () => {
  it('never mutates its input', () => {
    let draft = frozen(sample())
    draft = frozen(updateGame(draft, { name: 'X' }))
    draft = frozen(addForce(draft, 'Green').draft)
    draft = frozen(updateForce(draft, 'green', { colour: '#00ff00', iconAssetId: 'game-logo' }))
    draft = frozen(updateForce(draft, 'green', { iconAssetId: null }))
    draft = frozen(addRole(draft, 'green', 'Green CO').draft)
    draft = frozen(moveRole(draft, 'green-co', 'blue', 0))
    draft = frozen(updateRole(draft, 'green-co', { isObserver: true }))
    draft = frozen(ok(changeRoleId(draft, 'green-co', 'g-co')))
    draft = frozen(addRoom(draft, 'Green room').draft)
    draft = frozen(
      setParticipant(draft, 'green-room', { kind: 'role', id: 'g-co', access: 'read' }),
    )
    draft = frozen(removeParticipant(draft, 'green-room', 'role', 'g-co'))
    draft = frozen(updateRoom(draft, 'green-room', { name: 'G', roomType: 'chat' }))
    draft = frozen(moveRoom(draft, 'green-room', 0))
    draft = frozen(moveForce(draft, 'green', 0))
    draft = frozen(setObjectives(draft, 'green', 'Win', NOW))
    draft = frozen(deleteRole(draft, 'g-co'))
    draft = frozen(deleteRoom(draft, 'green-room'))
    expect(ok(deleteForce(draft, 'green')).design.forces).toHaveLength(3)
  })

  it('keeps the identity of unchanged items', () => {
    const draft = sample()
    const next = updateForce(draft, 'red', { name: 'Crimson' })
    expect(next.design.forces[0]).toBe(draft.design.forces[0])
    expect(next.design.forces[1]).not.toBe(draft.design.forces[1])
    expect(next.design.roles).toBe(draft.design.roles)
  })

  it('returns the same draft for unknown ids', () => {
    const draft = sample()
    expect(deleteRole(draft, 'nobody')).toBe(draft)
    expect(deleteRoom(draft, 'nowhere')).toBe(draft)
    expect(moveRole(draft, 'nobody', 'blue')).toBe(draft)
    expect(moveRole(draft, 'blue-co', 'no-force')).toBe(draft)
    expect(setObjectives(draft, 'no-force', 'x')).toBe(draft)
    expect(deleteForce(draft, 'no-force')).toEqual({ ok: true, value: draft })
    expect(changeRoleId(draft, 'nobody', 'x')).toEqual({ ok: true, value: draft })
    expect(changeRoleId(draft, 'blue-co', 'blue-co')).toEqual({ ok: true, value: draft })
  })
})

describe('generated ids (§3 rule 1)', () => {
  it('makes slugs from names', () => {
    const { draft, id } = addForce(createDraft(), 'Blue Force — Écosse')
    expect(id).toBe('blue-force-ecosse')
    expect(draft.design.forces[1]).toMatchObject({
      id,
      name: 'Blue Force — Écosse',
      colour: DEFAULT_FORCE_COLOUR,
      isUmpire: false,
      order: 1,
    })
  })

  it('keeps ids unique within a kind', () => {
    const one = addForce(createDraft(), 'Blue')
    const two = addForce(one.draft, 'Blue')
    expect([one.id, two.id]).toEqual(['blue', 'blue-2'])
    // Other kinds have their own ids.
    expect(addRoom(two.draft, 'Blue').id).toBe('blue')
  })

  it('never reuses an id after a delete in the same draft', () => {
    const { draft, id } = addRoom(createDraft(), 'Ops')
    const deleted = deleteRoom(draft, id)
    expect(deleted.meta.retiredIds.rooms).toEqual(['ops'])
    expect(addRoom(deleted, 'Ops').id).toBe('ops-2')

    const withRole = addRole(sample(), 'blue', 'Blue CO')
    expect(withRole.id).toBe('blue-co-2')
    const gone = deleteRole(withRole.draft, 'blue-co')
    expect(addRole(gone, 'red', 'Blue CO').id).toBe('blue-co-3')
  })

  it('does not retire an id twice', () => {
    const draft = draftFromDesign(sampleDesign(), {
      retiredIds: { forces: [], roles: ['blue-co'], rooms: [] },
    })
    expect(deleteRole(draft, 'blue-co').meta.retiredIds.roles).toEqual(['blue-co'])
  })

  it('never gives a role a reserved or published id', () => {
    const force = addForce(createDraft(), 'Blue').draft
    expect(addRole(force, 'blue', 'Admin').id).toBe('admin-2')
    expect(addRole(force, 'blue', 'Anonymous').id).toBe('anonymous-2')
    const published = draftFromDesign(force.design, { publishedRoleIds: ['co'] })
    expect(addRole(published, 'blue', 'CO').id).toBe('co-2')
    expect(takenIds(published, 'roles')).toEqual(new Set(['admin', 'anonymous', 'co']))
  })

  it('never gives a role an id that looks like an anonymous session (security review F4)', () => {
    const force = addForce(createDraft(), 'Blue').draft
    expect(addRole(force, 'blue', '1234567890123456').id).toBe('role-1234567890123456')
    expect(addRole(force, 'blue', '123456789012345').id).toBe('123456789012345')
    expect(roleIdProblem(sample(), 'blue-co', '1234567890123456')).toBe(
      '"1234567890123456" is reserved',
    )
  })

  it('falls back to the kind for names without letters or digits', () => {
    expect(addForce(createDraft(), '***').id).toBe('force')
    expect(addRoom(createDraft(), '').id).toBe('room')
    const force = addForce(createDraft(), 'F').draft
    expect(addRole(force, 'f', '—').id).toBe('role')
  })

  it('refuses a role for an unknown force', () => {
    expect(() => addRole(createDraft(), 'ghost', 'X')).toThrow(RangeError)
  })
})

describe('game', () => {
  it('updates name, description and briefing', () => {
    const draft = updateGame(sample(), { description: 'D', briefing: '# B' })
    expect(draft.design.game).toMatchObject({
      name: 'Exercise Northern Gate',
      description: 'D',
      briefing: '# B',
    })
  })
})

describe('forces', () => {
  it('edits name, colour, icon and umpire flag', () => {
    let draft = updateForce(sample(), 'blue', {
      name: 'Azure',
      colour: '#0000ff',
      iconAssetId: 'game-logo',
      isUmpire: true,
    })
    expect(draft.design.forces[0]).toMatchObject({
      name: 'Azure',
      colour: '#0000ff',
      iconAssetId: 'game-logo',
      isUmpire: true,
    })
    draft = updateForce(draft, 'blue', { iconAssetId: null })
    expect(draft.design.forces[0]).not.toHaveProperty('iconAssetId')
    draft = updateForce(draft, 'blue', { name: 'Navy' })
    expect(draft.design.forces[0]).not.toHaveProperty('iconAssetId')
  })

  it('keeps exactly one umpire flag: setting it clears it elsewhere (ADM-4)', () => {
    const draft = updateForce(sample(), 'red', { isUmpire: true })
    expect(draft.design.forces.filter((f) => f.isUmpire).map((f) => f.id)).toEqual(['red'])
    // Clearing it leaves none, which validation warns about.
    const none = updateForce(draft, 'red', { isUmpire: false })
    expect(none.design.forces.some((f) => f.isUmpire)).toBe(false)
    expect(validateDraft(none.design).issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', path: 'forces' }),
    )
  })

  it('refuses to delete a force that has roles', () => {
    const result = deleteForce(sample(), 'blue')
    expect(result).toEqual({
      ok: false,
      error: 'Blue still has 2 roles; move or delete them first',
    })
    const one = deleteForce(deleteRole(sample(), 'blue-observer'), 'blue')
    expect(one).toEqual({ ok: false, error: 'Blue still has 1 role; move or delete them first' })
  })

  it('deletes a force with its objectives and participant entries', () => {
    let draft = deleteRole(sample(), 'red-co')
    draft = ok(deleteForce(draft, 'red'))
    expect(draft.design.forces.map((f) => f.id)).toEqual(['blue', 'white'])
    expect(draft.design.forces.map((f) => f.order)).toEqual([0, 1])
    expect(objectivesOf(draft.design, 'red')).toBeUndefined()
    expect(draft.design.rooms.find((r) => r.id === 'red-hq')?.participants).toEqual([])
    expect(draft.meta.retiredIds.forces).toEqual(['red'])
    expect(addForce(draft, 'Red').id).toBe('red-2')
  })

  it('reorders and keeps orders 0…n-1 (§3 rule 7)', () => {
    let draft = moveForce(sample(), 'white', 0)
    expect(orders(draft.design).forces).toEqual(['white:0', 'blue:1', 'red:2'])
    draft = moveForce(draft, 'white', 99)
    expect(orders(draft.design).forces).toEqual(['blue:0', 'red:1', 'white:2'])
    draft = moveForce(draft, 'blue', -5)
    expect(orders(draft.design).forces).toEqual(['blue:0', 'red:1', 'white:2'])
    expect(moveForce(draft, 'ghost', 0).design.forces).toEqual(draft.design.forces)
  })

  it('sorts roles by force order after a force moves', () => {
    const draft = moveForce(sample(), 'red', 0)
    expect(sortedRoles(draft.design).map((r) => r.id)).toEqual([
      'red-co',
      'blue-co',
      'blue-observer',
      'white-observer',
    ])
    expect(draft.design.roles.map((r) => r.id)).toEqual(sortedRoles(draft.design).map((r) => r.id))
  })
})

describe('objectives (ADM-23)', () => {
  it("stores the admin's item with updatedAt", () => {
    const draft = setObjectives(sample(), 'blue', '## Hold', NOW)
    expect(objectivesOf(draft.design, 'blue')).toEqual({
      schemaVersion: 1,
      forceId: 'blue',
      markdown: '## Hold',
      updatedAt: NOW.toISOString(),
    })
    expect(draft.design.objectives.filter((o) => o.forceId === 'blue')).toHaveLength(1)
    const white = setObjectives(draft, 'white', 'Watch')
    expect(objectivesOf(white.design, 'white')?.markdown).toBe('Watch')
  })
})

describe('roles', () => {
  it('edits name and observer flag', () => {
    const draft = updateRole(sample(), 'red-co', { name: 'Red Commander', isObserver: true })
    expect(draft.design.roles.find((r) => r.id === 'red-co')).toMatchObject({
      name: 'Red Commander',
      isObserver: true,
    })
  })

  it('adds a role at the end of its force', () => {
    const { draft, id } = addRole(sample(), 'blue', 'Blue Logistics')
    expect(id).toBe('blue-logistics')
    expect(orders(draft.design).roles).toEqual([
      'blue/blue-co:0',
      'blue/blue-observer:1',
      'blue/blue-logistics:2',
      'red/red-co:0',
      'white/white-observer:0',
    ])
  })

  it('reorders within a force', () => {
    const draft = moveRole(sample(), 'blue-observer', 'blue', 0)
    expect(orders(draft.design).roles.slice(0, 2)).toEqual([
      'blue/blue-observer:0',
      'blue/blue-co:1',
    ])
  })

  it('moves between forces and keeps its id (ADM-5)', () => {
    const before = sample()
    const draft = moveRole(before, 'blue-co', 'red', 0)
    const moved = draft.design.roles.find((r) => r.id === 'blue-co')
    expect(moved).toMatchObject({ id: 'blue-co', forceId: 'red', order: 0 })
    expect(orders(draft.design).roles).toEqual([
      'blue/blue-observer:0',
      'red/blue-co:0',
      'red/red-co:1',
      'white/white-observer:0',
    ])
    // Its room entries still name it.
    expect(draft.design.rooms.find((r) => r.id === 'negotiation')?.participants).toContainEqual({
      kind: 'role',
      id: 'blue-co',
      access: 'write',
    })
    // And it now reads Red HQ through the Red force entry, and not Blue HQ.
    const matrix = effectiveAccess(draft.design)
    expect(accessOf(matrix, 'red-hq', 'blue-co')).toBe('write')
    expect(accessOf(matrix, 'blue-hq', 'blue-co')).toBe('none')
  })

  it('moves to the end of another force by default', () => {
    const draft = moveRole(sample(), 'red-co', 'blue')
    expect(draft.design.roles.find((r) => r.id === 'red-co')).toMatchObject({
      forceId: 'blue',
      order: 2,
    })
  })

  it('deletes a role, its entries, and retires its id', () => {
    const draft = deleteRole(sample(), 'blue-co')
    expect(draft.design.roles.map((r) => r.id)).not.toContain('blue-co')
    expect(draft.design.roles.find((r) => r.id === 'blue-observer')?.order).toBe(0)
    expect(draft.design.rooms.find((r) => r.id === 'negotiation')?.participants).toEqual([
      { kind: 'role', id: 'red-co', access: 'write' },
    ])
    expect(draft.meta.retiredIds.roles).toEqual(['blue-co'])
  })
})

describe('login ids', () => {
  it('changes a login id before the first publish', () => {
    const before = sample()
    const draft = ok(changeRoleId(before, 'blue-co', 'blue-commander'))
    expect(draft.design.roles.map((r) => r.id)).toContain('blue-commander')
    expect(draft.design.rooms.find((r) => r.id === 'negotiation')?.participants[0]).toEqual({
      kind: 'role',
      id: 'blue-commander',
      access: 'write',
    })
    // Unrelated rooms keep their identity.
    expect(draft.design.rooms[1]).toBe(before.design.rooms[1])
    expect(draft.meta.retiredIds.roles).toEqual(['blue-co'])
    expect(roleIdProblem(draft, 'blue-commander', 'blue-co')).toBe(
      '"blue-co" was used by a deleted role and cannot be reused',
    )
  })

  it('refuses bad, reserved and taken ids', () => {
    const draft = sample()
    expect(roleIdProblem(draft, 'blue-co', 'Blue CO')).toBe(
      'use lowercase letters, digits and single hyphens',
    )
    expect(roleIdProblem(draft, 'blue-co', 'admin')).toBe('"admin" is reserved')
    expect(roleIdProblem(draft, 'blue-co', 'red-co')).toBe('another role is "red-co"')
    expect(roleIdProblem(draft, 'blue-co', 'blue-co')).toBeUndefined()
    expect(changeRoleId(draft, 'blue-co', 'admin')).toEqual({
      ok: false,
      error: '"admin" is reserved',
    })
  })

  it('fixes login ids once published', () => {
    const draft = markPublished(sample())
    expect(isRolePublished(draft, 'blue-co')).toBe(true)
    expect(roleIdProblem(draft, 'blue-co', 'blue-x')).toBe(
      'the login id cannot change after the role has been published',
    )
    // A role added after the publish can still change.
    const added = addRole(draft, 'blue', 'New')
    expect(isRolePublished(added.draft, added.id)).toBe(false)
    expect(roleIdProblem(added.draft, added.id, 'fresh')).toBeUndefined()
    // Publishing twice keeps one entry per role.
    expect(markPublished(markPublished(draft)).meta.publishedRoleIds).toHaveLength(4)
    // A published id that is later deleted is never reused.
    const gone = deleteRole(draft, 'red-co')
    expect(roleIdProblem(gone, added.id, 'red-co')).toBeDefined()
  })
})

describe('rooms', () => {
  it('adds a chat room with no participants', () => {
    const { draft, id } = addRoom(sample(), 'Press room')
    expect(draft.design.rooms.at(-1)).toEqual({
      schemaVersion: 1,
      id,
      name: 'Press room',
      roomType: 'chat',
      participants: [],
      config: {},
      order: 3,
    })
  })

  it('edits name, type and config', () => {
    let draft = updateRoom(sample(), 'blue-hq', { config: { a: 1 } })
    expect(draft.design.rooms[0]?.config).toEqual({ a: 1 })
    draft = updateRoom(draft, 'blue-hq', { name: 'Blue Ops' })
    expect(draft.design.rooms[0]).toMatchObject({ name: 'Blue Ops', config: { a: 1 } })
    draft = updateRoom(draft, 'blue-hq', { roomType: 'chat' })
    expect(draft.design.rooms[0]?.config).toEqual({ a: 1 })
    draft = updateRoom(draft, 'blue-hq', { roomType: 'map' })
    expect(draft.design.rooms[0]).toMatchObject({ roomType: 'map', config: {} })
    draft = updateRoom(draft, 'blue-hq', { roomType: 'chat', config: { b: 2 } })
    expect(draft.design.rooms[0]).toMatchObject({ roomType: 'chat', config: { b: 2 } })
  })

  it('edits participants, one entry per force or role (§3 rule 4)', () => {
    let draft = setParticipant(sample(), 'blue-hq', { kind: 'role', id: 'red-co', access: 'read' })
    draft = setParticipant(draft, 'blue-hq', { kind: 'force', id: 'blue', access: 'read' })
    expect(draft.design.rooms[0]?.participants).toEqual([
      { kind: 'force', id: 'blue', access: 'read' },
      { kind: 'role', id: 'red-co', access: 'read' },
    ])
    draft = removeParticipant(draft, 'blue-hq', 'force', 'blue')
    expect(draft.design.rooms[0]?.participants).toEqual([
      { kind: 'role', id: 'red-co', access: 'read' },
    ])
  })

  it('reorders rooms', () => {
    const draft = moveRoom(sample(), 'negotiation', 0)
    expect(orders(draft.design).rooms).toEqual(['negotiation:0', 'blue-hq:1', 'red-hq:2'])
  })

  it('deletes a room and retires its id', () => {
    const draft = deleteRoom(sample(), 'red-hq')
    expect(orders(draft.design).rooms).toEqual(['blue-hq:0', 'negotiation:1'])
    expect(draft.meta.retiredIds.rooms).toEqual(['red-hq'])
  })
})

describe('referencesTo', () => {
  it('lists roles, rooms and objectives of a force', () => {
    expect(referencesTo(sample().design, 'forces', 'blue')).toEqual([
      expect.objectContaining({ kind: 'role', id: 'blue-co', blocks: true }),
      expect.objectContaining({ kind: 'role', id: 'blue-observer', blocks: true }),
      expect.objectContaining({ kind: 'objectives', id: 'blue', blocks: false }),
      expect.objectContaining({ kind: 'room', id: 'blue-hq', name: 'Blue HQ', blocks: false }),
    ])
  })

  it('lists the rooms naming a role', () => {
    expect(referencesTo(sample().design, 'roles', 'red-co')).toEqual([
      {
        kind: 'room',
        id: 'negotiation',
        name: 'Blue–Red negotiation',
        effect: 'its participant entry is removed',
        blocks: false,
      },
    ])
    expect(referencesTo(sample().design, 'rooms', 'red-hq')).toEqual([])
  })
})

describe('normalise', () => {
  it('repairs gaps, duplicates and ties (§3 rule 7)', () => {
    const design = sampleDesign()
    const messy: DesignFile = {
      ...design,
      forces: design.forces.map((f, i) => ({ ...f, order: [5, 5, 1][i] ?? 0 })),
      roles: design.roles.map((r) => ({ ...r, order: 7 })),
      rooms: [...design.rooms].reverse().map((r) => ({ ...r, order: 3 })),
    }
    const tidy = normalise(messy)
    expect(orders(tidy)).toEqual({
      forces: ['white:0', 'blue:1', 'red:2'],
      roles: ['white/white-observer:0', 'blue/blue-co:0', 'blue/blue-observer:1', 'red/red-co:0'],
      rooms: ['blue-hq:0', 'negotiation:1', 'red-hq:2'],
    })
  })

  it('returns a consistent design unchanged', () => {
    const design = sampleDesign()
    expect(normalise(design)).toBe(design)
  })

  it('sorts roles of unknown forces last', () => {
    const design = sampleDesign()
    const orphan = { ...design.roles[0]!, id: 'orphan', forceId: 'ghost' }
    const tidy = normalise({ ...design, roles: [orphan, ...design.roles] })
    expect(tidy.roles.at(-1)?.id).toBe('orphan')
  })
})

describe('toDesignFile', () => {
  it('stamps exportedAt and validates', () => {
    const file = toDesignFile(sample(), NOW)
    expect(file.exportedAt).toBe(NOW.toISOString())
    expect(validateDraft(file, { registry: defaultRoomTypes() }).publishable).toBe(true)
    expect(toDesignFile(sample()).exportedAt).toMatch(/^\d{4}-/)
  })
})
