// The plan's groups, batches and rolled-up status (ADM-10, ADM-11), on hand-made steps.
import type { PlanStep, StepAction, StepGroup } from '@wrx/admin-ops'
import { describe, expect, it } from 'vitest'
import type { StepProgress } from './controller.ts'
import { groupPlan, progressLine, rollup } from './planGroups.ts'

const CONFIG = {
  accessModel: 'whitelist',
  publishModel: 'publishers',
  maxItems: 1,
  notifyRetract: true,
} as const

function step(id: string, group: StepGroup, action: StepAction, destructive = false): PlanStep {
  return { id, group, summary: `Step ${id}`, details: [], risk: { destructive, roles: [] }, action }
}

const grantNode = (node: string, roles: number) =>
  step(`grant-node:${node}`, 'access', {
    type: 'node-access',
    node,
    changes: Array.from({ length: roles }, (_, i) => ({
      roleId: `r${i}`,
      access: 'read' as const,
    })),
  })

const revokeRoom = (roomId: string) =>
  step(
    `revoke-room:${roomId}`,
    'access',
    { type: 'room-access', roomId, changes: [{ roleId: 'r0', access: 'none', from: 'write' }] },
    true,
  )

const publish = (node: string) =>
  step(`doc:${node}:current`, 'documents', {
    type: 'publish',
    node,
    config: CONFIG,
    itemId: 'current',
    payload: '{}',
  })

describe('groupPlan', () => {
  const steps = [
    step('account:a', 'accounts', { type: 'create-account', roleId: 'a', readOnly: false }),
    ...['n1', 'n2', 'n3'].map((n) => grantNode(n, 4)),
    revokeRoom('x'),
    revokeRoom('y'),
    step('read-only-grant:o', 'access', { type: 'read-only', roleId: 'o', roomIds: ['x'] }),
    publish('rooms:x'),
    publish('rooms:y'),
    publish('game-setup'),
    step('delete-node:old', 'removals', { type: 'delete-node', node: 'old' }, true),
  ]

  it('keeps the run order, puts game setup last on its own, and leaves out empty groups', () => {
    const groups = groupPlan(steps)
    expect(groups.map((g) => [g.label, g.steps.length])).toEqual([
      ['Accounts', 1],
      ['Access', 6],
      ['Documents', 2],
      ['Removals', 1],
      ['Game setup', 1],
    ])
    expect(groups.map((g) => g.destructive)).toEqual([false, true, false, true, false])
  })

  it('summarises repeated access steps per kind, rooms or nodes × roles', () => {
    const access = groupPlan(steps).find((g) => g.id === 'access')
    expect(access?.batches.map((b) => [b.summary, b.steps.length, b.destructive])).toEqual([
      ['Give node access: 3 nodes × roles (12 grants)', 3, false],
      ['Remove room access: 2 rooms × roles (2 memberships)', 2, true],
      // One step keeps its own line.
      ['Step read-only-grant:o', 1, false],
    ])
    const docs = groupPlan(steps).find((g) => g.id === 'documents')
    expect(docs?.batches.map((b) => b.summary)).toEqual(['Publish documents: 2 documents'])
  })
})

describe('rollup and progressLine', () => {
  const steps = ['a', 'b', 'c'].map((id) =>
    step(id, 'accounts', { type: 'create-account', roleId: id, readOnly: false }),
  )
  const at = (...states: StepProgress['state'][]) =>
    new Map(steps.map((s, i) => [s.id, { state: states[i] ?? 'pending' }]))

  it('rolls the steps’ states up into one', () => {
    expect(rollup(steps, new Map())).toMatchObject({ state: 'pending', label: 'To do' })
    expect(rollup(steps, at('done', 'running'))).toMatchObject({
      state: 'running',
      label: 'Running: 1 of 3 done',
    })
    expect(rollup(steps, at('done', 'failed', 'not-run'))).toMatchObject({
      state: 'failed',
      label: 'Failed: 1 of 3 done',
    })
    expect(rollup(steps, at('done', 'done', 'done'))).toMatchObject({
      state: 'done',
      label: 'Done',
    })
    expect(rollup(steps, at('not-run', 'not-run', 'not-run'))).toMatchObject({ state: 'not-run' })
    expect(rollup(steps, at('done', 'not-run', 'not-run'))).toMatchObject({
      state: 'partial',
      label: '1 of 3 done',
    })
  })

  it('says how far a run has got, and nothing before it starts', () => {
    expect(progressLine(steps, new Map())).toBe('')
    expect(progressLine(steps, at('done', 'running'))).toBe('Applying: 1 of 3 steps done.')
    expect(progressLine(steps, at('done', 'failed', 'not-run'))).toBe(
      'Stopped at a failure: 1 of 3 steps done.',
    )
    expect(progressLine(steps, at('done', 'done', 'done'))).toBe('All 3 steps done.')
  })
})
