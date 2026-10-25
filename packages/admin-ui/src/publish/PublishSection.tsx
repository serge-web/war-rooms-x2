// The Publish section (WP 2.3): server checks (NFR-4), the plan grouped by kind (ADM-10), the
// online roles it affects and its warnings (ADM-13, ADM-14, ADM-17, ADM-25, ADM-40), the
// confirmation, progress per step and the result with a re-run (ADM-11), the vault (ADM-37),
// the credentials sheet (ADM-26), reset (ADM-15) and design import / export (ADM-16).
//
// `PublishSectionCore` draws plain props; `PublishSection` wires a `PublishController`.
import { STEP_GROUPS, needsConfirmation } from '@wrx/admin-ops'
import type {
  Credential,
  ExecutionResult,
  PlanStep,
  PlanWarning,
  PublishPlan,
  ServerCheck,
  StepGroup,
} from '@wrx/admin-ops'
import type { DesignFile, DesignIssue } from '@wrx/schemas'
import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IssueList, Notice, SectionFrame } from '../components/index.ts'
import type { Draft, DraftStore, DraftValidation } from '../draft/index.ts'
import { sortedRoles } from '../draft/index.ts'
import type { PublishConnection, PublishSnapshot, StepProgress } from './controller.ts'
import { describeError } from './controller.ts'
import { ApplyDialog, VaultDialog } from './dialogs.tsx'
import type { Acknowledgement } from './dialogs.tsx'
import { exportDesign, importDesign } from './transfer.ts'
import type { usePublish } from './usePublish.ts'
import './publish.css'

const GROUP_LABEL: Readonly<Record<StepGroup, string>> = Object.freeze({
  accounts: 'Accounts',
  rooms: 'Rooms',
  nodes: 'Nodes',
  access: 'Access',
  documents: 'Documents',
  removals: 'Removals',
})

const STATE_LABEL: Readonly<Record<StepProgress['state'], string>> = Object.freeze({
  pending: 'To do',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  'not-run': 'Not run',
})

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export interface PublishSectionProps {
  /** From `usePublish`, held by the admin app so passwords and the vault outlive the section. */
  readonly publish: ReturnType<typeof usePublish>
  readonly kind: PublishConnection['kind'] | undefined
  readonly store: DraftStore
  readonly draft: Draft
  readonly validation: DraftValidation
  /** Starts a file download; default: a link to a Blob URL. */
  readonly download?: (name: string, text: string) => void
  /** Prints the page; default `window.print`. */
  readonly print?: () => void
}

export function PublishSection({ publish, kind, store, download, ...rest }: PublishSectionProps) {
  const { snapshot, controller } = publish
  const save = download ?? browserDownload
  const notConnected = () => Promise.resolve('Not connected to a server.')
  return (
    <PublishSectionCore
      {...rest}
      connection={kind === undefined || controller === undefined ? undefined : { kind }}
      snapshot={snapshot}
      onPlan={() => void controller?.plan()}
      onPlanReset={() => void controller?.planReset()}
      onApply={() => void controller?.apply()}
      onDismiss={() => controller?.dismiss()}
      onCreateVault={(p) => controller?.createVault(p) ?? notConnected()}
      onUnlockVault={(p) => controller?.unlockVault(p) ?? notConnected()}
      onLockVault={() => controller?.lockVault()}
      onResetPassword={(id) => controller?.resetPassword(id) ?? notConnected()}
      onExport={() => {
        const file = exportDesign(store.getSnapshot().draft)
        save(file.name, file.text)
      }}
      onImport={(text) => {
        const imported = importDesign(text, store.getSnapshot().draft)
        if (!imported.ok) return imported.error
        store.commit(imported.value.draft)
        return imported.value.warnings
      }}
    />
  )
}

function browserDownload(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

export interface PublishSectionCoreProps {
  /** Undefined when the admin UI has no server connection (e.g. the editor on its own). */
  readonly connection: { readonly kind: 'mock' | 'xmpp' } | undefined
  readonly draft: Draft
  readonly validation: DraftValidation
  readonly snapshot: PublishSnapshot
  readonly onPlan: () => void
  readonly onPlanReset: () => void
  readonly onApply: () => void
  readonly onDismiss: () => void
  readonly onCreateVault: (passphrase: string) => Promise<string | undefined>
  readonly onUnlockVault: (passphrase: string) => Promise<string | undefined>
  readonly onLockVault: () => void
  readonly onResetPassword: (roleId: string) => Promise<string | undefined>
  readonly onExport: () => void
  /** Imports a file's text; returns the blocking issues, or the warnings when it was imported. */
  readonly onImport: (text: string) => readonly DesignIssue[]
  readonly print?: () => void
}

export function PublishSectionCore(props: PublishSectionCoreProps) {
  const { connection, draft, validation, snapshot } = props
  const { plan, busy } = snapshot
  const design = draft.design
  const stale =
    plan?.kind === 'publish' &&
    snapshot.result === undefined &&
    snapshot.plannedFrom !== undefined &&
    snapshot.plannedFrom.design !== design
  return (
    <SectionFrame
      title="Publish"
      intro={
        <p className="wrx-admin-muted">
          Publishing turns the draft into server state: only what differs from the server changes,
          new access is granted before old access is removed, and you see the online roles a change
          affects before anything is applied.
        </p>
      }
    >
      {connection === undefined ? (
        <Notice tone="warning" title="Not connected to a server.">
          Log in as the admin to publish. Import and export still work.
        </Notice>
      ) : (
        <>
          {connection.kind === 'mock' && (
            <Notice title="Mock server.">
              New roles get known demo passwords (demo-&lt;login id&gt;), which are not secret. A
              real server gets random passwords.
            </Notice>
          )}
          {!validation.publishable && (
            <Notice tone="error" title="The draft has errors.">
              Fix {plural(validation.errorCount, 'error')} before publishing.
            </Notice>
          )}
          <div className="wrx-publish-toolbar">
            <Button
              variant="primary"
              disabled={busy !== undefined || !validation.publishable}
              onClick={props.onPlan}
            >
              {plan === undefined ? 'Check the server and plan' : 'Plan again'}
            </Button>
            <VaultStatus {...props} />
            {busy !== undefined && (
              <span className="wrx-admin-muted" role="status">
                {busy === 'planning'
                  ? 'Reading the server…'
                  : busy === 'running'
                    ? 'Applying…'
                    : busy === 'vault'
                      ? 'Opening the vault…'
                      : 'Setting the password…'}
              </span>
            )}
          </div>
          {snapshot.error !== undefined && <Notice tone="error">{snapshot.error}</Notice>}
          {snapshot.checks.length > 0 && <ServerChecks checks={snapshot.checks} />}
          {plan !== undefined && <PlanPanel {...props} plan={plan} stale={stale} />}
          <CredentialsSheet
            design={design}
            published={draft.meta.publishedRoleIds}
            credentials={snapshot.credentials}
            busy={busy !== undefined}
            onReset={props.onResetPassword}
            {...(props.print === undefined ? {} : { print: props.print })}
          />
          <section className="wrx-publish-panel" aria-labelledby="wrx-publish-reset">
            <h3 id="wrx-publish-reset">Reset the game</h3>
            <p>
              Deletes every role account, room (with its history) and document on the server. The
              draft stays.
            </p>
            <Button variant="danger" disabled={busy !== undefined} onClick={props.onPlanReset}>
              Plan a reset
            </Button>
          </section>
        </>
      )}
      <DesignTransfer onExport={props.onExport} onImport={props.onImport} />
    </SectionFrame>
  )
}

function VaultStatus({
  snapshot,
  onCreateVault,
  onUnlockVault,
  onLockVault,
}: PublishSectionCoreProps) {
  const busy = snapshot.busy !== undefined
  const need = snapshot.plan?.vault
  if (snapshot.vault === 'unlocked') {
    return (
      <span className="wrx-publish-vault">
        Vault unlocked.{' '}
        <Button variant="quiet" onClick={onLockVault}>
          Lock it
        </Button>
      </span>
    )
  }
  if (snapshot.vault === 'locked')
    return <VaultDialog mode="unlock" busy={busy} onSubmit={onUnlockVault} />
  if (snapshot.vault === 'none' && need === 'create') {
    return <VaultDialog mode="create" busy={busy} onSubmit={onCreateVault} />
  }
  return null
}

function ServerChecks({ checks }: { readonly checks: readonly ServerCheck[] }) {
  return (
    <section className="wrx-publish-panel" aria-labelledby="wrx-publish-checks">
      <h3 id="wrx-publish-checks">Server checks</h3>
      <ul className="wrx-publish-checks">
        {checks.map((c) => (
          <li key={c.id} data-status={c.status}>
            <span className="wrx-admin-tag">
              {c.status === 'pass'
                ? 'OK'
                : c.status === 'skipped'
                  ? 'Skipped'
                  : c.status === 'warn'
                    ? 'Warning'
                    : 'Failed'}
            </span>{' '}
            <strong>{c.label}:</strong> {c.detail}
          </li>
        ))}
      </ul>
    </section>
  )
}

function roleLabel(plan: PublishPlan, roleId: string): string {
  return plan.roleNames[roleId] ?? roleId
}

function warningText(w: PlanWarning): string {
  switch (w.kind) {
    case 'role-deleted':
      return `${w.name} (${w.roleId}) is deleted. Its message history stays attributed to its old login, ${w.roleId}.`
    case 'room-destroyed':
      return `${w.name} is destroyed with its history: ${plural(w.messageCount, 'message')} deleted for good.`
    case 'resync':
      return w.message
    case 'password-reset':
      return `${w.name} gets a new password: the vault must hold it to make the role read-only. Its players need the new password at their next login.`
    case 'objectives-kept':
      return `The objectives of force ${w.forceId} were removed from the draft, but the published text stays: no operation retracts it.`
  }
}

function acknowledgementOf(w: PlanWarning): Acknowledgement | undefined {
  if (!needsConfirmation(w)) return undefined
  switch (w.kind) {
    case 'role-deleted':
      return { id: `role:${w.roleId}`, label: `Delete ${w.name}; its history keeps the old login` }
    case 'room-destroyed':
      return {
        id: `room:${w.roomId}`,
        label: `Destroy ${w.name} and its ${plural(w.messageCount, 'message')}`,
      }
    case 'password-reset':
      return { id: `password:${w.roleId}`, label: `Reset the password of ${w.name}` }
    default:
      return undefined
  }
}

function PlanPanel(
  props: PublishSectionCoreProps & { readonly plan: PublishPlan; readonly stale: boolean },
) {
  const { plan, snapshot, draft, stale } = props
  const design = draft.design
  const reset = plan.kind === 'reset'
  const running = snapshot.busy === 'running'
  const result = snapshot.result
  const acknowledgements = plan.warnings
    .map(acknowledgementOf)
    .filter((a): a is Acknowledgement => a !== undefined)
  const headingId = useId()
  const blocked = plan.vault === 'create' || plan.vault === 'unlock' || plan.uncounted.length > 0
  const gameName = design.game.name.trim() === '' ? 'reset' : design.game.name

  return (
    <section className="wrx-publish-panel" aria-labelledby={headingId}>
      <h3 id={headingId}>{reset ? 'Reset plan' : 'Publish plan'}</h3>
      {plan.steps.length === 0 ? (
        <p role="status">
          {reset
            ? 'Nothing to reset: the server holds no game.'
            : 'Nothing to publish: the server matches the draft.'}
        </p>
      ) : (
        <>
          <p>
            {plural(plan.steps.length, 'change')}
            {plan.designVersion === undefined
              ? ''
              : `; the game becomes design version ${plan.designVersion}`}
            {plan.publishedVersion === undefined ? '' : ` (now ${plan.publishedVersion})`}.
          </p>
          {stale && (
            <Notice tone="warning" title="The draft changed since this plan.">
              Plan again to include the changes.
            </Notice>
          )}
          <OnlineRoles plan={plan} online={snapshot.online} />
          {plan.warnings.length > 0 && (
            <div className="wrx-publish-warnings">
              <h4>Warnings</h4>
              <ul>
                {plan.warnings.map((w, i) => (
                  <li key={i} data-kind={w.kind}>
                    {warningText(w)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.vault === 'create' && (
            <Notice tone="warning" title="A vault is needed.">
              A read-only role’s password must be kept in the vault. Create it, then plan again.
            </Notice>
          )}
          {plan.vault === 'unlock' && (
            <Notice tone="warning" title="Unlock the vault.">
              This plan changes accounts or read-only roles, which the vault must keep in step.
              Unlocking plans again.
            </Notice>
          )}
          <PlanSteps plan={plan} progress={snapshot.progress} online={snapshot.online} />
          {result === undefined && (
            <ApplyDialog
              triggerLabel={
                reset ? 'Reset the game…' : `Publish ${plural(plan.steps.length, 'change')}…`
              }
              triggerDisabled={running || blocked || stale}
              title={reset ? 'Reset the game?' : 'Publish these changes?'}
              acknowledgements={acknowledgements}
              {...(reset ? { typed: gameName } : {})}
              confirmLabel={reset ? 'Reset the game' : 'Publish'}
              onConfirm={props.onApply}
            >
              <p>
                {plural(plan.steps.length, 'change')} will be applied in order, stopping at the
                first failure.
                {plan.affectedOnline.length > 0 &&
                  ` ${plan.affectedOnline.map((id) => roleLabel(plan, id)).join(', ')} ${plan.affectedOnline.length === 1 ? 'is' : 'are'} online and affected now.`}
              </p>
            </ApplyDialog>
          )}
        </>
      )}
      {result !== undefined && (
        <Result
          plan={plan}
          result={result}
          remaining={snapshot.remaining}
          onPlan={props.onPlan}
          onDismiss={props.onDismiss}
        />
      )}
    </section>
  )
}

function OnlineRoles({
  plan,
  online,
}: {
  readonly plan: PublishPlan
  readonly online: readonly string[]
}) {
  return (
    <div className="wrx-publish-online" aria-label="Online roles affected">
      <h4>Online now</h4>
      {plan.affectedOnline.length === 0 ? (
        <p>No online role loses or gains access or its account.</p>
      ) : (
        <p>
          Affected while online:{' '}
          <strong>{plan.affectedOnline.map((id) => roleLabel(plan, id)).join(', ')}</strong>. They
          gain new access first; rooms they lose close for them at once.
        </p>
      )}
      {plan.documentsChange && online.length > 0 && (
        <p className="wrx-admin-muted">
          {plural(online.length, 'role')} online will see changed documents live.
        </p>
      )}
    </div>
  )
}

function PlanSteps({
  plan,
  progress,
  online,
}: {
  readonly plan: PublishPlan
  readonly progress: PublishSnapshot['progress']
  readonly online: readonly string[]
}) {
  const byGroup = new Map<StepGroup, PlanStep[]>()
  for (const step of plan.steps) byGroup.set(step.group, [...(byGroup.get(step.group) ?? []), step])
  return (
    <div className="wrx-publish-groups">
      {STEP_GROUPS.filter((g) => byGroup.has(g)).map((group) => {
        const steps = byGroup.get(group) ?? []
        return (
          <section key={group} className="wrx-admin-group" aria-label={GROUP_LABEL[group]}>
            <h4 className="wrx-admin-group-title">
              {GROUP_LABEL[group]} ({steps.length})
            </h4>
            <ol className="wrx-publish-steps">
              {steps.map((step) => {
                const state = progress.get(step.id) ?? { state: 'pending' as const }
                const affected = step.risk.roles.filter((id) => online.includes(id))
                return (
                  <li key={step.id} data-step={step.id} data-state={state.state}>
                    <span
                      className="wrx-publish-state"
                      aria-label={`Status: ${STATE_LABEL[state.state]}`}
                    >
                      {STATE_LABEL[state.state]}
                    </span>{' '}
                    <span>{step.summary}</span>
                    {step.risk.destructive && (
                      <span className="wrx-admin-tag wrx-publish-danger">Removes</span>
                    )}
                    {affected.length > 0 && (
                      <span className="wrx-admin-tag wrx-publish-online-tag">
                        Online: {affected.map((id) => roleLabel(plan, id)).join(', ')}
                      </span>
                    )}
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
              })}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function Result({
  plan,
  result,
  remaining,
  onPlan,
  onDismiss,
}: {
  readonly plan: PublishPlan
  readonly result: ExecutionResult
  readonly remaining: PublishPlan | undefined
  readonly onPlan: () => void
  readonly onDismiss: () => void
}) {
  const what = plan.kind === 'reset' ? 'Reset' : 'Publish'
  if (!result.ok) {
    return (
      <Notice tone="error" title={`${what} stopped at a failure.`}>
        <p>
          {plural(result.done.length, 'step')} done, 1 failed
          {result.failed === undefined
            ? ''
            : ` (${result.failed.stepId}: ${describeError(result.failed.error)})`}
          , {plural(result.notRun.length, 'step')} not run. Nothing after the failure was applied.
          Plan again to see what is left, and run it to complete the {what.toLowerCase()}.
        </p>
        <Button variant="primary" onClick={onPlan}>
          Plan the rest again
        </Button>
      </Notice>
    )
  }
  return (
    <div className="wrx-publish-result" role="status">
      <p>
        <strong>
          {what} complete: {plural(result.done.length, 'step')} applied
          {plan.designVersion === undefined ? '' : `, design version ${plan.designVersion}`}.
        </strong>
      </p>
      {remaining !== undefined && (
        <p>
          {remaining.steps.length === 0
            ? 'Checked again: nothing is left to publish.'
            : `Checked again: ${plural(remaining.steps.length, 'change')} still differ. Plan again.`}
        </p>
      )}
      <Button onClick={onDismiss}>Close</Button>
    </div>
  )
}

export interface CredentialsSheetProps {
  readonly design: DesignFile
  readonly published: readonly string[]
  readonly credentials: readonly Credential[]
  readonly busy: boolean
  readonly onReset: (roleId: string) => Promise<string | undefined>
  readonly print?: () => void
}

/**
 * ADM-26: role, force, login id and password, for the passwords issued in this browser session.
 * Generated on demand from memory, never stored; printed with print CSS that hides the rest of
 * the page.
 */
export function CredentialsSheet({
  design,
  published,
  credentials,
  busy,
  onReset,
  print,
}: CredentialsSheetProps) {
  const [shown, setShown] = useState(false)
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const roles = sortedRoles(design).filter((r) => published.includes(r.id))
  const passwordOf = new Map(credentials.map((c) => [c.roleId, c]))
  const forceName = (id: string) => design.forces.find((f) => f.id === id)?.name ?? id
  const anyDemo = credentials.some((c) => c.demo)
  return (
    <section className="wrx-publish-panel" aria-labelledby="wrx-publish-credentials">
      <h3 id="wrx-publish-credentials">Credentials</h3>
      <p>
        Passwords are shown only for accounts created or reset in this browser session, and are
        never stored. Print the sheet now; a reset issues a new one.
      </p>
      {roles.length === 0 ? (
        <p className="wrx-admin-muted">No role has been published yet.</p>
      ) : !shown ? (
        <Button
          onClick={() => {
            setShown(true)
          }}
        >
          Show the credentials sheet
        </Button>
      ) : (
        <div className="wrx-credentials-sheet">
          <h4>{design.game.name}: credentials</h4>
          {anyDemo && (
            <p className="wrx-credentials-demo">
              DEMO PASSWORDS: known, not secret. For the mock server only.
            </p>
          )}
          <table className="wrx-credentials-table">
            <caption className="wrx-admin-visually-hidden">Role credentials</caption>
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Force</th>
                <th scope="col">Login id</th>
                <th scope="col">Password</th>
                <th scope="col" className="wrx-print-hide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const credential = passwordOf.get(role.id)
                const error = errors.get(role.id)
                return (
                  <tr key={role.id}>
                    <th scope="row">{role.name}</th>
                    <td>{forceName(role.forceId)}</td>
                    <td>
                      <code>{role.id}</code>
                    </td>
                    <td>
                      {credential === undefined ? (
                        <span className="wrx-admin-muted">Not known here; reset to issue one</span>
                      ) : (
                        <>
                          <code className="wrx-credentials-password">{credential.password}</code>
                          {credential.demo && <span className="wrx-admin-tag"> demo</span>}
                        </>
                      )}
                    </td>
                    <td className="wrx-print-hide">
                      <Button
                        disabled={busy}
                        aria-label={`Reset the password of ${role.name}`}
                        onClick={() => {
                          void onReset(role.id).then((problem) => {
                            const next = new Map(errors)
                            if (problem === undefined) next.delete(role.id)
                            else next.set(role.id, problem)
                            setErrors(next)
                          })
                        }}
                      >
                        Reset password
                      </Button>
                      {error !== undefined && (
                        <span className="wrx-publish-error" role="alert">
                          {' '}
                          {error}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="wrx-print-hide wrx-publish-toolbar">
            <Button
              variant="primary"
              onClick={() => {
                if (print === undefined) window.print()
                else print()
              }}
            >
              Print
            </Button>
            <Button
              onClick={() => {
                setShown(false)
              }}
            >
              Hide
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function DesignTransfer({
  onExport,
  onImport,
}: {
  readonly onExport: () => void
  readonly onImport: (text: string) => readonly DesignIssue[]
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [outcome, setOutcome] = useState<
    | { readonly ok: boolean; readonly issues: readonly DesignIssue[]; readonly name: string }
    | undefined
  >()
  const [pending, setPending] = useState<
    { readonly name: string; readonly text: string } | undefined
  >()
  let body: ReactNode = null
  if (outcome !== undefined) {
    body = outcome.ok ? (
      <Notice title={`Imported ${outcome.name}.`}>
        The draft is replaced; publish to apply it.
        <IssueList issues={outcome.issues} />
      </Notice>
    ) : (
      <Notice tone="error" title={`${outcome.name} was not imported.`}>
        <IssueList issues={outcome.issues} />
      </Notice>
    )
  }
  return (
    <section className="wrx-publish-panel" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Export and import the design</h3>
      <p>
        A design file moves a game between the mock and a server, or between servers. It never holds
        passwords.
      </p>
      <div className="wrx-publish-toolbar">
        <Button onClick={onExport}>Export the design</Button>
        <label className="wrx-admin-button wrx-admin-button-secondary" htmlFor={id}>
          Import a design…
        </label>
        <input
          ref={input}
          id={id}
          className="wrx-admin-visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file === undefined) return
            void file.text().then((text) => {
              setOutcome(undefined)
              setPending({ name: file.name, text })
            })
            if (input.current !== null) input.current.value = ''
          }}
        />
      </div>
      {pending !== undefined && (
        <Notice tone="warning" title={`Replace the draft with ${pending.name}?`}>
          <p>The current draft is replaced. Nothing on the server changes until you publish.</p>
          <div className="wrx-publish-toolbar">
            <Button
              variant="primary"
              onClick={() => {
                const issues = onImport(pending.text)
                const ok = issues.every((i) => i.severity !== 'error')
                setOutcome({ ok, issues, name: pending.name })
                setPending(undefined)
              }}
            >
              Replace the draft
            </Button>
            <Button
              onClick={() => {
                setPending(undefined)
              }}
            >
              Cancel
            </Button>
          </div>
        </Notice>
      )}
      {body}
    </section>
  )
}
