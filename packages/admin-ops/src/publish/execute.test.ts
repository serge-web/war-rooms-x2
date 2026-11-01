// Unit tests of the plan executor against FakeSession (the `rig` of the AdminOps tests): what each
// step may and may not do on its own authority.
import { err, ok } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { ops, rig } from '../fixtures.ts'
import { executePlan } from './execute.ts'
import type { PlanStep, PublishPlan } from './plan.ts'

function planOf(steps: readonly PlanStep[]): PublishPlan {
  return {
    kind: 'publish',
    errors: [],
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
      confirmed: new Set(),
    })
    expect(result).toMatchObject({ ok: false, failed: { stepId: 'account:blue-co' } })
    expect(result.failed?.error.code).toBe('exists')
    expect(ops(log)).not.toContain('admin.admin.changePassword')
    expect(result.passwordsSet).toEqual([])
  })

  it('runs nothing of a plan with errors, whatever steps it carries (ADM-5)', async () => {
    const { ops: adminOps, log } = await rig()
    const plan: PublishPlan = {
      ...planOf([createBlueCo]),
      errors: [
        {
          kind: 'login-name-changed',
          roleId: 'r',
          name: 'Blue CO',
          from: 'blue-co',
          to: 'blue-1',
          message: 'fixed',
        },
      ],
    }
    const result = await executePlan(adminOps, plan, {
      passwordFor: () => 'pw',
      confirmed: new Set(),
    })
    expect(result).toMatchObject({
      ok: false,
      done: [],
      failed: { stepId: 'error:login-name-changed', error: { code: 'invalid' } },
      notRun: ['account:blue-co'],
    })
    expect(log).toEqual([])
  })

  it('refuses a plan with a locked-template error the same way (TD6)', async () => {
    const { ops: adminOps, log } = await rig()
    const plan: PublishPlan = {
      ...planOf([createBlueCo]),
      errors: [
        { kind: 'template-locked-changed', templateId: 't', name: 'Sitrep', message: 'locked' },
      ],
    }
    const result = await executePlan(adminOps, plan, {
      passwordFor: () => 'pw',
      confirmed: new Set(),
    })
    expect(result).toMatchObject({
      ok: false,
      failed: { stepId: 'error:template-locked-changed', error: { code: 'invalid', target: 't' } },
    })
    expect(log).toEqual([])
  })

  const retract: PlanStep = {
    id: 'retract:templates:t1',
    group: 'removals',
    summary: 'Remove the template Old',
    details: [],
    risk: { destructive: true, roles: [] },
    action: { type: 'retract-item', node: 'templates', itemId: 't1' },
  }

  it('retracts a template only once confirmed, then checks it is gone (Annex A)', async () => {
    const { admin, ops: adminOps, log } = await rig()
    admin.stub('pubsub', 'getItems', () => Promise.resolve(ok([])))
    const unconfirmed = await executePlan(adminOps, planOf([retract]), {
      passwordFor: () => 'pw',
      confirmed: new Set(),
    })
    expect(unconfirmed.failed?.error.code).toBe('not-confirmed')
    expect(log).toEqual([])
    const result = await executePlan(adminOps, planOf([retract]), {
      passwordFor: () => 'pw',
      confirmed: new Set(['template:t1']),
    })
    expect(result.ok).toBe(true)
    expect(ops(log)).toEqual(['admin.pubsub.retract'])
  })

  it('fails a retraction the server did not carry out', async () => {
    const { admin, ops: adminOps } = await rig()
    admin.stub('pubsub', 'getItems', () =>
      Promise.resolve(ok([{ id: 't1', payload: '{}', publisher: undefined }])),
    )
    const result = await executePlan(adminOps, planOf([retract]), {
      passwordFor: () => 'pw',
      confirmed: new Set(['template:t1']),
    })
    expect(result).toMatchObject({ ok: false, failed: { error: { code: 'verify-failed' } } })
  })

  it('refuses to retract below `templates`, which stays reserved', async () => {
    const { ops: adminOps } = await rig()
    const below: PlanStep = {
      ...retract,
      action: { type: 'retract-item', node: 'templates:x', itemId: 't1' },
    }
    const result = await executePlan(adminOps, planOf([below]), {
      passwordFor: () => 'pw',
      confirmed: new Set(['template:t1']),
    })
    expect(result.ok).toBe(false)
  })
})

describe('confirmations are enforced by the executor, not only the UI (security review F9)', () => {
  const deleteGhost: PlanStep = {
    id: 'delete-role:ghost',
    group: 'removals',
    summary: 'Delete role ghost',
    details: [],
    risk: { destructive: true, roles: ['ghost'] },
    action: { type: 'delete-role', roleId: 'ghost', rooms: [], nodes: [] },
  }

  it('refuses a plan with an unconfirmed step, before running anything', async () => {
    const { ops: adminOps, log } = await rig()
    const result = await executePlan(adminOps, planOf([createBlueCo, deleteGhost]), {
      passwordFor: () => 'pw',
      confirmed: new Set(),
    })
    expect(result).toMatchObject({
      ok: false,
      done: [],
      failed: { stepId: 'delete-role:ghost', error: { code: 'not-confirmed' } },
      notRun: ['account:blue-co'],
    })
    expect(log).toEqual([])
  })

  it('runs it once its confirmation is given', async () => {
    const { ops: adminOps, log } = await rig()
    const result = await executePlan(adminOps, planOf([deleteGhost]), {
      passwordFor: () => 'pw',
      confirmed: new Set(['role:ghost']),
    })
    expect(result.ok).toBe(true)
    expect(ops(log)).toContain('admin.admin.deleteUser')
  })
})
