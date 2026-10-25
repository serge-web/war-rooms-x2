// The Audit section (WP 2.10, ADM-41, ADM-42): run the audit with progress, unlock the vault when
// the voice checks need it, list the differences by severity, repair the selected ones (or all),
// confirming each destructive one, and show the re-audit.
//
// `AuditSectionCore` draws plain props; `AuditSection` wires an `AuditController`. Internal: it
// describes access-control weaknesses, so nothing here is for the public site (DOC-2).
import { AUDIT_SEVERITIES, findings } from '@wrx/admin-ops'
import type {
  AuditItem,
  AuditKind,
  AuditProgress,
  AuditReport,
  AuditSeverity,
  RepairEvent,
  RepairResult,
} from '@wrx/admin-ops'
import type { DesignFile } from '@wrx/schemas'
import { useId, useState } from 'react'
import { Button, Notice, SectionFrame } from '../components/index.ts'
import { describeError } from '../publish/controller.ts'
import { ApplyDialog, VaultDialog } from '../publish/dialogs.tsx'
import type { Acknowledgement } from '../publish/dialogs.tsx'
import type { AuditSnapshot } from './controller.ts'
import type { useAudit } from './useAudit.ts'
import './audit.css'

const SEVERITY_LABEL: Readonly<Record<AuditSeverity, string>> = Object.freeze({
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Information',
})

const KIND_LABEL: Readonly<Record<AuditKind, string>> = Object.freeze({
  'room-missing': 'Missing room',
  'room-config': 'Room settings',
  'room-extra': 'Room not in the design',
  'room-access': 'Room access',
  voice: 'Voice',
  'voice-unchecked': 'Voice not checked',
  'writers-unchecked': 'Writers’ voice not checked',
  'node-missing': 'Missing node',
  'node-config': 'Node settings',
  'node-extra': 'Node not in the design',
  'node-access': 'Node access',
  subscription: 'Leftover subscription',
  'foreign-access': 'Access for an unknown JID',
  'account-missing': 'Missing account',
  'account-unknown': 'Account with no role',
  'stray-access': 'Leftovers of a deleted role',
  document: 'Document',
  'design-version': 'Design version',
  'node-names-public': 'Node names are public',
})

const PHASE_LABEL: Readonly<Record<AuditProgress['phase'], string>> = Object.freeze({
  server: 'Reading rooms, nodes and documents',
  accounts: 'Listing accounts',
  counts: 'Counting messages in rooms not in the design',
  voice: 'Checking voice through each read-only role’s login',
})

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function title(item: AuditItem): string {
  const role = item.roleId !== undefined && item.roleId !== item.target ? ` (${item.roleId})` : ''
  return `${KIND_LABEL[item.kind]}: ${item.target}${role}`
}

/** What the admin ticks to confirm a destructive repair (ADM-14, ADM-40, ADM-26). */
function acknowledgement(item: AuditItem): Acknowledgement {
  const label =
    item.kind === 'account-unknown'
      ? `Delete the account ${item.target} and remove its access`
      : item.kind === 'room-extra'
        ? `Destroy room ${item.target} and its archived messages (${item.found})`
        : item.kind === 'node-extra'
          ? `Delete node ${item.target} and its items`
          : item.repair.some((a) => a.type === 'reset-password')
            ? `Reset the password of ${item.roleId ?? item.target}: its players need the new one`
            : `${title(item)}: ${item.note ?? 'this cannot be undone'}`
  return { id: item.id, label }
}

export interface AuditSectionProps {
  /** From `useAudit`, held by the admin app so a report outlives the section. */
  readonly audit: ReturnType<typeof useAudit>
  readonly design: DesignFile
}

export function AuditSection({ audit, design }: AuditSectionProps) {
  const { snapshot, controller } = audit
  const notConnected = () => Promise.resolve('Not connected to a server.')
  return (
    <AuditSectionCore
      connected={controller !== undefined}
      design={design}
      snapshot={snapshot}
      onRun={() => void controller?.run()}
      onUnlockVault={(p) => controller?.unlockVault(p) ?? notConnected()}
      onRepair={(ids, confirmed) => void controller?.repair(ids, confirmed)}
      onDismiss={() => controller?.dismiss()}
    />
  )
}

export interface AuditSectionCoreProps {
  readonly connected: boolean
  /** The design being edited, to say when it changed since the audit. */
  readonly design: DesignFile
  readonly snapshot: AuditSnapshot
  readonly onRun: () => void
  readonly onUnlockVault: (passphrase: string) => Promise<string | undefined>
  /** Repairs these items; destructive ones only if in `confirmed`. */
  readonly onRepair: (itemIds: readonly string[], confirmed: readonly string[]) => void
  readonly onDismiss: () => void
}

export function AuditSectionCore(props: AuditSectionCoreProps) {
  const { connected, snapshot, design } = props
  const { report, busy } = snapshot
  const stale =
    report !== undefined && snapshot.auditedFrom !== undefined && snapshot.auditedFrom !== design
  return (
    <SectionFrame
      title="Audit"
      intro={
        <p className="wrx-admin-muted">
          The audit compares the live server with this design: room settings and access, observer
          voice, node settings and access, subscriptions, accounts and documents. It changes nothing
          until you repair. Edits to the draft that are not published yet show up as differences.
        </p>
      }
    >
      {!connected ? (
        <Notice tone="warning" title="Not connected to a server.">
          Log in as the admin to audit the server.
        </Notice>
      ) : (
        <>
          <div className="wrx-publish-toolbar">
            <Button variant="primary" disabled={busy !== undefined} onClick={props.onRun}>
              {report === undefined ? 'Run the audit' : 'Audit again'}
            </Button>
            {report !== undefined && busy === undefined && (
              <Button variant="quiet" onClick={props.onDismiss}>
                Clear
              </Button>
            )}
            <Busy snapshot={snapshot} />
          </div>
          {snapshot.error !== undefined && <Notice tone="error">{snapshot.error}</Notice>}
          {stale && (
            <Notice tone="warning" title="The draft changed since this audit.">
              Audit again to compare with it.
            </Notice>
          )}
          {report !== undefined && (
            <>
              <VaultNotice
                report={report}
                busy={busy !== undefined}
                onUnlock={props.onUnlockVault}
              />
              {snapshot.result !== undefined && (
                <RepairSummary result={snapshot.result} before={snapshot.before} after={report} />
              )}
              <Report {...props} report={report} />
            </>
          )}
        </>
      )}
    </SectionFrame>
  )
}

function Busy({ snapshot }: { readonly snapshot: AuditSnapshot }) {
  const { busy, progress } = snapshot
  if (busy === undefined) return null
  let text: string
  if (busy === 'vault') text = 'Opening the vault…'
  else if (busy === 'repairing') {
    const done = [...snapshot.repairs.values()].filter((e) => e.state !== 'running').length
    text = `Repairing… ${done} done`
  } else if (progress === undefined) text = 'Reading the server…'
  else {
    const count = progress.total > 1 ? ` (${progress.done + 1} of ${progress.total})` : ''
    const target = progress.target === undefined ? '' : `: ${progress.target}`
    text = `${PHASE_LABEL[progress.phase]}${count}${target}…`
  }
  return (
    <span className="wrx-admin-muted" role="status">
      {text}
    </span>
  )
}

function VaultNotice({
  report,
  busy,
  onUnlock,
}: {
  readonly report: AuditReport
  readonly busy: boolean
  readonly onUnlock: (passphrase: string) => Promise<string | undefined>
}) {
  if (report.vault === 'locked') {
    return (
      <Notice tone="warning" title="Unlock the vault to check observer voice.">
        No admin command shows whether a read-only role is still read-only, so the audit logs in as
        each one with its password from the vault and reads the role the room gives it.{' '}
        <VaultDialog mode="unlock" busy={busy} onSubmit={onUnlock} />
      </Notice>
    )
  }
  if (report.vault === 'missing') {
    return (
      <Notice tone="warning" title="No vault.">
        Read-only roles cannot be checked or made read-only without the vault. Create it in Publish.
      </Notice>
    )
  }
  if (report.vault === 'unlocked' && report.voiceChecked > 0) {
    return (
      <p className="wrx-admin-muted">
        Voice checked through {plural(report.voiceChecked, 'role login')} (role and room pairs).
      </p>
    )
  }
  return null
}

function RepairSummary({
  result,
  before,
  after,
}: {
  readonly result: RepairResult
  readonly before: AuditReport | undefined
  readonly after: AuditReport
}) {
  const left = findings(after).length
  return (
    <section className="wrx-publish-panel" aria-labelledby="wrx-audit-result">
      <h3 id="wrx-audit-result">Repair</h3>
      <p role="status">
        {result.ok
          ? `Repaired ${plural(result.done.length, 'difference')}.`
          : `Repaired ${result.done.length}; ${result.failed.length} failed.`}{' '}
        {left === 0
          ? 'Audited again: the server matches the design.'
          : `Audited again: ${plural(left, 'difference')} left${
              before === undefined ? '' : ` of ${findings(before).length}`
            }.`}
      </p>
      {result.failed.length > 0 && (
        <ul className="wrx-publish-details">
          {result.failed.map((f) => (
            <li key={f.itemId} className="wrx-publish-error">
              {f.itemId}: {describeError(f.error)}
            </li>
          ))}
        </ul>
      )}
      {result.passwordsSet.length > 0 && (
        <Notice title="New passwords.">
          {result.passwordsSet.join(', ')}: see the credentials sheet in Publish, and give each
          role’s players its new password.
        </Notice>
      )}
    </section>
  )
}

function Report(props: AuditSectionCoreProps & { readonly report: AuditReport }) {
  const { report, snapshot } = props
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const items = report.items
  const repairable = items.filter((i) => i.repairable)
  const live = new Set(items.map((i) => i.id))
  const chosen = repairable.filter((i) => selected.has(i.id) && live.has(i.id))
  const busy = snapshot.busy !== undefined
  const count = findings(report).length
  const bySeverity = AUDIT_SEVERITIES.map(
    (s) => [s, items.filter((i) => i.severity === s)] as const,
  )
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }
  const repair = (list: readonly AuditItem[]) => {
    props.onRepair(
      list.map((i) => i.id),
      list.filter((i) => i.destructive).map((i) => i.id),
    )
    setSelected(new Set())
  }
  return (
    <section className="wrx-publish-panel" aria-label="Audit report">
      <h3>Report</h3>
      <p role="status">
        {count === 0
          ? 'No differences: the server matches the design.'
          : `${plural(count, 'difference')}: ${bySeverity
              .filter(([s, list]) => s !== 'info' && list.length > 0)
              .map(([s, list]) => `${list.length} ${SEVERITY_LABEL[s].toLowerCase()}`)
              .join(', ')}.`}
      </p>
      {repairable.length > 0 && (
        <div className="wrx-publish-toolbar">
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => {
              setSelected(new Set(repairable.map((i) => i.id)))
            }}
          >
            Select all repairable
          </Button>
          <RepairDialog
            label={`Repair selected (${chosen.length})…`}
            items={chosen}
            online={report.online}
            disabled={busy || chosen.length === 0}
            onConfirm={() => {
              repair(chosen)
            }}
          />
          <RepairDialog
            label={`Repair all (${repairable.length})…`}
            items={repairable}
            online={report.online}
            disabled={busy}
            onConfirm={() => {
              repair(repairable)
            }}
          />
        </div>
      )}
      {bySeverity.map(([severity, list]) =>
        list.length === 0 ? null : (
          <SeverityGroup
            key={severity}
            severity={severity}
            items={list}
            selected={selected}
            repairs={snapshot.repairs}
            disabled={busy}
            onToggle={toggle}
          />
        ),
      )}
    </section>
  )
}

function RepairDialog({
  label,
  items,
  online,
  disabled,
  onConfirm,
}: {
  readonly label: string
  readonly items: readonly AuditItem[]
  /** Role ids online at the audit (ADM-17). */
  readonly online: readonly string[]
  readonly disabled: boolean
  readonly onConfirm: () => void
}) {
  const destructive = items.filter((i) => i.destructive)
  const affected = [...new Set(items.flatMap((i) => (i.roleId === undefined ? [] : [i.roleId])))]
    .filter((id) => online.includes(id))
    .sort()
  return (
    <ApplyDialog
      triggerLabel={label}
      triggerDisabled={disabled}
      title="Repair these differences?"
      acknowledgements={destructive.map(acknowledgement)}
      confirmLabel="Repair"
      onConfirm={onConfirm}
    >
      <p>
        {plural(items.length, 'difference')} will be repaired through the admin tooling, then the
        server is audited again.
        {destructive.length > 0 &&
          ` ${plural(destructive.length, 'repair')} cannot be undone: confirm each below.`}
      </p>
      {affected.length > 0 && (
        <p>
          Online now, and affected: {affected.join(', ')}. A role that loses access to a room leaves
          it at once.
        </p>
      )}
      <ul className="wrx-publish-details">
        {items.map((i) => (
          <li key={i.id}>{title(i)}</li>
        ))}
      </ul>
    </ApplyDialog>
  )
}

const STATE_LABEL: Readonly<Record<RepairEvent['state'], string>> = Object.freeze({
  running: 'Repairing',
  done: 'Repaired',
  failed: 'Failed',
  skipped: 'Skipped',
})

function SeverityGroup({
  severity,
  items,
  selected,
  repairs,
  disabled,
  onToggle,
}: {
  readonly severity: AuditSeverity
  readonly items: readonly AuditItem[]
  readonly selected: ReadonlySet<string>
  readonly repairs: ReadonlyMap<string, RepairEvent>
  readonly disabled: boolean
  readonly onToggle: (id: string, on: boolean) => void
}) {
  const id = useId()
  return (
    <section className="wrx-audit-group" data-severity={severity} aria-labelledby={id}>
      <h4 id={id}>
        {SEVERITY_LABEL[severity]} ({items.length})
      </h4>
      <ul className="wrx-audit-items">
        {items.map((item) => {
          const repair = repairs.get(item.id)
          const box = `${id}-${item.id}`
          return (
            <li key={item.id} data-kind={item.kind} data-state={repair?.state}>
              <div className="wrx-audit-item-head">
                {item.repairable ? (
                  <input
                    id={box}
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={disabled}
                    onChange={(e) => {
                      onToggle(item.id, e.target.checked)
                    }}
                  />
                ) : null}
                <label htmlFor={item.repairable ? box : undefined}>
                  <strong>{title(item)}</strong>
                </label>
                {item.destructive && (
                  <span className="wrx-admin-tag wrx-publish-danger">Cannot be undone</span>
                )}
                {!item.repairable && item.severity !== 'info' && (
                  <span className="wrx-admin-tag">Not repairable here</span>
                )}
                {repair !== undefined && (
                  <span className="wrx-publish-state">{STATE_LABEL[repair.state]}</span>
                )}
              </div>
              <dl className="wrx-audit-diff">
                <dt>Expected</dt>
                <dd>{item.expected}</dd>
                <dt>Found</dt>
                <dd>{item.found}</dd>
              </dl>
              {item.note !== undefined && <p className="wrx-publish-details">{item.note}</p>}
              {repair?.error !== undefined && (
                <p className="wrx-publish-error">{describeError(repair.error)}</p>
              )}
              {repair?.state === 'skipped' && repair.note !== undefined && (
                <p className="wrx-publish-details">Skipped: {repair.note}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
