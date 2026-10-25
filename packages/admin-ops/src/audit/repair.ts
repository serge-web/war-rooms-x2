// Repairing what the audit found (WP 2.10, ADM-41). Each item carries the publish planner's own
// step actions, so a repair runs exactly what a publish would, through the same executor and
// AdminOps operations (R-A to R-F); they are idempotent, so repairing twice, or repairing what is
// already right, changes nothing. Actions run in the planner's order (accounts, rooms, nodes,
// grants, revokes, documents, removals: R-D), each once however many items share it. Unlike a
// publish, a failure does not stop the others: the items are independent, and re-auditing shows
// what is left. A destructive item runs only if the admin confirmed it.
import type { DesignFile } from '@wrx/schemas'
import type { AdminOpsError, OpsOutcome } from '../errors.ts'
import { opsOk } from '../errors.ts'
import type { AdminOps } from '../ops.ts'
import { executePlan } from '../publish/execute.ts'
import { canonicalJson, isDestructiveAction, stepConfirmation } from '../publish/plan.ts'
import type { PlanStep, PublishPlan, StepAction, StepGroup } from '../publish/plan.ts'
import { repairRank } from './diff.ts'
import { runAudit } from './run.ts'
import type { AuditOptions } from './run.ts'
import type { AuditItem, AuditReport } from './types.ts'

export type RepairState = 'running' | 'done' | 'failed' | 'skipped'

export interface RepairEvent {
  readonly itemId: string
  readonly state: RepairState
  readonly error?: AdminOpsError
  /** Why it was skipped, or something to know about a repair that ran. */
  readonly note?: string
}

export interface RepairOptions {
  /** Ids of destructive items the admin confirmed one by one; others are skipped. */
  readonly confirmed?: ReadonlySet<string>
  /** A new password for an account a repair creates or resets (ADM-26); never stored here. */
  readonly passwordFor: (roleId: string) => string
  readonly onItem?: (event: RepairEvent) => void
}

export interface RepairResult {
  readonly ok: boolean
  readonly done: readonly string[]
  readonly failed: readonly { readonly itemId: string; readonly error: AdminOpsError }[]
  readonly skipped: readonly { readonly itemId: string; readonly reason: string }[]
  /** Roles whose password was set, for the credentials sheet. */
  readonly passwordsSet: readonly string[]
}

const GROUP_OF_RANK: readonly StepGroup[] = Object.freeze([
  'accounts',
  'rooms',
  'nodes',
  'access',
  'access',
  'documents',
  'removals',
])

interface Job {
  readonly key: string
  readonly action: StepAction
  readonly rank: number
  readonly items: string[]
}

/**
 * Whether repairing an item cannot be undone, worked out from its actions as well as its flag,
 * so an item can never make a destructive action run unconfirmed (security review F9).
 */
export function isDestructiveItem(item: Pick<AuditItem, 'destructive' | 'repair'>): boolean {
  return item.destructive || item.repair.some(isDestructiveAction)
}

/** The repairs to run for `items`, deduplicated and in order. */
function jobsFor(items: readonly AuditItem[]): Job[] {
  const jobs = new Map<string, Job>()
  for (const item of items) {
    for (const action of item.repair) {
      const key = canonicalJson(action)
      const job = jobs.get(key) ?? { key, action, rank: repairRank(action), items: [] }
      job.items.push(item.id)
      jobs.set(key, job)
    }
  }
  // Stable: equal ranks keep the report's order (most severe first).
  return [...jobs.values()].sort((a, b) => a.rank - b.rank)
}

function onePlan(step: PlanStep): PublishPlan {
  return {
    kind: 'publish',
    steps: [step],
    designVersion: undefined,
    publishedVersion: undefined,
    warnings: [],
    affectedOnline: [],
    documentsChange: step.action.type === 'publish',
    vault: 'none',
    uncounted: [],
    roleNames: {},
  }
}

/** Repairs the given items (normally the ones the admin selected from a report). */
export async function repairItems(
  ops: AdminOps,
  items: readonly AuditItem[],
  options: RepairOptions,
): Promise<RepairResult> {
  const confirmed = options.confirmed ?? new Set<string>()
  const emit = options.onItem ?? (() => undefined)
  const skipped: { itemId: string; reason: string }[] = []
  const runnable: AuditItem[] = []
  for (const item of items) {
    const reason = !item.repairable
      ? 'nothing here repairs it'
      : isDestructiveItem(item) && !confirmed.has(item.id)
        ? 'not confirmed'
        : undefined
    if (reason === undefined) runnable.push(item)
    else {
      skipped.push({ itemId: item.id, reason })
      emit({ itemId: item.id, state: 'skipped', note: reason })
    }
  }

  const jobs = jobsFor(runnable)
  const remaining = new Map(runnable.map((i) => [i.id, i.repair.length]))
  const failed = new Map<string, AdminOpsError>()
  const started = new Set<string>()
  const passwordsSet: string[] = []
  for (const [index, job] of jobs.entries()) {
    const live = job.items.filter((id) => !failed.has(id))
    if (live.length === 0) continue
    for (const id of live) {
      if (started.has(id)) continue
      started.add(id)
      emit({ itemId: id, state: 'running' })
    }
    const step: PlanStep = {
      id: `repair-${index}`,
      group: GROUP_OF_RANK[job.rank] ?? 'access',
      summary: job.action.type,
      details: [],
      risk: { destructive: false, roles: [] },
      action: job.action,
    }
    // Every item behind this job was confirmed above if its repair needs it.
    const key = stepConfirmation(job.action)
    const result = await executePlan(ops, onePlan(step), {
      passwordFor: options.passwordFor,
      confirmed: new Set(key === undefined ? [] : [key]),
    })
    passwordsSet.push(...result.passwordsSet)
    const note = result.notes.get(step.id)
    for (const id of live) {
      if (!result.ok && result.failed !== undefined) {
        failed.set(id, result.failed.error)
        emit({ itemId: id, state: 'failed', error: result.failed.error })
        continue
      }
      const left = (remaining.get(id) ?? 1) - 1
      remaining.set(id, left)
      if (left === 0) emit({ itemId: id, state: 'done', ...(note === undefined ? {} : { note }) })
    }
  }

  const done = runnable.filter((i) => !failed.has(i.id)).map((i) => i.id)
  return {
    ok: failed.size === 0,
    done,
    failed: [...failed].map(([itemId, error]) => ({ itemId, error })),
    skipped,
    passwordsSet: [...new Set(passwordsSet)],
  }
}

export interface RepairAndAudit {
  readonly repair: RepairResult
  /** The audit run again after the repairs. */
  readonly after: AuditReport
}

/** Repairs `items`, then audits again, so the admin sees what is left (ADM-41). */
export async function repairAndAudit(
  ops: AdminOps,
  design: DesignFile,
  items: readonly AuditItem[],
  options: RepairOptions & { readonly audit?: AuditOptions },
): OpsOutcome<RepairAndAudit> {
  const repair = await repairItems(ops, items, options)
  const after = await runAudit(ops, design, options.audit ?? {})
  if (!after.ok) return after
  return opsOk({ repair, after: after.value.report })
}
