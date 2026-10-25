// Running a plan (ADM-11): one AdminOps call per step, in order, reporting each. It stops at the
// first failure and says which steps ran, which failed and which did not, so nothing is left
// silently half-done; planning again from the server then lists exactly what is left, and
// running that completes the publish. The publish marker (marker.ts) is set before the first
// step and cleared after the last.
import type { AdminOpsError, OpsOutcome } from '../errors.ts'
import { opsErr, opsOk } from '../errors.ts'
import type { AdminOps } from '../ops.ts'
import { newMarker } from './marker.ts'
import type { MarkerStore } from './marker.ts'
import { stepConfirmation } from './plan.ts'
import type { PlanStep, PublishPlan } from './plan.ts'

/** The step id a failure to set the publish marker is reported under; no step has run. */
export const MARKER_STEP = 'publish-marker'

export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'not-run'

export interface StepEvent {
  readonly stepId: string
  readonly state: 'running' | 'done' | 'failed'
  readonly error?: AdminOpsError
  /** Something the admin should know about a step that succeeded, e.g. an account existed. */
  readonly note?: string
}

export interface ExecuteOptions {
  /**
   * The password for an account the step creates or resets. The caller keeps it in memory for
   * the credentials sheet (ADM-26); it is never stored by the publish.
   */
  readonly passwordFor: (roleId: string) => string
  readonly onStep?: (event: StepEvent) => void
  readonly now?: () => Date
  /** Where the publish marker is kept (marker.ts). */
  readonly marker?: MarkerStore
  /**
   * The confirmations the admin gave (`confirmationKey` of each warning ticked). A plan with a
   * step whose `stepConfirmation` is not in here runs no step at all (security review F9).
   */
  readonly confirmed: ReadonlySet<string>
}

export interface ExecutionResult {
  readonly ok: boolean
  /** Step ids that completed, in order. */
  readonly done: readonly string[]
  /** The step that failed, and why. */
  readonly failed?: { readonly stepId: string; readonly error: AdminOpsError }
  /** Step ids not attempted because an earlier one failed. */
  readonly notRun: readonly string[]
  /** Roles whose password `passwordFor` was asked for and set on the server. */
  readonly passwordsSet: readonly string[]
  readonly notes: ReadonlyMap<string, string>
}

export async function executePlan(
  ops: AdminOps,
  plan: PublishPlan,
  options: ExecuteOptions,
): Promise<ExecutionResult> {
  const done: string[] = []
  const passwordsSet: string[] = []
  const notes = new Map<string, string>()
  const now = options.now ?? (() => new Date())
  const failAt = (index: number, stepId: string, error: AdminOpsError): ExecutionResult => {
    options.onStep?.({ stepId, state: 'failed', error })
    return {
      ok: false,
      done,
      failed: { stepId, error },
      notRun: plan.steps.slice(index + 1).map((s) => s.id),
      passwordsSet,
      notes,
    }
  }
  if (plan.steps.length === 0) return { ok: true, done, notRun: [], passwordsSet, notes }

  // Every confirmation is checked before the first step, so a refusal changes nothing.
  const unconfirmed = plan.steps.find((s) => {
    const key = stepConfirmation(s.action)
    return key !== undefined && !options.confirmed.has(key)
  })
  if (unconfirmed !== undefined) {
    const error = opsErr('not-confirmed', `${unconfirmed.summary}: not confirmed`, {
      target: unconfirmed.id,
    }).error
    options.onStep?.({ stepId: unconfirmed.id, state: 'failed', error })
    return {
      ok: false,
      done,
      failed: { stepId: unconfirmed.id, error },
      notRun: plan.steps.filter((s) => s !== unconfirmed).map((s) => s.id),
      passwordsSet,
      notes,
    }
  }

  if (plan.kind === 'publish' && plan.designVersion !== undefined && options.marker !== undefined) {
    // Fail closed: without the marker another admin browser could trust documents this publish
    // leaves behind half-done.
    const marked = await options.marker.write(newMarker(plan.designVersion, now()))
    if (!marked.ok) return failAt(-1, MARKER_STEP, marked.error)
  }

  for (const [index, step] of plan.steps.entries()) {
    options.onStep?.({ stepId: step.id, state: 'running' })
    let result: Awaited<OpsOutcome<string | undefined>>
    try {
      result = await runStep(ops, step, options.passwordFor, passwordsSet)
    } catch (error) {
      // AdminOps never rejects for a refusal; a rejection is a bug, still reported, never hung.
      result = opsErr('refused', `unexpected failure: ${String(error)}`, { target: step.id })
    }
    if (!result.ok) return failAt(index, step.id, result.error)
    if (result.value !== undefined) notes.set(step.id, result.value)
    done.push(step.id)
    options.onStep?.({
      stepId: step.id,
      state: 'done',
      ...(result.value === undefined ? {} : { note: result.value }),
    })
  }

  await options.marker?.clear()
  return { ok: true, done, notRun: [], passwordsSet, notes }
}

/** One step; resolves with an optional note. */
async function runStep(
  ops: AdminOps,
  step: PlanStep,
  passwordFor: (roleId: string) => string,
  passwordsSet: string[],
): OpsOutcome<string | undefined> {
  const none = (r: Awaited<OpsOutcome<unknown>>) => (r.ok ? opsOk(undefined) : r)
  const action = step.action
  switch (action.type) {
    case 'create-account': {
      const password = passwordFor(action.roleId)
      const created = await ops.createAccount(action.roleId, password, {
        readOnly: action.readOnly,
      })
      // An existing account fails `exists`: its password is never reset as a side effect (F3).
      // The planner creates only accounts the server does not list, so it was made since then;
      // planning again shows it.
      if (!created.ok) return created
      passwordsSet.push(action.roleId)
      return opsOk(undefined)
    }
    case 'reset-password': {
      const reset = await ops.setPassword(action.roleId, passwordFor(action.roleId), {
        readOnly: action.readOnly,
      })
      if (!reset.ok) return reset
      passwordsSet.push(action.roleId)
      return opsOk(undefined)
    }
    case 'ensure-room':
      return none(await ops.ensureRoom(action.roomId, { name: action.name }))
    case 'ensure-node':
      return none(await ops.ensureNode(action.node, action.config))
    case 'room-access':
      return none(await ops.applyRoomAccess(action.roomId, action.changes))
    case 'read-only':
      return none(await ops.makeReadOnly(action.roleId, action.roomIds))
    case 'node-access':
      return none(await ops.applyNodeAccess(action.node, action.changes))
    case 'publish':
      return none(
        await ops.publishDocument(action.node, action.config, action.itemId, action.payload),
      )
    case 'delete-role':
      return none(await ops.deleteRole(action.roleId, { rooms: action.rooms, nodes: action.nodes }))
    case 'destroy-room': {
      const destroyed = await ops.destroyRoom(action.roomId, { messageCount: action.messageCount })
      return destroyed.ok ? opsOk(undefined) : destroyed
    }
    case 'delete-node':
      return none(await ops.deleteNode(action.node))
  }
}
