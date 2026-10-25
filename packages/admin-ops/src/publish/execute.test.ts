// Unit tests of the plan executor against FakeSession (the `rig` of the AdminOps tests): what each
// step may and may not do on its own authority.
import { err } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { ops, rig } from '../fixtures.ts'
import { executePlan } from './execute.ts'
import type { PlanStep, PublishPlan } from './plan.ts'

function planOf(steps: readonly PlanStep[]): PublishPlan {
  return {
    kind: 'publish',
    steps,
    designVersion: undefined,
    publishedVersion: undefined,
    warnings: [],
    affectedOnline: [],
    documentsChange: false,
    vault: 'none',
    uncounted: [],
    roleNames: {},
  }
}

const createBlueCo: PlanStep = {
  id: 'account:blue-co',
  group: 'accounts',
  summary: 'Create the account for Blue CO',
  details: [],
  risk: { destructive: false, roles: [] },
  action: { type: 'create-account', roleId: 'blue-co', readOnly: false },
}

describe('executePlan', () => {
  it('a create-account step fails on an existing account, and never resets it (security review F3)', async () => {
    const { admin, ops: adminOps, log } = await rig()
    admin.stub('admin', 'addUser', () => Promise.resolve(err('conflict', 'exists')))
    const result = await executePlan(adminOps, planOf([createBlueCo]), {
      passwordFor: () => 'new-password',
    })
    expect(result).toMatchObject({ ok: false, failed: { stepId: 'account:blue-co' } })
    expect(result.failed?.error.code).toBe('exists')
    expect(ops(log)).not.toContain('admin.admin.changePassword')
    expect(result.passwordsSet).toEqual([])
  })
})
