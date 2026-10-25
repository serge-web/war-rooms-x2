// The audit screen's state (WP 2.10, ADM-41), framework-free: run the audit with progress, ask for
// the vault when the voice checks need it, repair the chosen items with per-item progress, then
// show the re-audit. `useAudit` reads it through `useSyncExternalStore`; `AuditSectionCore`
// draws a snapshot. The vault and the credentials sheet are the publish screen's (WP 2.3), so
// one unlock serves both and passwords a repair issues appear on the same sheet.
import { repairItems, runAudit } from '@wrx/admin-ops'
import type {
  AdminOps,
  AuditItem,
  AuditProgress,
  AuditReport,
  ObserverVault,
  RepairEvent,
  RepairResult,
} from '@wrx/admin-ops'
import type { DesignFile } from '@wrx/schemas'
import { describeError } from '../publish/controller.ts'

/** The publish screen's vault, which the audit borrows. */
export interface AuditVault {
  /** The unlocked vault, if it is open. */
  current(): ObserverVault | undefined
  /** Resolves with an error to show, or undefined once open. */
  unlock(passphrase: string): Promise<string | undefined>
}

export interface AuditControllerOptions {
  readonly ops: AdminOps
  readonly getDesign: () => DesignFile
  readonly vault: AuditVault
  /** A new password for an account a repair creates or resets; the host keeps it for the sheet. */
  readonly issuePassword: (roleId: string) => string
}

export interface AuditSnapshot {
  readonly busy: 'auditing' | 'repairing' | 'vault' | undefined
  readonly progress: AuditProgress | undefined
  /** The latest report: the first audit, or the re-audit after a repair. */
  readonly report: AuditReport | undefined
  /** The report a repair started from, while `report` is its re-audit. */
  readonly before: AuditReport | undefined
  /** Per-item progress of the last repair. */
  readonly repairs: ReadonlyMap<string, RepairEvent>
  readonly result: RepairResult | undefined
  readonly error: string | undefined
  /** The design the report compares with, so the UI can say when the draft changed since. */
  readonly auditedFrom: DesignFile | undefined
}

export const IDLE_AUDIT: AuditSnapshot = Object.freeze({
  busy: undefined,
  progress: undefined,
  report: undefined,
  before: undefined,
  repairs: new Map(),
  result: undefined,
  error: undefined,
  auditedFrom: undefined,
})

export class AuditController {
  private snapshot: AuditSnapshot = IDLE_AUDIT
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: AuditControllerOptions) {}

  readonly getSnapshot = (): AuditSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(patch: Partial<AuditSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  private auditOptions() {
    const vault = this.options.vault.current()
    return {
      ...(vault === undefined ? {} : { vault }),
      onProgress: (progress: AuditProgress) => {
        this.set({ progress })
      },
    }
  }

  /** Reads the server and compares it with the current design. */
  async run(): Promise<void> {
    if (this.snapshot.busy !== undefined) return
    const design = this.options.getDesign()
    this.set({ busy: 'auditing', error: undefined, progress: undefined })
    const audited = await runAudit(this.options.ops, design, this.auditOptions())
    if (!audited.ok) {
      this.set({
        busy: undefined,
        progress: undefined,
        error: `Reading the server failed: ${describeError(audited.error)}`,
      })
      return
    }
    this.set({
      busy: undefined,
      progress: undefined,
      report: audited.value.report,
      before: undefined,
      repairs: new Map(),
      result: undefined,
      auditedFrom: design,
    })
  }

  /** Opens the vault (the publish screen's), then audits again so the voice checks run. */
  async unlockVault(passphrase: string): Promise<string | undefined> {
    if (this.snapshot.busy !== undefined) return 'busy'
    this.set({ busy: 'vault' })
    const problem = await this.options.vault.unlock(passphrase)
    this.set({ busy: undefined })
    if (problem !== undefined) return problem
    await this.run()
    return undefined
  }

  /**
   * Repairs the given items of the current report; destructive ones only if listed in
   * `confirmed` (the UI ticks each). Then audits again.
   */
  async repair(itemIds: readonly string[], confirmed: readonly string[] = []): Promise<void> {
    const report = this.snapshot.report
    if (report === undefined || this.snapshot.busy !== undefined) return
    const wanted = new Set(itemIds)
    const items: AuditItem[] = report.items.filter((i) => wanted.has(i.id) && i.repairable)
    if (items.length === 0) return
    const repairs = new Map<string, RepairEvent>()
    this.set({ busy: 'repairing', error: undefined, repairs, result: undefined })
    const result = await repairItems(this.options.ops, items, {
      confirmed: new Set(confirmed),
      passwordFor: (roleId) => this.options.issuePassword(roleId),
      onItem: (event) => {
        repairs.set(event.itemId, event)
        this.set({ repairs: new Map(repairs) })
      },
    })
    const design = this.options.getDesign()
    this.set({ busy: 'auditing', result, progress: undefined })
    const after = await runAudit(this.options.ops, design, this.auditOptions())
    if (!after.ok) {
      this.set({
        busy: undefined,
        progress: undefined,
        error: `Reading the server back failed: ${describeError(after.error)}`,
      })
      return
    }
    this.set({
      busy: undefined,
      progress: undefined,
      before: report,
      report: after.value.report,
      auditedFrom: design,
    })
  }

  /** Clears the report. */
  dismiss(): void {
    this.set({ ...IDLE_AUDIT })
  }
}
