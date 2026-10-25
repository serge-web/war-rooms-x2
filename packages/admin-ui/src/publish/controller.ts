// The publish screen's state (WP 2.3), framework-free: plan the draft against the server, apply
// with per-step progress, reset, the vault, and per-role password resets. `usePublish` reads it
// through `useSyncExternalStore`; `PublishSectionCore` draws a snapshot.
import {
  CredentialsBook,
  ObserverVault,
  checkServer,
  demoRolePassword,
  executePlan,
  knownRoles,
  preparePublish,
  prepareReset,
  targetState,
} from '@wrx/admin-ops'
import type {
  AdminOps,
  AdminOpsError,
  Credential,
  ExecutionResult,
  MarkerStore,
  PublishPlan,
  ServerCheck,
  StepState,
} from '@wrx/admin-ops'
import type { Draft } from '../draft/index.ts'
import { markPublished, markRolesPublished } from '../draft/index.ts'

/** How the admin UI reaches the server; the host builds it after the admin logs in. */
export interface PublishConnection {
  readonly ops: AdminOps
  /** `mock` issues the known demo passwords, labelled as such (NFR-6); `xmpp` random ones. */
  readonly kind: 'mock' | 'xmpp'
  /** Where the publish marker is kept: the admin's private storage (`privateMarkerStore`). */
  readonly marker?: MarkerStore
  /** PBKDF2 iterations for a new vault. Default: the vault's own default. */
  readonly vaultIterations?: number
  /**
   * The mock demo seed's vault passphrase, shown next to the unlock form as a DEMO passphrase
   * (NFR-6). Only for `mock`; the host leaves it out of a real-server build.
   */
  readonly demoVaultPassphrase?: string
}

export type VaultState = 'unknown' | 'none' | 'locked' | 'unlocked'

export interface StepProgress {
  readonly state: StepState
  readonly error?: AdminOpsError
  readonly note?: string
}

export interface PublishSnapshot {
  /** What is running, if anything. */
  readonly busy: 'planning' | 'running' | 'vault' | 'password' | undefined
  /** The plan shown, publish or reset. */
  readonly plan: PublishPlan | undefined
  readonly checks: readonly ServerCheck[]
  readonly progress: ReadonlyMap<string, StepProgress>
  /** The last run of `plan`. */
  readonly result: ExecutionResult | undefined
  /** After a successful run: a fresh plan of the draft, empty when nothing is left (ADM-10). */
  readonly remaining: PublishPlan | undefined
  /** A failure outside a step: reading the server, the vault. */
  readonly error: string | undefined
  readonly vault: VaultState
  readonly credentials: readonly Credential[]
  /** Role ids online at the last read (ADM-17). */
  readonly online: readonly string[]
  /** The draft version the plan was made from, so the UI can say it is out of date. */
  readonly plannedFrom: Draft | undefined
}

export interface PublishControllerOptions {
  readonly connection: PublishConnection
  readonly getDraft: () => Draft
  readonly commit: (next: Draft) => void
  readonly now?: () => Date
}

const INITIAL: PublishSnapshot = Object.freeze({
  busy: undefined,
  plan: undefined,
  checks: [],
  progress: new Map(),
  result: undefined,
  remaining: undefined,
  error: undefined,
  vault: 'unknown',
  credentials: [],
  online: [],
  plannedFrom: undefined,
})

export function describeError(error: AdminOpsError): string {
  const where = [error.step, error.target].filter((s) => s !== undefined).join(' ')
  const cause = error.cause === undefined ? '' : ` (${error.cause.condition})`
  return `${error.message}${where === '' ? '' : `, at ${where}`}${cause}`
}

export class PublishController {
  private snapshot: PublishSnapshot = INITIAL
  private readonly listeners = new Set<() => void>()
  private vault: ObserverVault | undefined
  readonly book: CredentialsBook
  private readonly connection: PublishConnection
  private readonly getDraft: () => Draft
  private readonly commit: (next: Draft) => void
  private readonly now: () => Date

  constructor(options: PublishControllerOptions) {
    this.connection = options.connection
    this.getDraft = options.getDraft
    this.commit = options.commit
    this.now = options.now ?? (() => new Date())
    this.book = new CredentialsBook(this.connection.kind === 'mock' ? 'demo' : 'random', this.now)
    this.book.subscribe(() => {
      this.set({ credentials: this.book.list() })
    })
    this.knowDemoPasswords(this.getDraft().meta.publishedRoleIds)
  }

  /**
   * On the mock every role's password is its known demo password (NFR-6): the tooling issues no
   * other there, and the demo seed starts with them. So the sheet shows them for published roles
   * without a reset. Nothing on a real server.
   */
  private knowDemoPasswords(roleIds: readonly string[]): void {
    if (this.connection.kind !== 'mock') return
    for (const roleId of roleIds) {
      if (this.book.get(roleId) !== undefined) continue
      this.book.restore({
        roleId,
        password: demoRolePassword(roleId),
        demo: true,
        issuedAt: this.now(),
      })
    }
  }

  readonly getSnapshot = (): PublishSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(patch: Partial<PublishSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  private viewOptions() {
    return {
      ...(this.vault === undefined ? {} : { vault: this.vault }),
      ...(this.connection.marker === undefined ? {} : { marker: this.connection.marker }),
    }
  }

  /** Reads the server and plans publishing the current draft (ADM-10), with the checks (NFR-4). */
  async plan(): Promise<void> {
    await this.prepare('publish')
  }

  /** Reads the server and plans a reset (ADM-15). */
  async planReset(): Promise<void> {
    await this.prepare('reset')
  }

  private async prepare(kind: 'publish' | 'reset'): Promise<void> {
    if (this.snapshot.busy !== undefined) return
    const draft = this.getDraft()
    this.set({ busy: 'planning', error: undefined })
    const ops = this.connection.ops
    const prepared =
      kind === 'publish'
        ? await preparePublish(ops, draft.design, this.viewOptions())
        : await prepareReset(ops, this.viewOptions())
    if (!prepared.ok) {
      this.set({
        busy: undefined,
        error: `Reading the server failed: ${describeError(prepared.error)}`,
      })
      return
    }
    const checks = kind === 'publish' ? await checkServer(ops, prepared.value.view) : []
    const { view, plan } = prepared.value
    let planned = draft
    if (kind === 'publish') {
      // Roles the server already has are published, whichever browser published them (or the
      // mock's demo seed): their login ids are fixed (ADM-5) and the sheet lists them.
      planned = markRolesPublished(draft, knownRoles(view))
      if (planned !== draft) this.commit(planned)
      this.knowDemoPasswords(planned.meta.publishedRoleIds)
    }
    this.set({
      busy: undefined,
      plan,
      checks,
      progress: new Map(plan.steps.map((s) => [s.id, { state: 'pending' }])),
      result: undefined,
      remaining: undefined,
      online: view.online,
      vault: !view.vault.exists ? 'none' : this.vault?.unlocked === true ? 'unlocked' : 'locked',
      plannedFrom: planned,
    })
  }

  /** Runs the plan shown; the UI confirms first. Stops at the first failure (ADM-11). */
  async apply(): Promise<void> {
    const plan = this.snapshot.plan
    if (plan === undefined || this.snapshot.busy !== undefined) return
    if (plan.vault === 'create' || plan.vault === 'unlock') {
      this.set({ error: 'Unlock or create the vault first, then plan again.' })
      return
    }
    const progress = new Map(this.snapshot.progress)
    this.set({
      busy: 'running',
      error: undefined,
      result: undefined,
      remaining: undefined,
      progress,
    })
    const result = await executePlan(this.connection.ops, plan, {
      passwordFor: (roleId) => this.book.passwordFor(roleId),
      now: this.now,
      ...(this.connection.marker === undefined ? {} : { marker: this.connection.marker }),
      onStep: (event) => {
        progress.set(event.stepId, {
          state: event.state,
          ...(event.error === undefined ? {} : { error: event.error }),
          ...(event.note === undefined ? {} : { note: event.note }),
        })
        this.set({ progress: new Map(progress) })
      },
    })
    for (const id of result.notRun) progress.set(id, { state: 'not-run' })
    this.set({ busy: undefined, result, progress: new Map(progress) })
    if (!result.ok) return
    const draft = this.getDraft()
    if (plan.kind === 'publish') {
      // The draft now matches the server: its roles' login ids are fixed (ADM-5), and it carries
      // the published version, so the next change is published as the one after it.
      const version = plan.designVersion ?? draft.design.game.designVersion
      this.commit(
        markPublished({
          ...draft,
          design: { ...draft.design, game: { ...draft.design.game, designVersion: version } },
        }),
      )
    } else {
      // After a reset the next publish starts a new design version, so saved layouts of the old
      // game are not reused (PLY-5). Ids stay retired (§3 rule 1).
      const version = Math.max(plan.publishedVersion ?? 0, draft.design.game.designVersion) + 1
      this.commit({
        ...draft,
        design: { ...draft.design, game: { ...draft.design.game, designVersion: version } },
      })
    }
    // Read back (NFR-4, ADM-10): the checks again, now that the rooms exist, and what is left
    // to publish, which is nothing after a complete publish.
    const after = await preparePublish(
      this.connection.ops,
      this.getDraft().design,
      this.viewOptions(),
    )
    if (!after.ok) {
      this.set({ error: `Reading the server back failed: ${describeError(after.error)}` })
      return
    }
    this.set({
      checks: await checkServer(this.connection.ops, after.value.view),
      remaining: after.value.plan,
      online: after.value.view.online,
    })
  }

  /** Clears the plan and result shown. */
  dismiss(): void {
    this.set({
      plan: undefined,
      result: undefined,
      remaining: undefined,
      progress: new Map(),
      error: undefined,
    })
  }

  async createVault(passphrase: string): Promise<string | undefined> {
    return this.withVault(() =>
      ObserverVault.create(
        this.connection.ops.session.admin,
        passphrase,
        this.connection.vaultIterations === undefined
          ? {}
          : { iterations: this.connection.vaultIterations },
      ),
    )
  }

  async unlockVault(passphrase: string): Promise<string | undefined> {
    return this.withVault(() => ObserverVault.unlock(this.connection.ops.session.admin, passphrase))
  }

  /** Resolves with an error message, or undefined once the vault is open and the plan redone. */
  private async withVault(
    open: () => ReturnType<typeof ObserverVault.unlock>,
  ): Promise<string | undefined> {
    if (this.snapshot.busy !== undefined) return 'busy'
    this.set({ busy: 'vault' })
    const opened = await open()
    if (!opened.ok) {
      this.set({ busy: undefined })
      return vaultMessage(opened.error)
    }
    this.vault?.lock()
    this.vault = opened.value
    this.connection.ops.useVault(opened.value)
    this.set({ busy: undefined, vault: 'unlocked' })
    const kind = this.snapshot.plan?.kind
    if (kind !== undefined) await this.prepare(kind)
    return undefined
  }

  /** The vault, while it is unlocked here; the audit (WP 2.10) checks voice with it. */
  currentVault(): ObserverVault | undefined {
    return this.vault?.unlocked === true ? this.vault : undefined
  }

  /** Drops the vault's key and passwords from memory. */
  lockVault(): void {
    this.vault?.lock()
    this.vault = undefined
    this.connection.ops.useVault(undefined)
    this.set({ vault: this.snapshot.vault === 'unknown' ? 'unknown' : 'locked' })
  }

  /**
   * ADM-26: a new password for one role, set on the server and, for a read-only role, in the
   * vault. Resolves with an error message, or undefined.
   */
  async resetPassword(roleId: string): Promise<string | undefined> {
    if (this.snapshot.busy !== undefined) return 'busy'
    const readOnly =
      targetState(this.getDraft().design).readOnlyRoles.includes(roleId) ||
      this.vault?.has(roleId) === true
    this.set({ busy: 'password' })
    const previous = this.book.get(roleId)
    const password = this.book.issue(roleId)
    const done = await this.connection.ops.setPassword(roleId, password, { readOnly })
    this.set({ busy: undefined })
    if (done.ok) return undefined
    // The server kept the old password: so does the sheet.
    if (previous === undefined) this.book.forget(roleId)
    else this.book.restore(previous)
    return done.error.code === 'vault-locked'
      ? 'Unlock the vault first: it must keep this password.'
      : describeError(done.error)
  }

  /** Forgets every password and the vault key (logout, or the admin app unmounting). */
  dispose(): void {
    this.lockVault()
    this.book.clear()
  }
}

function vaultMessage(error: AdminOpsError): string {
  switch (error.code) {
    case 'wrong-passphrase':
      return 'That passphrase does not open the vault.'
    case 'weak-passphrase':
      return error.message
    case 'vault-exists':
      return 'A vault already exists: unlock it instead.'
    case 'vault-not-found':
      return 'No vault exists yet: create one.'
    default:
      return describeError(error)
  }
}
