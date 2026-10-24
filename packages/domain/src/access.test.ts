import { describe, expect, it } from 'vitest'
import { accessOf, effectiveAccess, participantsOf, roomsForRole } from './access.ts'
import type { AccessInput } from './access.ts'
import { force, role, room } from './fixtures.ts'

function base(): AccessInput {
  return {
    forces: [
      force('blue', { order: 0 }),
      force('red', { order: 1 }),
      force('umpire', { order: 2, isUmpire: true }),
    ],
    roles: [
      role('blue-co', 'blue'),
      role('blue-2ic', 'blue', { order: 1 }),
      role('blue-observer', 'blue', { isObserver: true, order: 2 }),
      role('red-co', 'red'),
      role('umpire-1', 'umpire'),
      role('umpire-observer', 'umpire', { isObserver: true, order: 1 }),
    ],
    rooms: [],
  }
}

function matrixFor(rooms: AccessInput['rooms'], input: AccessInput = base()) {
  return effectiveAccess({ ...input, rooms })
}

describe('effectiveAccess (§3 rules 4 and 5)', () => {
  it('expands a force entry to every role of the force', () => {
    const m = matrixFor([room('blue-hq', [{ kind: 'force', id: 'blue', access: 'write' }])])
    expect(accessOf(m, 'blue-hq', 'blue-co')).toBe('write')
    expect(accessOf(m, 'blue-hq', 'blue-2ic')).toBe('write')
    expect(accessOf(m, 'blue-hq', 'red-co')).toBe('none')
    expect(m.cells.get('blue-hq')?.get('blue-co')?.reasons).toEqual(['force-entry'])
  })

  it('gives a read force entry read access', () => {
    const m = matrixFor([room('briefing', [{ kind: 'force', id: 'red', access: 'read' }])])
    expect(accessOf(m, 'briefing', 'red-co')).toBe('read')
  })

  it('takes role entries alone', () => {
    const m = matrixFor([
      room('talks', [
        { kind: 'role', id: 'blue-co', access: 'write' },
        { kind: 'role', id: 'red-co', access: 'read' },
      ]),
    ])
    expect(accessOf(m, 'talks', 'blue-co')).toBe('write')
    expect(accessOf(m, 'talks', 'red-co')).toBe('read')
    expect(accessOf(m, 'talks', 'blue-2ic')).toBe('none')
  })

  it('lets a role entry override its force entry, both ways', () => {
    const m = matrixFor([
      room('blue-hq', [
        { kind: 'force', id: 'blue', access: 'write' },
        { kind: 'role', id: 'blue-2ic', access: 'read' },
      ]),
      room('blue-log', [
        { kind: 'force', id: 'blue', access: 'read' },
        { kind: 'role', id: 'blue-co', access: 'write' },
      ]),
    ])
    expect(accessOf(m, 'blue-hq', 'blue-co')).toBe('write')
    expect(accessOf(m, 'blue-hq', 'blue-2ic')).toBe('read')
    expect(m.cells.get('blue-hq')?.get('blue-2ic')?.reasons).toEqual(['force-entry', 'role-entry'])
    expect(accessOf(m, 'blue-log', 'blue-co')).toBe('write')
    expect(accessOf(m, 'blue-log', 'blue-2ic')).toBe('read')
  })

  it('adds umpire-force roles to every room with write access (D8, PLY-15)', () => {
    const m = matrixFor([
      room('empty', []),
      room('red-hq', [{ kind: 'force', id: 'red', access: 'write' }]),
      room('umpires-read', [{ kind: 'role', id: 'umpire-1', access: 'read' }]),
    ])
    for (const roomId of ['empty', 'red-hq', 'umpires-read']) {
      expect(accessOf(m, roomId, 'umpire-1')).toBe('write')
    }
    expect(m.cells.get('empty')?.get('umpire-1')?.reasons).toEqual(['umpire'])
    expect(participantsOf(m, 'empty')).toEqual([
      { roleId: 'umpire-1', access: 'write' },
      { roleId: 'umpire-observer', access: 'read' },
    ])
  })

  it('caps observers at read, in every room, umpire or not (rule 5)', () => {
    const m = matrixFor([
      room('blue-hq', [{ kind: 'force', id: 'blue', access: 'write' }]),
      room('obs', [{ kind: 'role', id: 'blue-observer', access: 'write' }]),
      room('red-hq', [{ kind: 'force', id: 'red', access: 'write' }]),
    ])
    expect(accessOf(m, 'blue-hq', 'blue-observer')).toBe('read')
    expect(accessOf(m, 'obs', 'blue-observer')).toBe('read')
    expect(accessOf(m, 'red-hq', 'blue-observer')).toBe('none')
    expect(accessOf(m, 'red-hq', 'umpire-observer')).toBe('read')
    expect(m.cells.get('red-hq')?.get('umpire-observer')?.reasons).toEqual(['umpire', 'observer'])
    expect(m.cells.get('blue-hq')?.get('blue-observer')?.reasons).toEqual([
      'force-entry',
      'observer',
    ])
  })

  it('reports entries that name unknown forces or roles, and grants nothing for them', () => {
    const m = matrixFor([
      room('x', [
        { kind: 'force', id: 'green', access: 'write' },
        { kind: 'role', id: 'ghost', access: 'write' },
      ]),
    ])
    expect(m.problems).toEqual([
      { roomId: 'x', message: 'unknown force "green"' },
      { roomId: 'x', message: 'unknown role "ghost"' },
    ])
    expect(participantsOf(m, 'x').map((p) => p.roleId)).toEqual(['umpire-1', 'umpire-observer'])
  })

  it('handles roles of an unknown force: role entries only, never umpire', () => {
    const input = base()
    const m = effectiveAccess({
      ...input,
      roles: [...input.roles, role('stray', 'gone')],
      rooms: [
        room('a', [{ kind: 'role', id: 'stray', access: 'write' }]),
        room('b', [{ kind: 'force', id: 'gone', access: 'write' }]),
      ],
    })
    expect(accessOf(m, 'a', 'stray')).toBe('write')
    expect(accessOf(m, 'b', 'stray')).toBe('none')
    expect(m.roleIds[m.roleIds.length - 1]).toBe('stray')
  })

  it('orders rooms and roles by order, then id (rule 7)', () => {
    const m = matrixFor([
      room('zulu', [], { order: 0 }),
      room('alpha', [], { order: 1 }),
      room('bravo', [], { order: 1 }),
    ])
    expect(m.roomIds).toEqual(['zulu', 'alpha', 'bravo'])
    expect(m.roleIds).toEqual([
      'blue-co',
      'blue-2ic',
      'blue-observer',
      'red-co',
      'umpire-1',
      'umpire-observer',
    ])
  })

  it('fills every room × role cell, and answers none for unknown pairs', () => {
    const m = matrixFor([room('a', []), room('b', [])])
    for (const roomId of m.roomIds) expect(m.cells.get(roomId)?.size).toBe(m.roleIds.length)
    expect(accessOf(m, 'nope', 'blue-co')).toBe('none')
    expect(accessOf(m, 'a', 'nobody')).toBe('none')
  })

  it('lists the rooms a role sees, in order (PLY-4)', () => {
    const m = matrixFor([
      room('red-hq', [{ kind: 'force', id: 'red', access: 'write' }], { order: 1 }),
      room('blue-hq', [{ kind: 'force', id: 'blue', access: 'write' }], { order: 0 }),
      room('talks', [{ kind: 'role', id: 'blue-co', access: 'read' }], { order: 2 }),
    ])
    expect(roomsForRole(m, 'blue-co')).toEqual([
      { roomId: 'blue-hq', access: 'write' },
      { roomId: 'talks', access: 'read' },
    ])
    expect(roomsForRole(m, 'umpire-1').map((r) => r.roomId)).toEqual(['blue-hq', 'red-hq', 'talks'])
    expect(roomsForRole(m, 'nobody')).toEqual([])
  })

  it('ignores duplicate documents by id, keeping the last', () => {
    const input = base()
    const m = effectiveAccess({
      forces: [...input.forces, force('blue', { isUmpire: true })],
      roles: input.roles,
      rooms: [room('a', []), room('a', [{ kind: 'force', id: 'red', access: 'write' }])],
    })
    expect(m.roomIds).toEqual(['a'])
    expect(accessOf(m, 'a', 'red-co')).toBe('write')
    expect(accessOf(m, 'a', 'blue-co')).toBe('write')
  })

  it('accepts a design file directly (ADM-9)', () => {
    const design = { ...base(), rooms: [room('a', [])], format: 'wrx1-design' }
    expect(effectiveAccess(design).roomIds).toEqual(['a'])
  })

  it('is pure: the same input gives the same answer and is not changed', () => {
    const input = {
      ...base(),
      rooms: [room('a', [{ kind: 'force', id: 'blue', access: 'write' }])],
    }
    const copy = structuredClone(input)
    expect(effectiveAccess(input)).toEqual(effectiveAccess(input))
    expect(input).toEqual(copy)
  })
})
