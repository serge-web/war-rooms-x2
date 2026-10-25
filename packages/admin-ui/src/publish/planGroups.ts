// The publish plan as the admin reads it (ADM-10, ADM-11): the steps folded into groups in the
// order they run (accounts, rooms, nodes, access, documents, removals, game setup), and within a
// group into batches of the same kind, so a design with many rooms reads as "Give node access:
// 15 nodes × roles (54 grants)" rather than one line per node. Each group and batch carries a
// status rolled up from its steps' progress. Pure: the view draws it.
import type { PlanStep, StepGroup } from '@wrx/admin-ops'
import { SINGLETON_NODES } from '@wrx/schemas'
import type { StepProgress } from './controller.ts'

export type PlanGroupId = StepGroup | 'game-setup'

export const PLAN_GROUPS: readonly PlanGroupId[] = Object.freeze([
  'accounts',
  'rooms',
  'nodes',
  'access',
  'documents',
  'removals',
  'game-setup',
])

export const PLAN_GROUP_LABEL: Readonly<Record<PlanGroupId, string>> = Object.freeze({
  accounts: 'Accounts',
  rooms: 'Rooms',
  nodes: 'Nodes',
  access: 'Access',
  documents: 'Documents',
  removals: 'Removals',
  'game-setup': 'Game setup',
})

/** A rolled-up state: `partial` when some steps are done and the rest not yet run. */
export type RollupState = StepProgress['state'] | 'partial'

export interface Rollup {
  readonly state: RollupState
  readonly done: number
  readonly total: number
  /** Short text, e.g. "To do", "Running: 3 of 15 done", "Failed: 2 of 4 done". */
  readonly label: string
}

export interface PlanBatch {
  /** Unique in the plan, e.g. `access:grant-node`. */
  readonly key: string
  /** One line for the batch, e.g. "Give node access: 15 nodes × roles (54 grants)". */
  readonly summary: string
  readonly steps: readonly PlanStep[]
  readonly destructive: boolean
}

export interface PlanGroup {
  readonly id: PlanGroupId
  readonly label: string
  readonly steps: readonly PlanStep[]
  readonly batches: readonly PlanBatch[]
  readonly destructive: boolean
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`
}

function groupOf(step: PlanStep): PlanGroupId {
  if (step.action.type === 'publish' && step.action.node === SINGLETON_NODES.gameSetup) {
    return 'game-setup'
  }
  return step.group
}

interface Kind {
  readonly key: string
  /** The batch line for several steps of this kind. */
  readonly summary: (steps: readonly PlanStep[]) => string
}

const grants = (steps: readonly PlanStep[]) =>
  steps.reduce(
    (n, s) =>
      n +
      (s.action.type === 'room-access' || s.action.type === 'node-access'
        ? s.action.changes.length
        : 0),
    0,
  )

function kindOf(step: PlanStep): Kind {
  const a = step.action
  switch (a.type) {
    case 'create-account':
      return {
        key: 'create-account',
        summary: (s) => `Create accounts: ${plural(s.length, 'role')}`,
      }
    case 'reset-password':
      return {
        key: 'reset-password',
        summary: (s) => `Reset passwords and keep them in the vault: ${plural(s.length, 'role')}`,
      }
    case 'ensure-room':
      return a.create
        ? { key: 'create-room', summary: (s) => `Create rooms: ${plural(s.length, 'room')}` }
        : { key: 'configure-room', summary: (s) => `Configure rooms: ${plural(s.length, 'room')}` }
    case 'ensure-node':
      return a.create
        ? { key: 'create-node', summary: (s) => `Create nodes: ${plural(s.length, 'node')}` }
        : { key: 'configure-node', summary: (s) => `Configure nodes: ${plural(s.length, 'node')}` }
    case 'room-access':
      return step.risk.destructive
        ? {
            key: 'revoke-room',
            summary: (s) =>
              `Remove room access: ${plural(s.length, 'room')} × roles (${plural(grants(s), 'membership')})`,
          }
        : {
            key: 'grant-room',
            summary: (s) =>
              `Give write access: ${plural(s.length, 'room')} × roles (${plural(grants(s), 'grant')})`,
          }
    case 'read-only':
      return step.risk.destructive
        ? {
            key: 'read-only-revoke',
            summary: (s) => `Make roles read-only: ${plural(s.length, 'role')}`,
          }
        : {
            key: 'read-only-grant',
            summary: (s) => `Give read-only access: ${plural(s.length, 'role')}`,
          }
    case 'node-access':
      return step.risk.destructive
        ? {
            key: 'revoke-node',
            summary: (s) =>
              `Remove node access: ${plural(s.length, 'node')} × roles (${plural(grants(s), 'removal')})`,
          }
        : {
            key: 'grant-node',
            summary: (s) =>
              `Give node access: ${plural(s.length, 'node')} × roles (${plural(grants(s), 'grant')})`,
          }
    case 'publish':
      return {
        key: 'publish',
        summary: (s) => `Publish documents: ${plural(s.length, 'document')}`,
      }
    case 'delete-role':
      return { key: 'delete-role', summary: (s) => `Delete roles: ${plural(s.length, 'role')}` }
    case 'destroy-room':
      return {
        key: 'destroy-room',
        summary: (s) => `Destroy rooms and their history: ${plural(s.length, 'room')}`,
      }
    case 'delete-node':
      return { key: 'delete-node', summary: (s) => `Delete nodes: ${plural(s.length, 'node')}` }
  }
}

/** The plan's steps in groups and batches, keeping the run order; empty groups are left out. */
export function groupPlan(steps: readonly PlanStep[]): readonly PlanGroup[] {
  const byGroup = new Map<PlanGroupId, PlanStep[]>()
  for (const step of steps) {
    const id = groupOf(step)
    byGroup.set(id, [...(byGroup.get(id) ?? []), step])
  }
  return PLAN_GROUPS.flatMap((id) => {
    const inGroup = byGroup.get(id)
    if (inGroup === undefined) return []
    const batches = new Map<string, { kind: Kind; steps: PlanStep[] }>()
    for (const step of inGroup) {
      const kind = kindOf(step)
      const entry = batches.get(kind.key) ?? { kind, steps: [] }
      entry.steps.push(step)
      batches.set(kind.key, entry)
    }
    return [
      {
        id,
        label: PLAN_GROUP_LABEL[id],
        steps: inGroup,
        destructive: inGroup.some((s) => s.risk.destructive),
        batches: [...batches.values()].map(({ kind, steps: batch }) => ({
          key: `${id}:${kind.key}`,
          summary: batch.length === 1 ? (batch[0]?.summary ?? '') : kind.summary(batch),
          steps: batch,
          destructive: batch.some((s) => s.risk.destructive),
        })),
      },
    ]
  })
}

const PENDING: StepProgress = Object.freeze({ state: 'pending' })

/** The status of a set of steps, from each step's progress. */
export function rollup(
  steps: readonly PlanStep[],
  progress: ReadonlyMap<string, StepProgress>,
): Rollup {
  const states = steps.map((s) => (progress.get(s.id) ?? PENDING).state)
  const total = states.length
  const done = states.filter((s) => s === 'done').length
  const has = (state: StepProgress['state']) => states.includes(state)
  const of = `${done} of ${total} done`
  if (has('failed')) return { state: 'failed', done, total, label: `Failed: ${of}` }
  if (has('running')) return { state: 'running', done, total, label: `Running: ${of}` }
  if (done === total) return { state: 'done', done, total, label: 'Done' }
  if (states.every((s) => s === 'not-run')) {
    return { state: 'not-run', done, total, label: 'Not run' }
  }
  if (done === 0 && states.every((s) => s === 'pending')) {
    return { state: 'pending', done, total, label: 'To do' }
  }
  return { state: 'partial', done, total, label: of }
}

/** One line for a live region while a plan runs, e.g. "12 of 57 steps done." */
export function progressLine(
  steps: readonly PlanStep[],
  progress: ReadonlyMap<string, StepProgress>,
): string {
  const r = rollup(steps, progress)
  if (r.state === 'pending') return ''
  const of = `${r.done} of ${plural(r.total, 'step')} done`
  switch (r.state) {
    case 'running':
      return `Applying: ${of}.`
    case 'failed':
      return `Stopped at a failure: ${of}.`
    case 'done':
      return `All ${plural(r.total, 'step')} done.`
    default:
      return `${of}.`
  }
}
