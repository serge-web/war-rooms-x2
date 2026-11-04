// Unit tests of the publish planner over hand-built server views: what each kind of change plans,
// the order of steps, idempotency, warnings, the vault, and the design version.
import { TEMPLATE_LIMITS, nodeName } from '@wrx/schemas'
import type { DesignFile, Template } from '@wrx/schemas'
import {
  ROOM,
  TEMPLATE,
  sampleDesignWithWhiteCell,
  templatedDesign,
  tid,
  withSampleMapRoom,
} from '@wrx/schemas/fixtures'
import { describe, expect, it } from 'vitest'
import { DOMAIN, emptyView, jid, publishedView, withNode } from './fixtures.ts'
import type { ServerView } from './view.ts'
import {
  isDestructiveAction,
  needsConfirmation,
  planConfirmations,
  planErrorTarget,
  planPublish,
  planReset,
  publishedDesign,
  roomsToDestroy,
  stepConfirmation,
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
  return change(sampleDesignWithWhiteCell())
}

describe('first publish onto an empty server', () => {
  const plan = planPublish(sampleDesignWithWhiteCell(), emptyView())

  it('creates every account, room and node, grants access and publishes every document', () => {
    expect(plan.steps.filter((s) => s.group === 'accounts').map((s) => s.action)).toEqual([
      { type: 'create-account', roleId: 'blue-co', readOnly: false },
      { type: 'create-account', roleId: 'blue-observer', readOnly: true },
      { type: 'create-account', roleId: 'red-co', readOnly: false },
      { type: 'create-account', roleId: 'white-observer', readOnly: true },
      { type: 'create-account', roleId: 'white-cell', readOnly: false },
    ])
    expect(ids(plan)).toEqual(
      expect.arrayContaining([
        `room:${tid('blue-hq')}`,
        'node:game-setup',
        `grant-room:${tid('blue-hq')}`,
      ]),
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
      roomIds: [tid('blue-hq')],
    })
    expect(index(plan, 'read-only-grant:blue-observer')).toBeLessThan(
      index(plan, `doc:${nodeName.room(tid('blue-hq'))}:current`),
    )
    expect(plan.vault).toBe('create')
  })

  it('publishes objectives as the admin’s item, after the force and role documents', () => {
    const objectives = step(plan, `doc:${nodeName.objectives(tid('blue'))}:admin`)
    expect(objectives.action).toMatchObject({ type: 'publish', itemId: 'admin' })
    expect(index(plan, `doc:${nodeName.force(tid('blue'))}:current`)).toBeLessThan(
      index(plan, `doc:${nodeName.objectives(tid('blue'))}:admin`),
    )
    expect(index(plan, `doc:${nodeName.asset(tid('game-logo'))}:current`)).toBeLessThan(
      index(plan, `doc:${nodeName.force(tid('blue'))}:current`),
    )
  })

  it('creates every node before it publishes to it', () => {
    for (const s of plan.steps) {
      if (s.action.type !== 'publish') continue
      expect(index(plan, `node:${s.action.node}`), s.id).toBeLessThan(index(plan, s.id))
    }
  })

  it('gives every White Force role read on objectives, none publish, and leaves open nodes without affiliations', () => {
    const objectives = step(plan, `grant-node:${nodeName.objectives(tid('red'))}`).action
    const changes = objectives.type === 'node-access' ? objectives.changes : []
    expect(changes).toContainEqual({ roleId: 'white-cell', access: 'read' })
    expect(changes.filter((c) => c.access === 'publish')).toEqual([])
    expect(changes).toContainEqual({ roleId: 'white-observer', access: 'read' })
    expect(changes).toContainEqual({ roleId: 'red-co', access: 'read' })
    expect(ids(plan)).not.toContain('grant-node:game-setup')
    expect(ids(plan)).not.toContain(`grant-node:${nodeName.asset(tid('game-logo'))}`)
  })
})

describe('the turn state and the map room (WP 5.2)', () => {
  const turnStep = 'doc:game-state:current'
  const state = (turn: number, phase: string) => JSON.stringify({ schemaVersion: 1, turn, phase })

  it('a first publish sets turn 1, planning', () => {
    const plan = planPublish(sampleDesignWithWhiteCell(), emptyView())
    expect(step(plan, turnStep)).toMatchObject({
      summary: 'Publish the turn state: turn 1, planning',
      action: { type: 'publish', node: 'game-state', payload: state(1, 'planning') },
    })
  })

  it('a later publish leaves an advanced turn alone, and plans nothing for it', () => {
    const design = sampleDesignWithWhiteCell()
    const advanced = withNode(publishedView(design), 'game-state', (n) => ({
      ...n,
      items: [{ id: 'current', payload: state(3, 'adjudication'), publisher: jid('admin') }],
    }))
    expect(ids(planPublish(design, advanced))).toEqual([])
  })

  it('sets turn 1 again when the item is missing or invalid', () => {
    const design = sampleDesignWithWhiteCell()
    for (const items of [
      [],
      [{ id: 'current', payload: '{"schemaVersion":1}', publisher: undefined }],
    ]) {
      const view = withNode(publishedView(design), 'game-state', (n) => ({ ...n, items }))
      expect(ids(planPublish(design, view))).toEqual([turnStep, 'doc:game-setup:current'])
    }
  })

  it('provisions the map room like any room: every writer has voice, only observers are read only (D25)', () => {
    const design = withSampleMapRoom(sampleDesignWithWhiteCell())
    const plan = planPublish(design, emptyView())
    expect(step(plan, `room:${ROOM.map}`).action).toMatchObject({
      type: 'ensure-room',
      create: true,
    })
    expect(step(plan, `grant-room:${ROOM.map}`).details).toEqual([
      'Blue CO: becomes a member with voice',
      'Red CO: becomes a member with voice',
      'White Cell: becomes a member with voice',
    ])
    for (const role of ['blue-observer', 'white-observer']) {
      const readOnly = step(plan, `read-only-grant:${role}`).action
      expect(readOnly.type === 'read-only' && readOnly.roomIds).toContain(ROOM.map)
    }
    // The map room adds nobody to the vault: no read-only step for a writer.
    expect(
      ids(plan)
        .filter((id) => id.startsWith('read-only-grant:'))
        .sort(),
    ).toEqual(['read-only-grant:blue-observer', 'read-only-grant:white-observer'])
    expect(ids(planPublish(design, publishedView(design)))).toEqual([])
  })
})

describe('idempotency (ADM-10)', () => {
  it('plans nothing for a server that already matches', () => {
    const plan = planPublish(
      sampleDesignWithWhiteCell(),
      publishedView(sampleDesignWithWhiteCell()),
    )
    expect(plan.steps).toEqual([])
    expect(plan.designVersion).toBeUndefined()
    expect(plan.vault).toBe('none')
    expect(plan.warnings).toEqual([])
  })

  it('compares documents by content, not key order', () => {
    const view = withNode(
      publishedView(sampleDesignWithWhiteCell()),
      nodeName.force(tid('blue')),
      (n) => ({
        ...n,
        items: [
          {
            id: 'current',
            payload: JSON.stringify({ ...sampleDesignWithWhiteCell().forces[0] }),
            publisher: undefined,
          },
        ],
      }),
    )
    const reordered = withNode(view, nodeName.force(tid('blue')), (n) => {
      const doc = sampleDesignWithWhiteCell().forces[0]!
      const shuffled = Object.fromEntries(Object.entries(doc).reverse())
      return {
        ...n,
        items: [{ id: 'current', payload: JSON.stringify(shuffled), publisher: undefined }],
      }
    })
    expect(planPublish(sampleDesignWithWhiteCell(), reordered).steps).toEqual([])
  })

  it('ignores a draft designVersion that differs from the published one', () => {
    const design = edit((d) => ({ ...d, game: { ...d.game, designVersion: 7 } }))
    expect(planPublish(design, publishedView(sampleDesignWithWhiteCell())).steps).toEqual([])
  })

  it('does not touch announcements', () => {
    const view = withNode(publishedView(sampleDesignWithWhiteCell()), 'announcements', (n) => ({
      ...n,
      items: [{ id: 'a1', payload: '{}', publisher: jid('admin') }],
    }))
    expect(planPublish(sampleDesignWithWhiteCell(), view).steps).toEqual([])
  })
})

describe('changes', () => {
  const published = publishedView(sampleDesignWithWhiteCell())

  it('a rename changes the room config and documents only, and bumps the version', () => {
    const design = edit((d) => ({
      ...d,
      rooms: d.rooms.map((r) => (r.id === tid('red-hq') ? { ...r, name: 'Red headquarters' } : r)),
    }))
    const plan = planPublish(design, published)
    expect(ids(plan)).toEqual([
      `room:${tid('red-hq')}`,
      `doc:${nodeName.room(tid('red-hq'))}:current`,
      'doc:game-setup:current',
    ])
    expect(step(plan, `room:${tid('red-hq')}`).details).toEqual(['name: Red HQ → Red headquarters'])
    expect(plan.designVersion).toBe(2)
    expect(
      JSON.parse((step(plan, 'doc:game-setup:current').action as { payload: string }).payload),
    ).toMatchObject({ designVersion: 2 })
  })

  it('a room whose side channels drifted is reconfigured, and says which (review F6)', () => {
    const drifted = {
      ...published,
      rooms: published.rooms.map((r) =>
        r.roomId === tid('blue-hq')
          ? { ...r, config: { ...r.config, visitorPrivateMessages: 'anyone' as const } }
          : r,
      ),
    }
    const plan = planPublish(sampleDesignWithWhiteCell(), drifted)
    expect(ids(plan)).toContain(`room:${tid('blue-hq')}`)
    expect(step(plan, `room:${tid('blue-hq')}`).details).toEqual([
      'visitorPrivateMessages: anyone → nobody',
    ])
  })

  it('a role move grants the new access before revoking the old (R-D) and warns (ADM-13)', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.loginName === 'blue-co' ? { ...r, forceId: tid('red') } : r)),
    }))
    const plan = planPublish(design, { ...published, online: ['blue-co', 'red-co'] })
    const grants = [
      `grant-room:${tid('red-hq')}`,
      `grant-node:${nodeName.objectives(tid('red'))}`,
    ].map((id) => index(plan, id))
    const revokes = [
      `revoke-room:${tid('blue-hq')}`,
      `revoke-node:${nodeName.objectives(tid('blue'))}`,
    ].map((id) => index(plan, id))
    expect(Math.max(...grants)).toBeLessThan(Math.min(...revokes))
    expect(step(plan, `revoke-room:${tid('blue-hq')}`).risk).toEqual({
      destructive: true,
      roles: ['blue-co'],
    })
    expect(plan.affectedOnline).toEqual(['blue-co'])
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ kind: 'resync', id: tid('blue-co') }),
    )
    // A role move changes no account.
    expect(plan.steps.filter((s) => s.group === 'accounts')).toEqual([])
  })

  it('a participant change re-syncs the room and warns (ADM-13)', () => {
    const design = edit((d) => ({
      ...d,
      rooms: d.rooms.map((r) =>
        r.id === tid('red-hq')
          ? {
              ...r,
              participants: [
                ...r.participants,
                { kind: 'role' as const, id: tid('blue-co'), access: 'write' as const },
              ],
            }
          : r,
      ),
    }))
    const plan = planPublish(design, published)
    expect(step(plan, `grant-room:${tid('red-hq')}`).action).toEqual({
      type: 'room-access',
      roomId: tid(tid('red-hq')),
      changes: [{ roleId: 'blue-co', access: 'write', from: 'none' }],
    })
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ kind: 'resync', subject: 'room', id: tid('red-hq') }),
    )
  })

  it('a deleted role is removed after access and documents, with its scope (R-E, ADM-14)', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.filter((r) => r.loginName !== 'red-co'),
      rooms: d.rooms.map((r) => ({
        ...r,
        participants: r.participants.filter((p) => p.id !== 'red-co'),
      })),
    }))
    const plan = planPublish(design, { ...published, online: ['red-co'] })
    const removal = step(plan, 'delete-role:red-co')
    expect(removal.action).toMatchObject({
      type: 'delete-role',
      rooms: [tid('red-hq'), tid('negotiation')],
    })
    const nodes = removal.action.type === 'delete-role' ? removal.action.nodes : []
    expect(nodes).toEqual(
      expect.arrayContaining([
        nodeName.role(tid('red-co')),
        nodeName.objectives(tid('red')),
        'announcements',
      ]),
    )
    expect(ids(plan)).toContain(`delete-node:${nodeName.role(tid('red-co'))}`)
    expect(index(plan, 'delete-role:red-co')).toBeLessThan(
      index(plan, `delete-node:${nodeName.role(tid('red-co'))}`),
    )
    expect(plan.warnings).toContainEqual({ kind: 'role-deleted', roleId: 'red-co', name: 'Red CO' })
    expect(plan.affectedOnline).toEqual(['red-co'])
    // Its access is not revoked step by step: deleteRole does that.
    expect(ids(plan).filter((id) => id.startsWith('revoke'))).toEqual([])
    expect(plan.warnings.filter(needsConfirmation)).toHaveLength(1)
  })

  it('a deleted room is destroyed with the confirmed count (R-F, ADM-40)', () => {
    const design = edit((d) => ({
      ...d,
      rooms: d.rooms.filter((r) => r.id !== tid('negotiation')),
    }))
    const uncounted = planPublish(design, published)
    expect(uncounted.uncounted).toEqual([tid('negotiation')])
    expect(roomsToDestroy(uncounted)).toEqual([tid('negotiation')])
    const plan = planPublish(design, published, {
      messageCounts: new Map([[tid('negotiation'), 42]]),
    })
    expect(plan.uncounted).toEqual([])
    expect(step(plan, `destroy-room:${tid('negotiation')}`).action).toEqual({
      type: 'destroy-room',
      roomId: tid(tid('negotiation')),
      messageCount: 42,
    })
    expect(plan.warnings).toContainEqual({
      kind: 'room-destroyed',
      roomId: tid(tid('negotiation')),
      name: 'Blue–Red negotiation',
      messageCount: 42,
    })
    expect(ids(plan)).toContain(`delete-node:${nodeName.room(tid('negotiation'))}`)
  })

  it('a new room is created, then its access, then its document', () => {
    const design = edit((d) => ({
      ...d,
      rooms: [
        ...d.rooms,
        {
          schemaVersion: 1,
          id: tid('joint'),
          name: 'Joint',
          roomType: 'chat',
          participants: [{ kind: 'force', id: tid('blue'), access: 'write' }],
          config: {},
          order: 3,
        },
      ],
    }))
    const plan = planPublish(design, published)
    expect(index(plan, `room:${tid('joint')}`)).toBeLessThan(
      index(plan, `grant-room:${tid('joint')}`),
    )
    expect(index(plan, `node:${nodeName.room(tid('joint'))}`)).toBeLessThan(
      index(plan, `doc:${nodeName.room(tid('joint'))}:current`),
    )
    expect(index(plan, 'read-only-grant:blue-observer')).toBeLessThan(
      index(plan, `doc:${nodeName.room(tid('joint'))}:current`),
    )
    expect(step(plan, 'read-only-grant:blue-observer').action).toMatchObject({
      roomIds: [tid('joint')],
    })
    expect(plan.vault).toBe('ready')
  })

  it('a writer made an observer is made read-only in its rooms, as a revoke, before its documents', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.loginName === 'red-co' ? { ...r, isObserver: true } : r)),
    }))
    const plan = planPublish(design, published)
    const readOnly = step(plan, 'read-only-revoke:red-co')
    expect(readOnly.action).toEqual({
      type: 'read-only',
      roleId: 'red-co',
      roomIds: [tid('red-hq'), tid('negotiation')],
    })
    expect(readOnly.risk.destructive).toBe(true)
    expect(index(plan, 'read-only-revoke:red-co')).toBeLessThan(
      index(plan, `doc:${nodeName.role(tid('red-co'))}:current`),
    )
    // The vault has no password for red-co: it is reset first, with a warning to confirm.
    expect(ids(plan)[0]).toBe('password:red-co')
    expect(plan.warnings).toContainEqual({
      kind: 'password-reset',
      roleId: 'red-co',
      name: 'Red CO',
    })
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ kind: 'resync', id: tid('red-co') }),
    )
  })

  it('with the vault locked, the plan asks for it to be unlocked first', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.loginName === 'red-co' ? { ...r, isObserver: true } : r)),
    }))
    const plan = planPublish(design, { ...published, vault: { exists: true } })
    expect(plan.vault).toBe('unlock')
    expect(ids(plan)).not.toContain('password:red-co')
  })

  it('an observer made a writer has its voice restored (read to write)', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) =>
        r.loginName === 'blue-observer' ? { ...r, isObserver: false } : r,
      ),
    }))
    const plan = planPublish(design, published)
    expect(step(plan, `grant-room:${tid('blue-hq')}`).action).toMatchObject({
      changes: [{ roleId: 'blue-observer', access: 'write', from: 'read' }],
    })
    expect(ids(plan).filter((id) => id.startsWith('read-only'))).toEqual([])
  })

  it('removes a leftover subscription of a role without access, but never on open nodes', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.loginName === 'blue-co' ? { ...r, forceId: tid('red') } : r)),
    }))
    const target = publishedView(design)
    const view = withNode(
      withNode(target, nodeName.objectives(tid('blue')), (n) => ({
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
    expect(ids(plan)).toContain(`revoke-node:${nodeName.objectives(tid('blue'))}`)
    // Not mistaken for an account to delete.
    expect(ids(plan).filter((id) => id.startsWith('delete-role'))).toEqual([])
  })

  it('a role known only from a stray affiliation is deleted', () => {
    const view = withNode(publishedView(sampleDesignWithWhiteCell()), 'announcements', (n) => ({
      ...n,
      affiliations: [...n.affiliations, { jid: jid('ghost'), affiliation: 'member' }],
    }))
    expect(ids(planPublish(sampleDesignWithWhiteCell(), view))).toEqual([
      'delete-role:ghost',
      'doc:game-setup:current',
    ])
  })

  it('purges objectives text removed from the draft, and republishes nothing there', () => {
    const design = edit((d) => ({
      ...d,
      objectives: d.objectives.filter((o) => o.forceId !== tid('red')),
    }))
    const plan = planPublish(design, published)
    expect(step(plan, `purge:${nodeName.objectives(tid('red'))}`).action).toEqual({
      type: 'purge-node',
      node: nodeName.objectives(tid('red')),
      stray: ['admin'],
    })
    expect(ids(plan).filter((id) => id.startsWith('doc:objectives:'))).toEqual([])
    expect(plan.warnings).toEqual([])
  })
})

describe('objectives by the admin only (D21, §3 rule 14, WP 3.5)', () => {
  // A server published before WP 3.5: White Cell published objectives, beside the admin, on
  // nodes keeping 10 items.
  const before = (() => {
    let view = publishedView(sampleDesignWithWhiteCell())
    for (const forceId of ['blue', 'red', 'white']) {
      view = withNode(view, nodeName.objectives(tid(forceId)), (n) => ({
        ...n,
        config: { ...n.config, maxItems: 10 },
        affiliations: n.affiliations.map((a) =>
          a.jid === jid('white-cell') ? { ...a, affiliation: 'publisher' as const } : a,
        ),
        items:
          forceId === 'red'
            ? [
                ...n.items,
                { id: 'white-cell', payload: '{"stale":true}', publisher: jid('white-cell') },
              ]
            : n.items,
      }))
    }
    return view
  })()
  const plan = planPublish(sampleDesignWithWhiteCell(), before)

  it('takes the White Force editor’s publisher affiliation, then purges, then republishes', () => {
    expect(step(plan, `grant-node:${nodeName.objectives(tid('red'))}`).action).toEqual({
      type: 'node-access',
      node: nodeName.objectives(tid('red')),
      changes: [{ roleId: 'white-cell', access: 'read' }],
    })
    expect(step(plan, `purge:${nodeName.objectives(tid('red'))}`).action).toMatchObject({
      stray: ['white-cell'],
    })
    expect(index(plan, `grant-node:${nodeName.objectives(tid('red'))}`)).toBeLessThan(
      index(plan, `purge:${nodeName.objectives(tid('red'))}`),
    )
    expect(index(plan, `purge:${nodeName.objectives(tid('red'))}`)).toBeLessThan(
      index(plan, `doc:${nodeName.objectives(tid('red'))}:admin`),
    )
    // The admin's item is unchanged, but the purge takes it too, so it is published again.
    expect(step(plan, `doc:${nodeName.objectives(tid('red'))}:admin`).action).toMatchObject({
      itemId: 'admin',
    })
    expect(step(plan, `node:${nodeName.objectives(tid('red'))}`).details).toEqual([
      'maxItems: 10 → 1',
    ])
  })

  it('purges only nodes holding an item that is not the admin’s', () => {
    expect(ids(plan).filter((id) => id.startsWith('purge:'))).toEqual([
      `purge:${nodeName.objectives(tid('red'))}`,
    ])
    expect(ids(plan)).not.toContain(`doc:${nodeName.objectives(tid('blue'))}:admin`)
  })

  it('plans nothing on a second publish', () => {
    const after = withNode(
      publishedView(sampleDesignWithWhiteCell()),
      nodeName.objectives(tid('red')),
      (n) => n,
    )
    expect(planPublish(sampleDesignWithWhiteCell(), after).steps).toEqual([])
  })
})

describe('accounts against the registered list (security review F3)', () => {
  const withRole = (id: string, isObserver: boolean) =>
    edit((d) => ({
      ...d,
      roles: [
        ...d.roles,
        {
          schemaVersion: 1,
          id: tid(id),
          loginName: id,
          name: id.toUpperCase(),
          forceId: tid('blue'),
          isObserver,
          order: 9,
        },
      ],
    }))

  it('plans no create, and no reset, for an account that exists but nothing else shows', () => {
    const design = withRole('blue-xo', false)
    const view = publishedView(sampleDesignWithWhiteCell())
    const plan = planPublish(design, { ...view, registered: [...view.registered, jid('blue-xo')] })
    expect(ids(plan)).not.toContain('account:blue-xo')
    expect(plan.steps.filter((s) => s.action.type === 'reset-password')).toEqual([])
    expect(plan.warnings).toContainEqual({
      kind: 'account-exists',
      roleId: 'blue-xo',
      name: 'BLUE-XO',
    })
    expect(plan.warnings.filter(needsConfirmation)).toEqual([])
    // Still creates one that does not exist.
    expect(step(planPublish(design, view), 'account:blue-xo').action).toEqual({
      type: 'create-account',
      roleId: 'blue-xo',
      readOnly: false,
    })
  })

  it('resets an existing read-only account only as its own destructive, confirmed step', () => {
    const design = withRole('blue-watch', true)
    const view = publishedView(sampleDesignWithWhiteCell())
    const plan = planPublish(design, {
      ...view,
      registered: [...view.registered, jid('blue-watch')],
    })
    expect(ids(plan)).not.toContain('account:blue-watch')
    const reset = step(plan, 'password:blue-watch')
    expect(reset.action).toEqual({ type: 'reset-password', roleId: 'blue-watch', readOnly: true })
    expect(reset.risk.destructive).toBe(true)
    expect(plan.warnings.filter(needsConfirmation)).toEqual([
      { kind: 'password-reset', roleId: 'blue-watch', name: 'BLUE-WATCH' },
    ])
  })

  it('creates an account the documents know but the server does not list', () => {
    const view = publishedView(sampleDesignWithWhiteCell())
    const plan = planPublish(sampleDesignWithWhiteCell(), {
      ...view,
      registered: view.registered.filter((j) => j !== jid('red-co')),
    })
    expect(ids(plan)).toEqual(['account:red-co', 'doc:game-setup:current'])
  })
})

describe('a publish that did not finish (the marker)', () => {
  it('owes the marker’s version even when nothing else is left, and publishes it once', () => {
    const view = publishedView(sampleDesignWithWhiteCell(), {
      marker: { format: 'wrx1-publish-pending', designVersion: 2, startedAt: '' },
    })
    const plan = planPublish(sampleDesignWithWhiteCell(), view)
    // The observers' voice is re-checked too (documents may lag): see the next test.
    expect(ids(plan)).toEqual([
      'read-only-revoke:blue-observer',
      'read-only-revoke:white-observer',
      'doc:game-setup:current',
    ])
    expect(plan.designVersion).toBe(2)
  })

  it('re-checks read-only members and writers in the vault, since documents may lag', () => {
    const view = publishedView(sampleDesignWithWhiteCell(), {
      marker: { format: 'wrx1-publish-pending', designVersion: 2, startedAt: '' },
      vault: { exists: true, roles: ['blue-observer', 'red-co'] },
    })
    const plan = planPublish(sampleDesignWithWhiteCell(), view)
    expect(step(plan, 'read-only-revoke:blue-observer').action).toMatchObject({
      roomIds: [tid('blue-hq')],
    })
    expect(step(plan, `grant-room:${tid('red-hq')}`).action).toMatchObject({
      changes: [{ roleId: 'red-co', access: 'write', from: 'read' }],
    })
  })

  it('ignores a marker the published version has passed', () => {
    const view = publishedView(sampleDesignWithWhiteCell(), {
      marker: { format: 'wrx1-publish-pending', designVersion: 1, startedAt: '' },
    })
    expect(planPublish(sampleDesignWithWhiteCell(), view).steps).toEqual([])
  })
})

describe('reading the published design', () => {
  it('ignores documents that do not parse (NFR-5)', () => {
    const view = withNode(
      publishedView(sampleDesignWithWhiteCell()),
      nodeName.role(tid('red-co')),
      (n) => ({
        ...n,
        items: [{ id: 'current', payload: '{not json', publisher: undefined }],
      }),
    )
    expect(publishedDesign(view).roles.map((r) => r.loginName)).not.toContain('red-co')
  })
})

describe('reset (ADM-15)', () => {
  it('deletes every role, room and node, with game-setup last', () => {
    const plan = planReset(publishedView(sampleDesignWithWhiteCell()), {
      messageCounts: new Map([
        [tid('blue-hq'), 1],
        [tid('red-hq'), 0],
        [tid('negotiation'), 3],
      ]),
    })
    expect(plan.kind).toBe('reset')
    expect(plan.steps.filter((s) => s.action.type === 'delete-role')).toHaveLength(5)
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

describe('deleted entities keep their last names in `retired` (§3 rule 1, ADM-14, ADM-39)', () => {
  const published = publishedView(sampleDesignWithWhiteCell())
  const withoutRedCo = (retired: DesignFile['retired'] = []) =>
    edit((d) => ({
      ...d,
      roles: d.roles.filter((r) => r.loginName !== 'red-co'),
      rooms: d.rooms.map((r) => ({
        ...r,
        participants: r.participants.filter((p) => p.id !== tid('red-co')),
      })),
      retired,
    }))
  const record = {
    schemaVersion: 1 as const,
    id: tid('red-co'),
    kind: 'role' as const,
    name: 'Red CO',
    loginName: 'red-co',
    colour: '#b91c1c',
    deletedAt: '2026-11-01T10:00:00.000Z',
  }

  it('publishes the design’s record before the role loses anything', () => {
    const plan = planPublish(withoutRedCo([record]), published)
    const doc = `doc:retired:${tid('red-co')}`
    expect(step(plan, doc).action).toMatchObject({ node: 'retired', itemId: tid('red-co') })
    expect(index(plan, doc)).toBeLessThan(index(plan, 'delete-role:red-co'))
    expect(index(plan, doc)).toBeLessThan(
      index(plan, `delete-node:${nodeName.role(tid('red-co'))}`),
    )
    // Its access goes with the account, in the delete step, after the record (ADM-39).
    expect(
      plan.steps.filter((x) => x.group === 'access').flatMap((x) => x.risk.roles),
    ).not.toContain('red-co')
  })

  it('records a published role the draft deleted without a record (the safety net)', () => {
    const plan = planPublish(withoutRedCo(), published)
    const action = step(plan, `doc:retired:${tid('red-co')}`).action
    expect(action.type === 'publish' && JSON.parse(action.payload)).toEqual({
      ...record,
      deletedAt: sampleDesignWithWhiteCell().exportedAt,
    })
  })

  it('keeps records the server has, and never records them twice', () => {
    const after = withNode(published, 'retired', (n) => ({
      ...n,
      items: [{ id: tid('red-co'), payload: JSON.stringify(record), publisher: jid('admin') }],
    }))
    // The design does not hold the record (another browser deleted Red CO): nothing to do.
    const plan = planPublish(sampleDesignWithWhiteCell(), after)
    expect(ids(plan).filter((i) => i.includes('retired'))).toEqual([])
    expect(publishedDesign(after).retired).toEqual([record])
  })

  it('never lets a retired record grant access: the deleted role gets nothing back', () => {
    const plan = planPublish(withoutRedCo([record]), published)
    const grants = plan.steps.flatMap((s) =>
      s.action.type === 'room-access' || s.action.type === 'node-access'
        ? s.action.changes.filter((c) => c.access !== 'none').map((c) => c.roleId)
        : [],
    )
    expect(grants).not.toContain('red-co')
    expect(ids(plan)).not.toContain('account:red-co')
  })
})

describe('a server published before GUID ids (merge record N3)', () => {
  // Nodes named by slug ids, as a release before WP 3.5 left them.
  const legacy = emptyView({
    nodes: [
      {
        node: 'forces:blue',
        config: {
          accessModel: 'whitelist',
          publishModel: 'publishers',
          maxItems: 1,
          notifyRetract: true,
        },
        affiliations: [{ jid: jid('admin'), affiliation: 'owner' }],
        subscriptions: [],
        items: [],
      },
      {
        node: 'roles:old-co',
        config: {
          accessModel: 'whitelist',
          publishModel: 'publishers',
          maxItems: 1,
          notifyRetract: true,
        },
        affiliations: [{ jid: jid('admin'), affiliation: 'owner' }],
        subscriptions: [],
        items: [],
      },
    ],
    rooms: [
      {
        roomId: 'blue-hq',
        config: {
          name: 'Blue HQ',
          membersOnly: true,
          moderated: true,
          persistent: true,
          public: false,
          whois: 'anyone',
          archive: true,
          visitorPrivateMessages: 'nobody',
          visitorStatus: false,
          visitorNickChange: false,
          voiceRequests: false,
          subscriptions: false,
        },
        affiliations: [{ jid: jid('admin'), affiliation: 'owner' }],
      },
    ],
    registered: [jid('admin'), jid('old-co')],
  })

  it('reset removes its slug-named nodes, rooms and role accounts', () => {
    const plan = planReset(legacy, { messageCounts: new Map([['blue-hq', 0]]) })
    expect(ids(plan)).toEqual(
      expect.arrayContaining([
        'delete-role:old-co',
        'destroy-room:blue-hq',
        'delete-node:forces:blue',
        'delete-node:roles:old-co',
      ]),
    )
  })
})

describe('a published role’s login name is fixed (ADM-5, WP 3.4)', () => {
  const published = publishedView(sampleDesignWithWhiteCell())
  const renamed = (to: string) =>
    edit((d) => ({
      ...d,
      roles: d.roles.map((r) => (r.loginName === 'blue-co' ? { ...r, loginName: to } : r)),
    }))

  it('refuses a changed login name with an error naming the role, both names and the remedy', () => {
    const plan = planPublish(renamed('blue-commander'), published)
    expect(plan.errors).toEqual([
      expect.objectContaining({
        kind: 'login-name-changed',
        roleId: tid('blue-co'),
        name: 'Blue CO',
        from: 'blue-co',
        to: 'blue-commander',
      }),
    ])
    const message = plan.errors[0]?.message ?? ''
    expect(message).toContain('Blue CO')
    expect(message).toContain('blue-co')
    expect(message).toContain('blue-commander')
    expect(message).toMatch(/delete the role and add a new one/)
  })

  it('plans nothing: never a new account and a deleted one', () => {
    const plan = planPublish(renamed('blue-commander'), published)
    expect(plan.steps).toEqual([])
    expect(plan.warnings).toEqual([])
    expect(plan.designVersion).toBeUndefined()
    expect(plan.documentsChange).toBe(false)
  })

  it('names every role whose login name changes', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) =>
        r.loginName === 'blue-co'
          ? { ...r, loginName: 'blue-1' }
          : r.loginName === 'red-co'
            ? { ...r, loginName: 'red-1' }
            : r,
      ),
    }))
    expect(
      planPublish(design, published).errors.map((e) =>
        e.kind === 'login-name-changed' ? [e.from, e.to] : [],
      ),
    ).toEqual([
      ['blue-co', 'blue-1'],
      ['red-co', 'red-1'],
    ])
  })

  it('allows the remedy: the role deleted and a new one added with the new login name', () => {
    const design = edit((d) => ({
      ...d,
      roles: d.roles.map((r) =>
        r.loginName === 'blue-co'
          ? { ...r, id: tid('blue-commander'), loginName: 'blue-commander' }
          : r,
      ),
      rooms: d.rooms.map((room) => ({
        ...room,
        participants: room.participants.map((p) =>
          p.id === tid('blue-co') ? { ...p, id: tid('blue-commander') } : p,
        ),
      })),
    }))
    const plan = planPublish(design, published)
    expect(plan.errors).toEqual([])
    expect(ids(plan)).toContain('account:blue-commander')
    expect(ids(plan)).toContain('delete-role:blue-co')
  })

  it('an unpublished role’s login name may still change', () => {
    expect(planPublish(renamed('blue-commander'), emptyView()).errors).toEqual([])
  })
})

describe('a published or deleted role’s login name is not reused (§3 rule 1, review V3)', () => {
  const published = publishedView(sampleDesignWithWhiteCell())
  /** Blue CO under a new GUID: a fresh draft, or a v1 file converted again. */
  const reissued = () =>
    edit((d) => ({
      ...d,
      roles: d.roles.map((r) =>
        r.loginName === 'blue-co' ? { ...r, id: tid('blue-co-again') } : r,
      ),
      rooms: d.rooms.map((room) => ({
        ...room,
        participants: room.participants.map((p) =>
          p.id === tid('blue-co') ? { ...p, id: tid('blue-co-again') } : p,
        ),
      })),
    }))

  it('refuses a published role’s login name on a role of another GUID', () => {
    const plan = planPublish(reissued(), published)
    expect(plan.steps).toEqual([])
    expect(plan.errors).toEqual([
      expect.objectContaining({
        kind: 'login-name-reused',
        roleId: tid('blue-co-again'),
        loginName: 'blue-co',
        holderId: tid('blue-co'),
      }),
    ])
    expect(plan.errors[0]?.message).toMatch(/belongs to the published role Blue CO/)
  })

  it('refuses a deleted role’s login name, from the server’s records', () => {
    const base = sampleDesignWithWhiteCell()
    const withRecord = withNode(published, 'retired', (n) => ({
      ...n,
      items: [
        {
          id: tid('old-co'),
          publisher: undefined,
          payload: JSON.stringify({
            schemaVersion: 1,
            id: tid('old-co'),
            kind: 'role',
            name: 'Old CO',
            loginName: 'old-co',
            deletedAt: '2026-11-01T10:00:00.000Z',
          }),
        },
      ],
    }))
    const design = {
      ...base,
      roles: [
        ...base.roles,
        {
          schemaVersion: 1 as const,
          id: tid('new-co'),
          loginName: 'old-co',
          name: 'New CO',
          forceId: tid('blue'),
          isObserver: false,
          order: 5,
        },
      ],
    }
    expect(planPublish(design, withRecord).errors).toEqual([
      expect.objectContaining({ kind: 'login-name-reused', loginName: 'old-co' }),
    ])
  })
})

describe('message templates (Annex A, WP 4.1)', () => {
  const TEMPLATES = 'templates'
  const templated = (): DesignFile => {
    const design = templatedDesign()
    return { ...design, roles: sampleDesignWithWhiteCell().roles }
  }
  const templateOf = (view: ServerView, id: string) =>
    publishedDesign(view).templates.find((t) => t.id === id)

  it('creates `templates`, read by every role, published by the admin, one item per template', () => {
    const plan = planPublish(templated(), emptyView())
    expect(step(plan, `node:${TEMPLATES}`).action).toMatchObject({
      type: 'ensure-node',
      config: {
        accessModel: 'whitelist',
        publishModel: 'publishers',
        maxItems: TEMPLATE_LIMITS.templates,
      },
    })
    const grant = step(plan, `grant-node:${TEMPLATES}`).action
    expect(grant.type === 'node-access' ? grant.changes : []).toEqual(
      ['blue-co', 'blue-observer', 'red-co', 'white-observer', 'white-cell'].map((roleId) => ({
        roleId,
        access: 'read',
      })),
    )
    for (const id of [TEMPLATE.sitrep, TEMPLATE.contact, TEMPLATE.support]) {
      expect(step(plan, `doc:${TEMPLATES}:${id}`).action).toMatchObject({
        type: 'publish',
        itemId: id,
      })
    }
  })

  it('publishes templates before the rooms that offer them', () => {
    const plan = planPublish(templated(), emptyView())
    expect(index(plan, `doc:${TEMPLATES}:${TEMPLATE.support}`)).toBeLessThan(
      index(plan, `doc:${nodeName.room(ROOM.blueReports)}:current`),
    )
  })

  it('locks every template a room offers, at the design’s export time, and says so (TD6)', () => {
    const design = templated()
    const unused = { ...design.templates[0]!, id: tid('unused-template'), name: 'Unused' }
    const plan = planPublish({ ...design, templates: [...design.templates, unused] }, emptyView())
    const payload = (id: string) => {
      const action = step(plan, `doc:${TEMPLATES}:${id}`).action
      return action.type === 'publish' ? (JSON.parse(action.payload) as Template) : undefined
    }
    expect(payload(TEMPLATE.sitrep)?.lockedAt).toBe(design.exportedAt)
    expect(payload(unused.id)?.lockedAt).toBeUndefined()
    expect(step(plan, `doc:${TEMPLATES}:${TEMPLATE.sitrep}`).details).toEqual([
      'A room offers it, so it locks: its fields are fixed from now on (TD6)',
    ])
    expect(step(plan, `doc:${TEMPLATES}:${TEMPLATE.sitrep}`).summary).toBe(
      'Publish the template Situation report',
    )
  })

  it('plans nothing more once published, and keeps the server’s lock whatever the draft says', () => {
    const design = templated()
    const view = publishedView(design)
    expect(templateOf(view, TEMPLATE.sitrep)?.lockedAt).toBe(design.exportedAt)
    expect(planPublish(design, view).steps).toEqual([])
    // A draft that does not know of the lock (another browser published) still plans nothing.
    const later = { ...design, exportedAt: '2026-12-01T00:00:00.000Z' }
    expect(planPublish(later, view).steps).toEqual([])
  })

  it('republishes a locked template whose description changes, keeping its lock', () => {
    const design = templated()
    const view = publishedView(design)
    const described = {
      ...design,
      templates: design.templates.map((t) =>
        t.id === TEMPLATE.sitrep ? { ...t, description: 'Daily, by 18:00' } : t,
      ),
    }
    const plan = planPublish(described, view)
    expect(plan.errors).toEqual([])
    const action = step(plan, `doc:${TEMPLATES}:${TEMPLATE.sitrep}`).action
    const published =
      action.type === 'publish' ? (JSON.parse(action.payload) as Template) : undefined
    expect(published?.description).toBe('Daily, by 18:00')
    expect(published?.lockedAt).toBe(design.exportedAt)
  })

  it.each([
    ['name', (t: Template): Template => ({ ...t, name: 'SITREP' })],
    ['labels', (t: Template): Template => ({ ...t, uiSchema: { ...t.uiSchema, 'ui:title': 'X' } })],
    [
      'field order',
      (t: Template): Template => ({
        ...t,
        uiSchema: {
          ...t.uiSchema,
          'ui:order': [...Object.keys(t.schema.properties ?? {})].reverse(),
        },
      }),
    ],
  ])('refuses a design that changes a locked template’s %s (M1)', (_, change) => {
    const design = templated()
    const view = publishedView(design)
    const changed = {
      ...design,
      templates: design.templates.map((t) => (t.id === TEMPLATE.sitrep ? change(t) : t)),
    }
    const plan = planPublish(changed, view)
    expect(plan.steps).toEqual([])
    expect(plan.errors).toEqual([
      expect.objectContaining({ kind: 'template-locked-changed', templateId: TEMPLATE.sitrep }),
    ])
  })

  it('refuses a design that changes a locked template’s fields, with the copy remedy', () => {
    const design = templated()
    const view = publishedView(design)
    const changed = {
      ...design,
      templates: design.templates.map((t) =>
        t.id === TEMPLATE.contact
          ? { ...t, schema: { ...t.schema, required: ['seenAt'] }, lockedAt: undefined }
          : t,
      ),
    }
    const plan = planPublish(changed, view)
    expect(plan.steps).toEqual([])
    expect(plan.errors).toEqual([
      expect.objectContaining({ kind: 'template-locked-changed', templateId: TEMPLATE.contact }),
    ])
    expect(plan.errors[0]?.message).toContain('Copy it to a new template')
    expect(planErrorTarget(plan.errors[0]!)).toBe(TEMPLATE.contact)
  })

  it('removes a locked template the design drops only with a confirmation, saying what it costs', () => {
    const design = templated()
    const view = publishedView(design)
    const dropped = {
      ...design,
      rooms: design.rooms.filter((r) => r.id !== ROOM.blueReports),
      templates: design.templates.filter((t) => t.id !== TEMPLATE.support),
    }
    const removing = planPublish(dropped, view)
    expect(removing.errors).toEqual([])
    const warning = removing.warnings.find((w) => w.kind === 'template-removed')
    expect(warning).toEqual({
      kind: 'template-removed',
      templateId: TEMPLATE.support,
      name: 'Support request',
      locked: true,
    })
    expect(needsConfirmation(warning!)).toBe(true)
    const retract = step(removing, `retract:${TEMPLATES}:${TEMPLATE.support}`)
    expect(retract.details).toEqual([
      'It is locked: messages that used it show as plain text from now on (TPL-6)',
    ])
    expect(stepConfirmation(retract.action)).toBe(`template:${TEMPLATE.support}`)
    expect(planConfirmations(removing)).toContain(`template:${TEMPLATE.support}`)
    // Taking it out of every room instead is fine: it stays, locked.
    const kept = { ...design, rooms: design.rooms.filter((r) => r.id !== ROOM.blueReports) }
    const plan = planPublish(kept, view)
    expect(plan.errors).toEqual([])
    expect(ids(plan).some((id) => id.startsWith(`retract:${TEMPLATES}`))).toBe(false)
  })

  it('lets an unlocked template change, and removes one the design drops, after the rooms', () => {
    const design = templated()
    const draft = { ...design, rooms: design.rooms.filter((r) => r.id !== ROOM.blueReports) }
    const view = publishedView(draft)
    expect(templateOf(view, TEMPLATE.sitrep)?.lockedAt).toBeUndefined()
    const changed = {
      ...draft,
      templates: draft.templates
        .filter((t) => t.id !== TEMPLATE.support)
        .map((t) =>
          t.id === TEMPLATE.contact ? { ...t, schema: { ...t.schema, required: ['grid'] } } : t,
        ),
    }
    const plan = planPublish(changed, view)
    expect(plan.errors).toEqual([])
    expect(ids(plan)).toContain(`doc:${TEMPLATES}:${TEMPLATE.contact}`)
    const retract = step(plan, `retract:${TEMPLATES}:${TEMPLATE.support}`)
    expect(retract).toMatchObject({
      group: 'removals',
      summary: 'Remove the template Support request',
      action: { type: 'retract-item', node: TEMPLATES, itemId: TEMPLATE.support },
    })
    expect(isDestructiveAction(retract.action)).toBe(true)
    expect(stepConfirmation(retract.action)).toBe(`template:${TEMPLATE.support}`)
    expect(retract.details).toEqual(['No published room has offered it, so no message uses it'])
  })

  it('removes a stray or unreadable item on `templates`', () => {
    const view = withNode(publishedView(templated()), TEMPLATES, (n) => ({
      ...n,
      items: [
        ...n.items,
        { id: 'junk', payload: '{"not": "a template"}', publisher: jid('admin') },
      ],
    }))
    expect(step(planPublish(templated(), view), `retract:${TEMPLATES}:junk`).summary).toBe(
      'Remove the template junk',
    )
  })

  it('never plans anything below `templates`, which stays reserved', () => {
    const plan = planPublish(templated(), emptyView())
    const nodes = plan.steps.flatMap((s) => ('node' in s.action ? [s.action.node] : []))
    expect(nodes).toContain(TEMPLATES)
    expect(nodes.some((n) => n.startsWith('templates:'))).toBe(false)
    const reset = planReset(publishedView(templated()))
    expect(ids(reset)).toContain(`delete-node:${TEMPLATES}`)
  })
})
