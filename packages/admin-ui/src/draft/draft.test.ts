import { effectiveAccess, accessOf, defaultRoomTypes } from '@wrx/domain'
import { isId } from '@wrx/schemas'
import type { DesignFile, Result } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
// The schemas package keeps its sample design with its tests and does not export it.
import {
  ROOM,
  blueReportsConfig,
  nameOf,
  sampleDesign,
  sampleTemplates,
  templatedDesign,
  tid,
} from '../../../schemas/src/fixtures.ts'
import {
  DEFAULT_FORCE_COLOUR,
  addForce,
  addRole,
  addRoom,
  changeLoginName,
  createDraft,
  deleteForce,
  deleteRole,
  deleteRoom,
  draftFromDesign,
  isMapRoom,
  isRolePublished,
  loginNameProblem,
  markPublished,
  markRolesPublished,
  mergeRetired,
  mergeTemplateLocks,
  moveForce,
  moveRole,
  moveRoom,
  normalise,
  objectivesOf,
  referencesTo,
  removeParticipant,
  setObjectives,
  setParticipant,
  sortedRoles,
  takenLoginNames,
  toDesignFile,
  updateForce,
  updateGame,
  updateRole,
  updateRoom,
} from './draft.ts'
import type { Draft } from './draft.ts'
import { validateDraft } from './validate.ts'

const NOW = new Date('2026-10-25T10:00:00.000Z')

/** The sample design as a draft; the map room the draft adds has the fixture's id (§3 rule 18). */
function sample(): Draft {
  return draftFromDesign(sampleDesign(), {}, () => ROOM.map)
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

/** Short names for the sample design's GUIDs, so orders read as before. */
const short = (id: string) => nameOf(id) ?? id

/** A counter of GUIDs, so generated ids are predictable here. */
function counter(prefix = 'a'): () => string {
  let n = 0
  return () => `${prefix}0000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`
}

function orders(design: DesignFile) {
  return {
    forces: design.forces.map((f) => `${short(f.id)}:${f.order}`),
    roles: design.roles.map((r) => `${short(r.forceId)}/${r.loginName}:${r.order}`),
    rooms: design.rooms.map((r) => `${short(r.id)}:${r.order}`),
  }
}

const GREEN = tid('green')

describe('createDraft', () => {
  it('starts a valid design with the White Force only (ADM-4)', () => {
    const draft = createDraft({ name: 'Exercise', now: NOW, whiteForceId: tid('white') })
    expect(draft.design.game.name).toBe('Exercise')
    expect(draft.design.exportedAt).toBe(NOW.toISOString())
    expect(draft.design.schemaVersion).toBe(2)
    expect(draft.design.forces).toEqual([
      {
        schemaVersion: 1,
        id: tid('white'),
        name: 'White',
        colour: DEFAULT_FORCE_COLOUR,
        isUmpire: true,
        order: 0,
      },
    ])
    expect(draft.design.roles).toEqual([])
    expect(draft.design.retired).toEqual([])
    // §3 rule 18: the game's one map room, with every force (here only White), read only.
    expect(draft.design.rooms).toEqual([
      {
        schemaVersion: 1,
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        name: 'Map',
        roomType: 'map',
        participants: [{ kind: 'force', id: tid('white'), access: 'write' }],
        config: {},
        order: 0,
      },
    ])
    expect(draft.meta).toEqual({ publishedRoleIds: [], publishedForceIds: [] })
    expect(validateDraft(draft.design).issues).toEqual([])
  })

  it('names the game by default, and gives the White Force a new GUID', () => {
    const draft = createDraft()
    expect(draft.design.game.name).toBe('Untitled game')
    expect(isId(draft.design.forces[0]?.id ?? '')).toBe(true)
    expect(createDraft().design.forces[0]?.id).not.toBe(draft.design.forces[0]?.id)
  })
})

describe('immutability', () => {
  it('never mutates its input', () => {
    const id = counter()
    let draft = frozen(sample())
    draft = frozen(updateGame(draft, { name: 'X' }))
    const green = addForce(draft, 'Green', id)
    draft = frozen(green.draft)
    draft = frozen(
      updateForce(draft, green.id, { colour: '#00ff00', iconAssetId: tid('game-logo') }),
    )
    draft = frozen(updateForce(draft, green.id, { iconAssetId: null }))
    const co = addRole(draft, green.id, 'Green CO', id)
    draft = frozen(co.draft)
    draft = frozen(moveRole(draft, co.id, tid('blue'), 0))
    draft = frozen(updateRole(draft, co.id, { isObserver: true }))
    draft = frozen(ok(changeLoginName(draft, co.id, 'g-co')))
    const room = addRoom(draft, 'Green room', 'chat', id)
    draft = frozen(room.draft)
    draft = frozen(setParticipant(draft, room.id, { kind: 'role', id: co.id, access: 'read' }))
    draft = frozen(removeParticipant(draft, room.id, 'role', co.id))
    draft = frozen(updateRoom(draft, room.id, { name: 'G', roomType: 'chat' }))
    draft = frozen(moveRoom(draft, room.id, 0))
    draft = frozen(moveForce(draft, green.id, 0))
    draft = frozen(setObjectives(draft, green.id, 'Win', NOW))
    draft = frozen(deleteRole(draft, co.id))
    draft = frozen(deleteRoom(draft, room.id))
    expect(ok(deleteForce(draft, green.id)).design.forces).toHaveLength(3)
  })

  it('keeps the identity of unchanged items', () => {
    const draft = sample()
    const next = updateForce(draft, tid('red'), { name: 'Crimson' })
    expect(next.design.forces[0]).toBe(draft.design.forces[0])
    expect(next.design.forces[1]).not.toBe(draft.design.forces[1])
    expect(next.design.roles).toBe(draft.design.roles)
  })

  it('returns the same draft for unknown ids', () => {
    const draft = sample()
    expect(deleteRole(draft, tid('nobody'))).toBe(draft)
    expect(deleteRoom(draft, tid('nowhere'))).toBe(draft)
    expect(moveRole(draft, tid('nobody'), tid('blue'))).toBe(draft)
    expect(moveRole(draft, tid('blue-co'), tid('no-force'))).toBe(draft)
    expect(setObjectives(draft, tid('no-force'), 'x')).toBe(draft)
    expect(deleteForce(draft, tid('no-force'))).toEqual({ ok: true, value: draft })
    expect(changeLoginName(draft, tid('nobody'), 'x')).toEqual({ ok: true, value: draft })
    expect(changeLoginName(draft, tid('blue-co'), 'blue-co')).toEqual({ ok: true, value: draft })
  })
})

describe('ids are GUIDs, never derived from names (§3 rule 1)', () => {
  it('gives a new force, role and room a new GUID', () => {
    const { draft, id } = addForce(createDraft(), 'Blue Force — Écosse')
    expect(isId(id)).toBe(true)
    expect(draft.design.forces[1]).toMatchObject({
      id,
      name: 'Blue Force — Écosse',
      colour: DEFAULT_FORCE_COLOUR,
      isUmpire: false,
      order: 1,
    })
    const role = addRole(draft, id, 'Blue CO')
    const room = addRoom(role.draft, 'Blue CO')
    expect(isId(role.id) && isId(room.id)).toBe(true)
    expect(new Set([id, role.id, room.id]).size).toBe(3)
  })

  it('gives the same name a different id every time', () => {
    const one = addForce(createDraft(), 'Blue')
    const two = addForce(one.draft, 'Blue')
    expect(one.id).not.toBe(two.id)
    expect(two.draft.design.forces.map((f) => f.name)).toEqual(['White', 'Blue', 'Blue'])
  })

  it('takes ids from the source it is given', () => {
    const id = counter('b')
    expect(addRoom(createDraft(), 'Ops', 'chat', id).id).toBe(
      'b0000000-0000-4000-8000-000000000001',
    )
  })

  it('refuses a role for an unknown force', () => {
    expect(() => addRole(createDraft(), GREEN, 'X')).toThrow(RangeError)
  })
})

describe('login names (§3 rule 1, ADM-5)', () => {
  it('makes a login name from the role name, unique among roles', () => {
    const blue = addForce(createDraft(), 'Blue')
    const one = addRole(blue.draft, blue.id, 'Blue Force — Écosse')
    expect(one.draft.design.roles[0]?.loginName).toBe('blue-force-ecosse')
    const two = addRole(one.draft, blue.id, 'Blue Force — Écosse')
    expect(two.draft.design.roles.map((r) => r.loginName)).toEqual([
      'blue-force-ecosse',
      'blue-force-ecosse-2',
    ])
    const added = addRole(sample(), tid('blue'), 'Blue CO')
    expect(added.draft.design.roles.find((r) => r.id === added.id)?.loginName).toBe('blue-co-2')
  })

  it('falls back to `role` for names without letters or digits', () => {
    const force = addForce(createDraft(), 'F')
    expect(addRole(force.draft, force.id, '—').draft.design.roles[0]?.loginName).toBe('role')
  })

  it('never gives a role a reserved login name', () => {
    const force = addForce(createDraft(), 'Blue')
    const login = (name: string) =>
      addRole(force.draft, force.id, name).draft.design.roles[0]?.loginName
    expect(login('Admin')).toBe('admin-2')
    expect(login('Anonymous')).toBe('anonymous-2')
    expect(takenLoginNames(force.draft)).toEqual(new Set(['admin', 'anonymous']))
  })

  it('never gives a role a login name that looks like an anonymous session (security review F4)', () => {
    const force = addForce(createDraft(), 'Blue')
    const login = (name: string) =>
      addRole(force.draft, force.id, name).draft.design.roles[0]?.loginName
    expect(login('1234567890123456')).toBe('role-1234567890123456')
    expect(login('123456789012345')).toBe('123456789012345')
    expect(loginNameProblem(sample(), tid('blue-co'), '1234567890123456')).toBe(
      '"1234567890123456" is reserved',
    )
  })

  it('changes a login name before the first publish; nothing else changes', () => {
    const before = sample()
    const draft = ok(changeLoginName(before, tid('blue-co'), 'blue-commander'))
    const role = draft.design.roles.find((r) => r.id === tid('blue-co'))
    expect(role?.loginName).toBe('blue-commander')
    // Room entries name the role by its GUID, so they do not change.
    expect(draft.design.rooms).toBe(before.design.rooms)
    // An unpublished role's old login name is free again.
    expect(loginNameProblem(draft, tid('blue-observer'), 'blue-co')).toBeUndefined()
  })

  it('refuses bad, reserved and taken login names', () => {
    const draft = sample()
    const co = tid('blue-co')
    expect(loginNameProblem(draft, co, 'Blue CO')).toBe(
      'use lowercase letters, digits and single hyphens',
    )
    expect(loginNameProblem(draft, co, 'admin')).toBe('"admin" is reserved')
    expect(loginNameProblem(draft, co, 'red-co')).toBe('another role is "red-co"')
    expect(loginNameProblem(draft, co, 'blue-co')).toBeUndefined()
    expect(changeLoginName(draft, co, 'admin')).toEqual({
      ok: false,
      error: '"admin" is reserved',
    })
  })

  it('fixes login names once published (merge record N2)', () => {
    const draft = markPublished(sample())
    expect(isRolePublished(draft, tid('blue-co'))).toBe(true)
    expect(loginNameProblem(draft, tid('blue-co'), 'blue-x')).toBe(
      'the login name cannot change after the role has been published',
    )
    // A role added after the publish can still change.
    const added = addRole(draft, tid('blue'), 'New')
    expect(isRolePublished(added.draft, added.id)).toBe(false)
    expect(loginNameProblem(added.draft, added.id, 'fresh')).toBeUndefined()
    // Publishing twice keeps one entry per role.
    expect(markPublished(markPublished(draft)).meta.publishedRoleIds).toHaveLength(4)
    expect(markPublished(draft).meta.publishedForceIds).toHaveLength(3)
  })

  it('marks roles published by the login names the server has', () => {
    const draft = markRolesPublished(sample(), ['red-co', 'stranger'])
    expect(draft.meta.publishedRoleIds).toEqual([tid('red-co')])
    expect(markRolesPublished(draft, ['red-co'])).toBe(draft)
  })
})

describe('deleted forces and roles keep their last names (§3 rule 1, ADM-14)', () => {
  it('records a published role, and its login name is never given to another role', () => {
    const draft = deleteRole(markPublished(sample()), tid('red-co'), NOW)
    expect(draft.design.retired).toEqual([
      {
        schemaVersion: 1,
        id: tid('red-co'),
        kind: 'role',
        name: 'Red CO',
        loginName: 'red-co',
        colour: '#b91c1c',
        deletedAt: NOW.toISOString(),
      },
    ])
    const added = addRole(draft, tid('red'), 'Red CO')
    expect(added.draft.design.roles.find((r) => r.id === added.id)?.loginName).toBe('red-co-2')
    expect(loginNameProblem(added.draft, added.id, 'red-co')).toBe(
      '"red-co" was used by a deleted role and cannot be reused',
    )
    expect(validateDraft(added.draft.design).publishable).toBe(true)
  })

  it('records nothing for a role that was never published; its login name is free', () => {
    const draft = deleteRole(sample(), tid('red-co'))
    expect(draft.design.retired).toEqual([])
    const added = addRole(draft, tid('red'), 'Red CO')
    expect(added.draft.design.roles.find((r) => r.id === added.id)?.loginName).toBe('red-co')
  })

  it('records a published force when it is deleted', () => {
    let draft = markPublished(sample())
    draft = deleteRole(draft, tid('red-co'), NOW)
    draft = ok(deleteForce(draft, tid('red'), NOW))
    expect(draft.design.retired.map((r) => [r.kind, r.name, r.colour])).toEqual([
      ['role', 'Red CO', '#b91c1c'],
      ['force', 'Red', '#b91c1c'],
    ])
    expect(validateDraft(draft.design).publishable).toBe(true)
  })

  it('takes the server’s records it does not hold, and no record of an entity it has', () => {
    const record = {
      schemaVersion: 1 as const,
      id: tid('old-co'),
      kind: 'role' as const,
      name: 'Old CO',
      loginName: 'old-co',
      deletedAt: NOW.toISOString(),
    }
    const draft = mergeRetired(sample(), [record, { ...record, id: tid('blue-co') }])
    expect(draft.design.retired).toEqual([record])
    expect(mergeRetired(draft, [record])).toBe(draft)
    expect(takenLoginNames(draft).has('old-co')).toBe(true)
  })
})

describe('template entries in room configs (TPL-2, WP 4.1)', () => {
  it('drops a deleted role’s template entries with its participant entries', () => {
    const draft = draftFromDesign(templatedDesign())
    const after = deleteRole(draft, tid('blue-co'), NOW)
    const reports = after.design.rooms.find((r) => r.id === ROOM.blueReports)
    expect(reports?.config).toEqual({
      ...blueReportsConfig(),
      templates: blueReportsConfig().templates.filter((e) => e.kind !== 'role'),
    })
    expect(validateDraft(after.design).publishable).toBe(true)
  })
})

describe('template locks from the server (TD6, WP 4.1)', () => {
  it('takes the server’s locks, never removes one, and keeps the same draft when nothing changes', () => {
    const [a, b, c] = sampleTemplates()
    const draft = draftFromDesign({
      ...sampleDesign(),
      templates: [a!, { ...b!, lockedAt: 'x' }, c!],
    })
    const locked = '2026-10-24T09:00:00.000Z'
    const merged = mergeTemplateLocks(draft, [
      { ...a!, lockedAt: locked },
      { ...b!, lockedAt: undefined },
    ])
    expect(merged.design.templates.map((t) => t.lockedAt)).toEqual([locked, 'x', undefined])
    expect(mergeTemplateLocks(merged, [{ ...a!, lockedAt: locked }])).toBe(merged)
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
    let draft = updateForce(sample(), tid('blue'), {
      name: 'Azure',
      colour: '#0000ff',
      iconAssetId: tid('game-logo'),
      isUmpire: true,
    })
    expect(draft.design.forces[0]).toMatchObject({
      name: 'Azure',
      colour: '#0000ff',
      iconAssetId: tid('game-logo'),
      isUmpire: true,
    })
    draft = updateForce(draft, tid('blue'), { iconAssetId: null })
    expect(draft.design.forces[0]).not.toHaveProperty('iconAssetId')
    draft = updateForce(draft, tid('blue'), { name: 'Navy' })
    expect(draft.design.forces[0]).not.toHaveProperty('iconAssetId')
  })

  it('keeps exactly one umpire flag: setting it clears it elsewhere (ADM-4)', () => {
    const draft = updateForce(sample(), tid('red'), { isUmpire: true })
    expect(draft.design.forces.filter((f) => f.isUmpire).map((f) => short(f.id))).toEqual(['red'])
    // Clearing it leaves none, which validation warns about.
    const none = updateForce(draft, tid('red'), { isUmpire: false })
    expect(none.design.forces.some((f) => f.isUmpire)).toBe(false)
    expect(validateDraft(none.design).issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', path: 'forces' }),
    )
  })

  it('refuses to delete a force that has roles', () => {
    const result = deleteForce(sample(), tid('blue'))
    expect(result).toEqual({
      ok: false,
      error: 'Blue still has 2 roles; move or delete them first',
    })
    const one = deleteForce(deleteRole(sample(), tid('blue-observer')), tid('blue'))
    expect(one).toEqual({ ok: false, error: 'Blue still has 1 role; move or delete them first' })
  })

  it('deletes a force with its objectives and participant entries', () => {
    let draft = deleteRole(sample(), tid('red-co'))
    draft = ok(deleteForce(draft, tid('red')))
    expect(draft.design.forces.map((f) => short(f.id))).toEqual(['blue', 'white'])
    expect(draft.design.forces.map((f) => f.order)).toEqual([0, 1])
    expect(objectivesOf(draft.design, tid('red'))).toBeUndefined()
    expect(draft.design.rooms.find((r) => r.id === tid('red-hq'))?.participants).toEqual([])
    // Never published, so no record is kept.
    expect(draft.design.retired).toEqual([])
  })

  it('reorders and keeps orders 0…n-1 (§3 rule 7)', () => {
    let draft = moveForce(sample(), tid('white'), 0)
    expect(orders(draft.design).forces).toEqual(['white:0', 'blue:1', 'red:2'])
    draft = moveForce(draft, tid('white'), 99)
    expect(orders(draft.design).forces).toEqual(['blue:0', 'red:1', 'white:2'])
    draft = moveForce(draft, tid('blue'), -5)
    expect(orders(draft.design).forces).toEqual(['blue:0', 'red:1', 'white:2'])
    expect(moveForce(draft, tid('ghost'), 0).design.forces).toEqual(draft.design.forces)
  })

  it('sorts roles by force order after a force moves', () => {
    const draft = moveForce(sample(), tid('red'), 0)
    expect(sortedRoles(draft.design).map((r) => r.loginName)).toEqual([
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
    const draft = setObjectives(sample(), tid('blue'), '## Hold', NOW)
    expect(objectivesOf(draft.design, tid('blue'))).toEqual({
      schemaVersion: 1,
      forceId: tid('blue'),
      markdown: '## Hold',
      updatedAt: NOW.toISOString(),
    })
    expect(draft.design.objectives.filter((o) => o.forceId === tid('blue'))).toHaveLength(1)
    const white = setObjectives(draft, tid('white'), 'Watch')
    expect(objectivesOf(white.design, tid('white'))?.markdown).toBe('Watch')
  })
})

describe('roles', () => {
  it('edits name and observer flag', () => {
    const draft = updateRole(sample(), tid('red-co'), { name: 'Red Commander', isObserver: true })
    expect(draft.design.roles.find((r) => r.id === tid('red-co'))).toMatchObject({
      name: 'Red Commander',
      isObserver: true,
    })
  })

  it('adds a role at the end of its force', () => {
    const { draft, id } = addRole(sample(), tid('blue'), 'Blue Logistics')
    expect(draft.design.roles.find((r) => r.id === id)?.loginName).toBe('blue-logistics')
    expect(orders(draft.design).roles).toEqual([
      'blue/blue-co:0',
      'blue/blue-observer:1',
      'blue/blue-logistics:2',
      'red/red-co:0',
      'white/white-observer:0',
    ])
  })

  it('reorders within a force', () => {
    const draft = moveRole(sample(), tid('blue-observer'), tid('blue'), 0)
    expect(orders(draft.design).roles.slice(0, 2)).toEqual([
      'blue/blue-observer:0',
      'blue/blue-co:1',
    ])
  })

  it('moves between forces and keeps its id (ADM-5)', () => {
    const before = sample()
    const draft = moveRole(before, tid('blue-co'), tid('red'), 0)
    const moved = draft.design.roles.find((r) => r.id === tid('blue-co'))
    expect(moved).toMatchObject({ id: tid('blue-co'), forceId: tid('red'), order: 0 })
    expect(orders(draft.design).roles).toEqual([
      'blue/blue-observer:0',
      'red/blue-co:0',
      'red/red-co:1',
      'white/white-observer:0',
    ])
    // Its room entries still name it.
    expect(
      draft.design.rooms.find((r) => r.id === tid('negotiation'))?.participants,
    ).toContainEqual({
      kind: 'role',
      id: tid('blue-co'),
      access: 'write',
    })
    // And it now reads Red HQ through the Red force entry, and not Blue HQ.
    const matrix = effectiveAccess(draft.design)
    expect(accessOf(matrix, tid('red-hq'), tid('blue-co'))).toBe('write')
    expect(accessOf(matrix, tid('blue-hq'), tid('blue-co'))).toBe('none')
  })

  it('moves to the end of another force by default', () => {
    const draft = moveRole(sample(), tid('red-co'), tid('blue'))
    expect(draft.design.roles.find((r) => r.id === tid('red-co'))).toMatchObject({
      forceId: tid('blue'),
      order: 2,
    })
  })

  it('deletes a role and its entries', () => {
    const draft = deleteRole(sample(), tid('blue-co'))
    expect(draft.design.roles.map((r) => r.id)).not.toContain(tid('blue-co'))
    expect(draft.design.roles.find((r) => r.id === tid('blue-observer'))?.order).toBe(0)
    expect(draft.design.rooms.find((r) => r.id === tid('negotiation'))?.participants).toEqual([
      { kind: 'role', id: tid('red-co'), access: 'write' },
    ])
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
      order: 4,
    })
  })

  it('edits name, type and config', () => {
    let draft = updateRoom(sample(), tid('blue-hq'), { config: { a: 1 } })
    expect(draft.design.rooms[0]?.config).toEqual({ a: 1 })
    draft = updateRoom(draft, tid('blue-hq'), { name: 'Blue Ops' })
    expect(draft.design.rooms[0]).toMatchObject({ name: 'Blue Ops', config: { a: 1 } })
    draft = updateRoom(draft, tid('blue-hq'), { roomType: 'chat' })
    expect(draft.design.rooms[0]?.config).toEqual({ a: 1 })
    draft = updateRoom(draft, tid('blue-hq'), { roomType: 'poll' })
    expect(draft.design.rooms[0]).toMatchObject({ roomType: 'poll', config: {} })
    draft = updateRoom(draft, tid('blue-hq'), { roomType: 'chat', config: { b: 2 } })
    expect(draft.design.rooms[0]).toMatchObject({ roomType: 'chat', config: { b: 2 } })
  })

  it('edits participants, one entry per force or role (§3 rule 4)', () => {
    let draft = setParticipant(sample(), tid('blue-hq'), {
      kind: 'role',
      id: tid('red-co'),
      access: 'read',
    })
    draft = setParticipant(draft, tid('blue-hq'), {
      kind: 'force',
      id: tid('blue'),
      access: 'read',
    })
    expect(draft.design.rooms[0]?.participants).toEqual([
      { kind: 'force', id: tid('blue'), access: 'read' },
      { kind: 'role', id: tid('red-co'), access: 'read' },
    ])
    draft = removeParticipant(draft, tid('blue-hq'), 'force', tid('blue'))
    expect(draft.design.rooms[0]?.participants).toEqual([
      { kind: 'role', id: tid('red-co'), access: 'read' },
    ])
  })

  it('reorders rooms', () => {
    const draft = moveRoom(sample(), tid('negotiation'), 0)
    expect(orders(draft.design).rooms).toEqual(['negotiation:0', 'blue-hq:1', 'red-hq:2', 'map:3'])
  })

  it('deletes a room', () => {
    const draft = deleteRoom(sample(), tid('red-hq'))
    expect(orders(draft.design).rooms).toEqual(['blue-hq:0', 'negotiation:1', 'map:2'])
  })
})

describe('the map room (§3 rule 18)', () => {
  const map = (draft: Draft) => draft.design.rooms.find((r) => r.roomType === 'map')
  const every = (draft: Draft) =>
    draft.design.forces.map((f) => ({ kind: 'force', id: f.id, access: 'write' }))

  it('is added to a design without one, once, and is valid', () => {
    const draft = sample()
    expect(map(draft)).toMatchObject({ id: ROOM.map, name: 'Map', participants: every(draft) })
    expect(draftFromDesign(draft.design, {}, () => 'unused').design).toBe(draft.design)
    expect(validateDraft(draft.design, { registry: defaultRoomTypes() }).issues).toEqual([])
  })

  it('cannot be deleted, retyped, duplicated or given other participants', () => {
    const draft = sample()
    expect(deleteRoom(draft, ROOM.map)).toBe(draft)
    expect(
      setParticipant(draft, ROOM.map, { kind: 'role', id: tid('blue-co'), access: 'write' }),
    ).toBe(draft)
    expect(removeParticipant(draft, ROOM.map, 'force', tid('blue'))).toBe(draft)
    expect(addRoom(draft, 'Second map', 'map')).toEqual({ draft, id: '' })
    expect(map(updateRoom(draft, ROOM.map, { roomType: 'chat' }))?.roomType).toBe('map')
    expect(updateRoom(draft, tid('blue-hq'), { roomType: 'map' }).design.rooms[0]?.roomType).toBe(
      'chat',
    )
    // Its name and order are the admin's.
    expect(map(updateRoom(draft, ROOM.map, { name: 'Theatre' }))?.name).toBe('Theatre')
    expect(isMapRoom({ roomType: 'map' })).toBe(true)
  })

  it('follows the forces as they are added and deleted', () => {
    const added = addForce(sample(), 'Green', () => GREEN)
    expect(map(added.draft)?.participants).toEqual(every(added.draft))
    expect(map(added.draft)?.participants).toContainEqual({
      kind: 'force',
      id: GREEN,
      access: 'write',
    })
    const deleted = deleteForce(added.draft, GREEN)
    if (!deleted.ok) throw new Error(deleted.error)
    expect(map(deleted.value)?.participants).toEqual(every(sample()))
    // Reordering forces changes nothing: the entries are a set.
    const moved = moveForce(sample(), tid('white'), 0)
    expect(map(moved)?.participants).toEqual(map(sample())?.participants)
  })

  it('is not listed among the rooms a force’s deletion changes', () => {
    expect(referencesTo(sample().design, 'forces', tid('blue')).map((r) => r.id)).not.toContain(
      ROOM.map,
    )
  })
})

describe('referencesTo', () => {
  it('lists roles, rooms and objectives of a force', () => {
    expect(referencesTo(sample().design, 'forces', tid('blue'))).toEqual([
      expect.objectContaining({ kind: 'role', id: tid('blue-co'), blocks: true }),
      expect.objectContaining({ kind: 'role', id: tid('blue-observer'), blocks: true }),
      expect.objectContaining({ kind: 'objectives', id: tid('blue'), blocks: false }),
      expect.objectContaining({ kind: 'room', id: tid('blue-hq'), name: 'Blue HQ', blocks: false }),
    ])
  })

  it('lists the rooms naming a role', () => {
    expect(referencesTo(sample().design, 'roles', tid('red-co'))).toEqual([
      {
        kind: 'room',
        id: tid('negotiation'),
        name: 'Blue–Red negotiation',
        effect: 'its participant entry is removed',
        blocks: false,
      },
    ])
    expect(referencesTo(sample().design, 'rooms', tid('red-hq'))).toEqual([])
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
      // Ties sort by id: the fixed GUIDs put Blue HQ, then Red HQ, then the negotiation room.
      rooms: ['blue-hq:0', 'red-hq:1', 'negotiation:2'],
    })
  })

  it('returns a consistent design unchanged', () => {
    const design = sampleDesign()
    expect(normalise(design)).toBe(design)
  })

  it('sorts roles of unknown forces last', () => {
    const design = sampleDesign()
    const orphan = { ...design.roles[0]!, id: tid('orphan'), forceId: tid('ghost') }
    const tidy = normalise({ ...design, roles: [orphan, ...design.roles] })
    expect(tidy.roles.at(-1)?.id).toBe(tid('orphan'))
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
