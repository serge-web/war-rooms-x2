// Unit tests of the publish planner over hand-built server views: what each kind of change plans,
// the order of steps, idempotency, warnings, the vault, and the design version.
import type { DesignFile } from '@wrx/schemas'
import { sampleDesign } from '@wrx/schemas/fixtures'
import { describe, expect, it } from 'vitest'
import { DOMAIN, emptyView, jid, publishedView, withNode } from './fixtures.ts'
import {
  needsConfirmation,
  planPublish,
  planReset,
  publishedDesign,
  roomsToDestroy,
} from './plan.ts'
import type { PlanStep, PublishPlan } from './plan.ts'

const ids = (plan: PublishPlan) => plan.steps.map((s) => s.id)
const step = (plan: PublishPlan, id: string): PlanStep => {
  const found = plan.steps.find((s) => s.id === id)
  if (found === undefined) throw new Error(`no step ${id} in ${ids(plan).join(', ')}`)
  return found
}
const index = (plan: PublishPlan, id: string) => ids(plan).indexOf(step(plan, id).id)

function edit(change: (d: DesignFile) => DesignFile): DesignFile {
  return change(sampleDesign())
}

describe('first publish onto an empty server', () => {
  const plan = planPublish(sampleDesign(), emptyView())

  it('creates every account, room and node, grants access and publishes every document', () => {
    expect(plan.steps.filter((s) => s.group === 'accounts').map((s) => s.action)).toEqual([
      { type: 'create-account', roleId: 'blue-co', readOnly: false },
      { type: 'create-account', roleId: 'blue-observer', readOnly: true },
      { type: 'create-account', roleId: 'red-co', readOnly: false },
      { type: 'create-account', roleId: 'umpire-1', readOnly: false },
    ])
    expect(ids(plan)).toEqual(
      expect.arrayContaining(['room:blue-hq', 'node:game-setup', 'grant-room:blue-hq']),
    )
    expect(plan.steps.filter((s) => s.group === 'removals')).toEqual([])
  })

  it('orders accounts, rooms, nodes, access, documents; game-setup last (§3 rule 8)', () => {
    const order = ['accounts', 'rooms', 'nodes', 'access', 'documents']
    const groups = plan.steps.map((s) => order.indexOf(s.group))
    expect(groups).toEqual([...groups].sort((a, b) => a - b))
    expect(ids(plan).at(-1)).toBe('doc:game-setup:current')
    expect(plan.designVersion).toBe(1)
  })

  it('makes the observer read-only through the vault before any room document', () => {
    const readOnly = step(plan, 'read-only-grant:blue-observer')
    expect(readOnly.action).toEqual({
      type: 'read-only',
      roleId: 'blue-observer',
      roomIds: ['blue-hq'],
    })
    expect(index(plan, 'read-only-grant:blue-observer')).toBeLessThan(
      index(plan, 'doc:rooms:blue-hq:current'),
    )
    expect(plan.vault).toBe('create')
  })

  it('publishes objectives as the admin’s item, after the force and role documents', () => {
    const objectives = step(plan, 'doc:objectives:blue:admin')
    expect(objectives.action).toMatchObject({ type: 'publish', itemId: 'admin' })
    expect(index(plan, 'doc:forces:blue:current')).toBeLessThan(
      index(plan, 'doc:objectives:blue:admin'),
    )
    expect(index(plan, 'doc:assets:game-logo:current')).toBeLessThan(
      index(plan, 'doc:forces:blue:current'),
    )
  })

  it('creates every node before it publishes to it', () => {
    for (const s of plan.steps) {
      if (s.action.type !== 'publish') continue
      expect(index(plan, `node:${s.action.node}`), s.id).toBeLessThan(index(plan, s.id))
    }
  })

  it('gives umpires publish on objectives and leaves open nodes without affiliations', () => {
    const objectives = step(plan, 'grant-node:objectives:red').action
    const changes = objectives.type === 'node-access' ? objectives.changes : []
    expect(changes).toContainEqual({ roleId: 'umpire-1', access: 'publish' })
    expect(changes).toContainEqual({ roleId: 'red-co', access: 'read' })
    expect(ids(plan)).not.toContain('grant-node:game-setup')
    expect(ids(plan)).not.toContain('grant-node:assets:game-logo')
  })
})

describe('idempotency (ADM-10)', () => {
  it('plans nothing for a server that already matches', () => {
    const plan = planPublish(sampleDesign(), publishedView(sampleDesign()))
    expect(plan.steps).toEqual([])
    expect(plan.designVersion).toBeUndefined()
    expect(plan.vault).toBe('none')
    expect(plan.warnings).toEqual([])
  })

  it('compares documents by content, not key order', () => {
    const view = withNode(publishedView(sampleDesign()), 'forces:blue', (n) => ({
      ...n,
      items: [
        {
          id: 'current',
          payload: JSON.stringify({ ...sampleDesign().forces[0] }),
          publisher: undefined,
        },
      ],
    }))
    const reordered = withNode(view, 'forces:blue', (n) => {
      const doc = sampleDesign().forces[0]!
      const shuffled = Object.fromEntries(Object.entries(doc).reverse())
      return {
        ...n,
        items: [{ id: 'current', payload: JSON.stringify(shuffled), publisher: undefined }],
      }
    })
    expect(planPublish(sampleDesign(), reordered).steps).toEqual([])
  })

  it('ignores a draft designVersion that differs from the published one', () => {
    const design = edit((d) => ({ ...d, game: { ...d.game, designVersion: 7 } }))
    expect(planPublish(design, publishedView(sampleDesign())).steps).toEqual([])
  })

  it('does not touch umpires’ objectives items or announcements', () => {
    const view = withNode(
      withNode(publishedView(sampleDesign()), 'objectives:blue', (n) => ({
        ...n,
        items: [...n.items, { id: 'umpire-1', payload: '{"x":1}', publisher: jid('umpire-1') }],
      })),
      'announcements',
      (n) => ({ ...n, items: [{ id: 'a1', payload: '{}', publisher: jid('admin') }] }),
    )
    expect(planPublish(sampleDesign(), view).steps).toEqual([])
  })
})

describe('changes', () => {
  const published = publishedView(sampleDesign())

  it('a rename changes the room config and documents only, and bumps the version', () => {
    const design = edit((d) => ({
      ...d,
      rooms: d.rooms.map((r) => (r.id === 'red-hq' ? { ...r, name: 'Red headquarters' } : r)),
    }))
    const plan = planPublish(design, published)
    expect(ids(plan)).toEqual(['room:red-hq', 'doc:rooms:red-hq:current', 'doc:game-setup:current'])
    expect(step(plan, 'room:red-hq').details).toEqual(['name: Red HQ → Red headquarters'])
    expect(plan.designVersion).toBe(2)
    expect(
      JSON.parse((step(plan, 'doc:game-setup:current').action as { payload: string }).payload),
    ).toMatchObject({ designVersion: 2 })
  })

  it('a role move grants the new access before revoking the old (R-D) and warns (ADM-13)', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.id === 'blue-co' ? { ...r, forceId: 'red' } : r)),
    }))
    const plan = planPublish(design, { ...published, online: ['blue-co', 'red-co'] })
    const grants = ['grant-room:red-hq', 'grant-node:objectives:red'].map((id) => index(plan, id))
    const revokes = ['revoke-room:blue-hq', 'revoke-node:objectives:blue'].map((id) =>
      index(plan, id),
    )
    expect(Math.max(...grants)).toBeLessThan(Math.min(...revokes))
    expect(step(plan, 'revoke-room:blue-hq').risk).toEqual({
      destructive: true,
      roles: ['blue-co'],
    })
    expect(plan.affectedOnline).toEqual(['blue-co'])
    expect(plan.warnings).toContainEqual(expect.objectContaining({ kind: 'resync', id: 'blue-co' }))
    // A role move changes no account.
    expect(plan.steps.filter((s) => s.group === 'accounts')).toEqual([])
  })

  it('a participant change re-syncs the room and warns (ADM-13)', () => {
    const design = edit((d) => ({
      ...d,
      rooms: d.rooms.map((r) =>
        r.id === 'red-hq'
          ? {
              ...r,
              participants: [
                ...r.participants,
                { kind: 'role' as const, id: 'blue-co', access: 'write' as const },
              ],
            }
          : r,
      ),
    }))
    const plan = planPublish(design, published)
    expect(step(plan, 'grant-room:red-hq').action).toEqual({
      type: 'room-access',
      roomId: 'red-hq',
      changes: [{ roleId: 'blue-co', access: 'write', from: 'none' }],
    })
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ kind: 'resync', subject: 'room', id: 'red-hq' }),
    )
  })

  it('a deleted role is removed after access and documents, with its scope (R-E, ADM-14)', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.filter((r) => r.id !== 'red-co'),
      rooms: d.rooms.map((r) => ({
        ...r,
        participants: r.participants.filter((p) => p.id !== 'red-co'),
      })),
    }))
    const plan = planPublish(design, { ...published, online: ['red-co'] })
    const removal = step(plan, 'delete-role:red-co')
    expect(removal.action).toMatchObject({ type: 'delete-role', rooms: ['red-hq', 'negotiation'] })
    const nodes = removal.action.type === 'delete-role' ? removal.action.nodes : []
    expect(nodes).toEqual(
      expect.arrayContaining(['roles:red-co', 'objectives:red', 'announcements']),
    )
    expect(ids(plan)).toContain('delete-node:roles:red-co')
    expect(index(plan, 'delete-role:red-co')).toBeLessThan(index(plan, 'delete-node:roles:red-co'))
    expect(plan.warnings).toContainEqual({ kind: 'role-deleted', roleId: 'red-co', name: 'Red CO' })
    expect(plan.affectedOnline).toEqual(['red-co'])
    // Its access is not revoked step by step: deleteRole does that.
    expect(ids(plan).filter((id) => id.startsWith('revoke'))).toEqual([])
    expect(plan.warnings.filter(needsConfirmation)).toHaveLength(1)
  })

  it('a deleted room is destroyed with the confirmed count (R-F, ADM-40)', () => {
    const design = edit((d) => ({ ...d, rooms: d.rooms.filter((r) => r.id !== 'negotiation') }))
    const uncounted = planPublish(design, published)
    expect(uncounted.uncounted).toEqual(['negotiation'])
    expect(roomsToDestroy(uncounted)).toEqual(['negotiation'])
    const plan = planPublish(design, published, { messageCounts: new Map([['negotiation', 42]]) })
    expect(plan.uncounted).toEqual([])
    expect(step(plan, 'destroy-room:negotiation').action).toEqual({
      type: 'destroy-room',
      roomId: 'negotiation',
      messageCount: 42,
    })
    expect(plan.warnings).toContainEqual({
      kind: 'room-destroyed',
      roomId: 'negotiation',
      name: 'Blue–Red negotiation',
      messageCount: 42,
    })
    expect(ids(plan)).toContain('delete-node:rooms:negotiation')
  })

  it('a new room is created, then its access, then its document', () => {
    const design = edit((d) => ({
      ...d,
      rooms: [
        ...d.rooms,
        {
          schemaVersion: 1,
          id: 'joint',
          name: 'Joint',
          roomType: 'chat',
          participants: [{ kind: 'force', id: 'blue', access: 'write' }],
          config: {},
          order: 3,
        },
      ],
    }))
    const plan = planPublish(design, published)
    expect(index(plan, 'room:joint')).toBeLessThan(index(plan, 'grant-room:joint'))
    expect(index(plan, 'node:rooms:joint')).toBeLessThan(index(plan, 'doc:rooms:joint:current'))
    expect(index(plan, 'read-only-grant:blue-observer')).toBeLessThan(
      index(plan, 'doc:rooms:joint:current'),
    )
    expect(step(plan, 'read-only-grant:blue-observer').action).toMatchObject({ roomIds: ['joint'] })
    expect(plan.vault).toBe('ready')
  })

  it('a writer made an observer is made read-only in its rooms, as a revoke, before its documents', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.id === 'red-co' ? { ...r, isObserver: true } : r)),
    }))
    const plan = planPublish(design, published)
    const readOnly = step(plan, 'read-only-revoke:red-co')
    expect(readOnly.action).toEqual({
      type: 'read-only',
      roleId: 'red-co',
      roomIds: ['red-hq', 'negotiation'],
    })
    expect(readOnly.risk.destructive).toBe(true)
    expect(index(plan, 'read-only-revoke:red-co')).toBeLessThan(
      index(plan, 'doc:roles:red-co:current'),
    )
    // The vault has no password for red-co: it is reset first, with a warning to confirm.
    expect(ids(plan)[0]).toBe('password:red-co')
    expect(plan.warnings).toContainEqual({
      kind: 'password-reset',
      roleId: 'red-co',
      name: 'Red CO',
    })
    expect(plan.warnings).toContainEqual(expect.objectContaining({ kind: 'resync', id: 'red-co' }))
  })

  it('with the vault locked, the plan asks for it to be unlocked first', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.id === 'red-co' ? { ...r, isObserver: true } : r)),
    }))
    const plan = planPublish(design, { ...published, vault: { exists: true } })
    expect(plan.vault).toBe('unlock')
    expect(ids(plan)).not.toContain('password:red-co')
  })

  it('an observer made a writer has its voice restored (read to write)', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.id === 'blue-observer' ? { ...r, isObserver: false } : r)),
    }))
    const plan = planPublish(design, published)
    expect(step(plan, 'grant-room:blue-hq').action).toMatchObject({
      changes: [{ roleId: 'blue-observer', access: 'write', from: 'read' }],
    })
    expect(ids(plan).filter((id) => id.startsWith('read-only'))).toEqual([])
  })

  it('removes a leftover subscription of a role without access, but never on open nodes', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.id === 'blue-co' ? { ...r, forceId: 'red' } : r)),
    }))
    const target = publishedView(design)
    const view = withNode(
      withNode(target, 'objectives:blue', (n) => ({
        ...n,
        subscriptions: [{ jid: `${jid('blue-co')}/pane`, subscription: 'subscribed' }],
      })),
      'game-setup',
      (n) => ({
        ...n,
        subscriptions: [{ jid: `anon-1234@${DOMAIN}/x`, subscription: 'subscribed' }],
      }),
    )
    const plan = planPublish(design, { ...view, nodes: view.nodes })
    expect(ids(plan)).toContain('revoke-node:objectives:blue')
    // Not mistaken for an account to delete.
    expect(ids(plan).filter((id) => id.startsWith('delete-role'))).toEqual([])
  })

  it('a role known only from a stray affiliation is deleted', () => {
    const view = withNode(publishedView(sampleDesign()), 'announcements', (n) => ({
      ...n,
      affiliations: [...n.affiliations, { jid: jid('ghost'), affiliation: 'member' }],
    }))
    expect(ids(planPublish(sampleDesign(), view))).toEqual([
      'delete-role:ghost',
      'doc:game-setup:current',
    ])
  })

  it('warns that removed objectives text stays published (no retract operation)', () => {
    const design = edit((d) => ({
      ...d,
      objectives: d.objectives.filter((o) => o.forceId !== 'red'),
    }))
    const plan = planPublish(design, published)
    expect(plan.warnings).toEqual([{ kind: 'objectives-kept', forceId: 'red' }])
  })
})

describe('a publish that did not finish (the marker)', () => {
  it('owes the marker’s version even when nothing else is left, and publishes it once', () => {
    const view = publishedView(sampleDesign(), {
      marker: { format: 'wrx1-publish-pending', designVersion: 2, startedAt: '' },
    })
    const plan = planPublish(sampleDesign(), view)
    // The observer's voice is re-checked too (documents may lag): see the next test.
    expect(ids(plan)).toEqual(['read-only-revoke:blue-observer', 'doc:game-setup:current'])
    expect(plan.designVersion).toBe(2)
  })

  it('re-checks read-only members and writers in the vault, since documents may lag', () => {
    const view = publishedView(sampleDesign(), {
      marker: { format: 'wrx1-publish-pending', designVersion: 2, startedAt: '' },
      vault: { exists: true, roles: ['blue-observer', 'red-co'] },
    })
    const plan = planPublish(sampleDesign(), view)
    expect(step(plan, 'read-only-revoke:blue-observer').action).toMatchObject({
      roomIds: ['blue-hq'],
    })
    expect(step(plan, 'grant-room:red-hq').action).toMatchObject({
      changes: [{ roleId: 'red-co', access: 'write', from: 'read' }],
    })
  })

  it('ignores a marker the published version has passed', () => {
    const view = publishedView(sampleDesign(), {
      marker: { format: 'wrx1-publish-pending', designVersion: 1, startedAt: '' },
    })
    expect(planPublish(sampleDesign(), view).steps).toEqual([])
  })
})

describe('reading the published design', () => {
  it('ignores documents that do not parse (NFR-5)', () => {
    const view = withNode(publishedView(sampleDesign()), 'roles:red-co', (n) => ({
      ...n,
      items: [{ id: 'current', payload: '{not json', publisher: undefined }],
    }))
    expect(publishedDesign(view).roles.map((r) => r.id)).not.toContain('red-co')
  })
})

describe('reset (ADM-15)', () => {
  it('deletes every role, room and node, with game-setup last', () => {
    const plan = planReset(publishedView(sampleDesign()), {
      messageCounts: new Map([
        ['blue-hq', 1],
        ['red-hq', 0],
        ['negotiation', 3],
      ]),
    })
    expect(plan.kind).toBe('reset')
    expect(plan.steps.filter((s) => s.action.type === 'delete-role')).toHaveLength(4)
    expect(plan.steps.filter((s) => s.action.type === 'destroy-room')).toHaveLength(3)
    expect(ids(plan).at(-1)).toBe('delete-node:game-setup')
    expect(plan.steps.every((s) => s.risk.destructive)).toBe(true)
    expect(plan.vault).toBe('ready')
    expect(plan.uncounted).toEqual([])
  })

  it('plans nothing on an empty server', () => {
    expect(planReset(emptyView()).steps).toEqual([])
  })
})
