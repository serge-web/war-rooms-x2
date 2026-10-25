// The publish plan's steps (ADM-10, ADM-11): one disclosure per group (accounts, rooms, nodes,
// access, documents, removals, game setup), collapsed by default, each showing its step count
// and a status rolled up from progress. Inside, repeated steps of one kind fold into a batch
// line ("Give node access: 15 nodes × roles (54 grants)") that expands to every step and its
// details. A group or batch holding a failed step opens by itself. A polite live region says
// how far a run has got.
import type { PlanStep, PublishPlan } from '@wrx/admin-ops'
import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/index.ts'
import type { PublishSnapshot, StepProgress } from './controller.ts'
import { describeError } from './controller.ts'
import { groupPlan, progressLine, rollup } from './planGroups.ts'
import type { PlanBatch, PlanGroup } from './planGroups.ts'

const STATE_LABEL: Readonly<Record<StepProgress['state'], string>> = Object.freeze({
  pending: 'To do',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  'not-run': 'Not run',
})

const PENDING: StepProgress = Object.freeze({ state: 'pending' })

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export interface PlanStepsProps {
  readonly plan: PublishPlan
  readonly progress: PublishSnapshot['progress']
  readonly online: readonly string[]
}

export function PlanSteps({ plan, progress, online }: PlanStepsProps) {
  const groups = useMemo(() => groupPlan(plan.steps), [plan])
  // Only what the admin toggled; the rest follows the default (closed, open on a failure).
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map())
  const failed = (steps: readonly PlanStep[]) =>
    steps.some((s) => progress.get(s.id)?.state === 'failed')
  const isOpen = (key: string, steps: readonly PlanStep[]) => toggled.get(key) ?? failed(steps)
  const toggle = (key: string, steps: readonly PlanStep[]) => {
    setToggled(new Map(toggled).set(key, !isOpen(key, steps)))
  }
  const disclosures = groups.flatMap((g) => [
    { key: g.id, steps: g.steps },
    ...(g.batches.length > 1 ? g.batches.filter((b) => b.steps.length > 1) : []).map((b) => ({
      key: b.key,
      steps: b.steps,
    })),
  ])
  const everyOpen = disclosures.every((d) => isOpen(d.key, d.steps))
  const names = (ids: readonly string[]) => ids.map((id) => plan.roleNames[id] ?? id).join(', ')
  const onlineIn = (steps: readonly PlanStep[]) => [
    ...new Set(steps.flatMap((s) => s.risk.roles.filter((id) => online.includes(id)))),
  ]

  return (
    <div className="wrx-publish-groups">
      <div className="wrx-publish-toolbar">
        <Button
          variant="quiet"
          onClick={() => {
            setToggled(new Map(disclosures.map((d) => [d.key, !everyOpen])))
          }}
        >
          {everyOpen ? 'Collapse every group' : 'Show every step'}
        </Button>
        <p className="wrx-publish-progress" role="status">
          {progressLine(plan.steps, progress)}
        </p>
      </div>
      {groups.map((group) => (
        <GroupView
          key={group.id}
          group={group}
          progress={progress}
          open={isOpen(group.id, group.steps)}
          onToggle={() => {
            toggle(group.id, group.steps)
          }}
          batchOpen={(b) => isOpen(b.key, b.steps)}
          onToggleBatch={(b) => {
            toggle(b.key, b.steps)
          }}
          online={onlineIn}
          names={names}
        />
      ))}
    </div>
  )
}

interface ViewProps {
  readonly progress: PublishSnapshot['progress']
  readonly online: (steps: readonly PlanStep[]) => readonly string[]
  readonly names: (ids: readonly string[]) => string
}

function Tags({
  destructive,
  affected,
  names,
}: {
  readonly destructive: boolean
  readonly affected: readonly string[]
  readonly names: (ids: readonly string[]) => string
}) {
  return (
    <>
      {destructive && <span className="wrx-admin-tag wrx-publish-danger">Removes</span>}
      {affected.length > 0 && (
        <span className="wrx-admin-tag wrx-publish-online-tag">Online: {names(affected)}</span>
      )}
    </>
  )
}

/** A disclosure button (WAI-ARIA disclosure pattern) and the region it shows and hides. */
function Disclosure({
  open,
  onToggle,
  label,
  after,
  children,
  heading,
}: {
  readonly open: boolean
  readonly onToggle: () => void
  readonly label: ReactNode
  readonly after?: ReactNode
  readonly children: ReactNode
  readonly heading: boolean
}) {
  const id = useId()
  const button = (
    <button
      type="button"
      className="wrx-publish-disclosure"
      aria-expanded={open}
      aria-controls={id}
      onClick={onToggle}
    >
      <span className="wrx-publish-chevron" aria-hidden="true">
        {open ? '▾' : '▸'}
      </span>
      {label}
    </button>
  )
  return (
    <>
      {heading ? (
        <h4 className="wrx-publish-group-title">
          {button}
          {after}
        </h4>
      ) : (
        <div className="wrx-publish-batch-title">
          {button}
          {after}
        </div>
      )}
      <div id={id} hidden={!open}>
        {open ? children : null}
      </div>
    </>
  )
}

function GroupView({
  group,
  progress,
  open,
  onToggle,
  batchOpen,
  onToggleBatch,
  online,
  names,
}: ViewProps & {
  readonly group: PlanGroup
  readonly open: boolean
  readonly onToggle: () => void
  readonly batchOpen: (b: PlanBatch) => boolean
  readonly onToggleBatch: (b: PlanBatch) => void
}) {
  const status = rollup(group.steps, progress)
  // A group of one kind lists its steps directly: its heading already says what they are.
  const single = group.batches.length === 1
  return (
    <section
      className="wrx-publish-group"
      aria-label={group.label}
      data-group={group.id}
      data-state={status.state}
    >
      <Disclosure
        heading
        open={open}
        onToggle={onToggle}
        label={
          <>
            <span className="wrx-publish-group-name">{group.label}</span>
            <span className="wrx-publish-count">
              {single ? (group.batches[0]?.summary ?? '') : plural(group.steps.length, 'step')}
            </span>
            <span className="wrx-publish-rollup" data-state={status.state}>
              {status.label}
            </span>
          </>
        }
        after={
          <Tags destructive={group.destructive} affected={online(group.steps)} names={names} />
        }
      >
        <ol className="wrx-publish-steps">
          {single
            ? group.steps.map((step) => (
                <StepItem key={step.id} step={step} progress={progress} {...{ online, names }} />
              ))
            : group.batches.map((batch) =>
                batch.steps.length === 1 && batch.steps[0] !== undefined ? (
                  <StepItem
                    key={batch.key}
                    step={batch.steps[0]}
                    progress={progress}
                    {...{ online, names }}
                  />
                ) : (
                  <BatchItem
                    key={batch.key}
                    batch={batch}
                    progress={progress}
                    open={batchOpen(batch)}
                    onToggle={() => {
                      onToggleBatch(batch)
                    }}
                    {...{ online, names }}
                  />
                ),
              )}
        </ol>
      </Disclosure>
    </section>
  )
}

function BatchItem({
  batch,
  progress,
  open,
  onToggle,
  online,
  names,
}: ViewProps & {
  readonly batch: PlanBatch
  readonly open: boolean
  readonly onToggle: () => void
}) {
  const status = rollup(batch.steps, progress)
  return (
    <li data-batch={batch.key} data-state={status.state}>
      <Disclosure
        heading={false}
        open={open}
        onToggle={onToggle}
        label={
          <>
            <span className="wrx-publish-batch-name">{batch.summary}</span>
            <span className="wrx-publish-rollup" data-state={status.state}>
              {status.label}
            </span>
          </>
        }
        after={
          <Tags destructive={batch.destructive} affected={online(batch.steps)} names={names} />
        }
      >
        <ol className="wrx-publish-steps">
          {batch.steps.map((step) => (
            <StepItem key={step.id} step={step} progress={progress} {...{ online, names }} />
          ))}
        </ol>
      </Disclosure>
    </li>
  )
}

function StepItem({ step, progress, online, names }: ViewProps & { readonly step: PlanStep }) {
  const state = progress.get(step.id) ?? PENDING
  const affected = online([step])
  return (
    <li data-step={step.id} data-state={state.state}>
      <span className="wrx-publish-state">{STATE_LABEL[state.state]}</span>{' '}
      <span>{step.summary}</span>
      <Tags destructive={step.risk.destructive} affected={affected} names={names} />
      {step.details.length > 0 && (
        <ul className="wrx-publish-details">
          {step.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {state.note !== undefined && <p className="wrx-admin-muted">{state.note}</p>}
      {state.error !== undefined && (
        <p className="wrx-publish-error">{describeError(state.error)}</p>
      )}
    </li>
  )
}
