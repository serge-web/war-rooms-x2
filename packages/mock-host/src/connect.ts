// connectMockTransport (WP 1.5): the mock Transport for the app (D14, D17, PLY-20, PLY-22). Every
// tab and window of a deployment shares one mock server, which survives reloads and is kept
// apart from other deployments on the same origin (DOC-10). It never fails to load (DOC-17):
// whatever goes wrong with storage or sharing, the app gets a working mock and a notice.
import { MockTransport, demoState } from '@wrx/mock-server'
import type { MockState, MockTransportOptions } from '@wrx/mock-server'
import type { Result } from '@wrx/schemas'
import type { ConnectOptions, Outcome, Session, Transport, Unsubscribe } from '@wrx/transport'
import { LeaderBackend, LocalBackend, WorkerBackend } from './backends.ts'
import type { Backend, BackendEvents, HostingMode, TabContext } from './backends.ts'
import { browserEnvironment } from './env.ts'
import type { HostEnvironment } from './env.ts'
import type { StateMigrations } from './migrate.ts'
import { basePathOf, hostNames, mockNamespace } from './namespace.ts'
import type { HostNames } from './namespace.ts'
import { ConnectionTable } from './relay.ts'
import type { Log, MockNotice } from './wire.ts'

export type HostingPreference = 'auto' | HostingMode

export interface MockHostOptions {
  /**
   * The deployment's base path, e.g. `/war-rooms-x2/pr/12/app/` (DOC-10). Default: the folder of
   * `document.baseURI`. With Vite's relative `base: './'`, `import.meta.env.BASE_URL` is `./`,
   * so the page URL is the reliable source.
   */
  readonly basePath?: string
  /** Overrides the namespace made from the base path. */
  readonly namespace?: string
  /** Where the mock starts when nothing usable is stored; reset returns here. Default: demo. */
  readonly seed?: MockState
  /**
   * How to share the server. `auto` (default) uses a SharedWorker where the browser has one,
   * else a leader tab, else this tab alone. Naming a mode forces it where available, e.g.
   * `leader` to exercise the fallback. A localStorage value under `names.storageKey('hosting')`
   * overrides `auto`, for diagnosing a browser.
   */
  readonly hosting?: HostingPreference
  /** Notices for the person using the app (DOC-17); also listed by `notices()`. */
  readonly onNotice?: (notice: MockNotice) => void
  /** Dropped messages and host failures. Default: console.warn. */
  readonly log?: Log
  /** Delay before saving after a change (ms). Default 0: as soon as possible. */
  readonly saveDelayMs?: number
  /** connectMockTransport resolves after this long even if no host has answered. Default 10 s. */
  readonly readyTimeoutMs?: number
  /** Reset, export and import give up after this long. Default 30 s. */
  readonly controlTimeoutMs?: number
  /** Stored-state migrations. Default: MOCK_STATE_MIGRATIONS. */
  readonly migrations?: StateMigrations
  /** Passed to MockTransport: timeouts, reconnection, simulated network. */
  readonly transport?: MockTransportOptions
  /** Browser APIs; tests pass stand-ins. Default: the real ones. */
  readonly environment?: HostEnvironment
}

const HOSTING_MODES: readonly HostingMode[] = Object.freeze(['shared-worker', 'leader', 'local'])

function isHostingMode(value: unknown): value is HostingMode {
  return typeof value === 'string' && (HOSTING_MODES as readonly string[]).includes(value)
}

const defaultLog: Log = (entry) => {
  console.warn(entry.message, entry.detail)
}

/** The mock Transport shared by every tab of the deployment, with the database controls. */
export class MockHost implements Transport {
  readonly kind = 'mock'
  readonly names: HostNames
  /** This tab's id among the deployment's tabs. */
  readonly tab: string
  private readonly table = new ConnectionTable()
  private readonly transport: MockTransport
  private readonly env: HostEnvironment
  private readonly log: Log
  private readonly seed: MockState
  private backend: Backend | undefined
  private readonly received: MockNotice[] = []
  private readonly startupSeen = new Set<string>()
  private readonly listeners = new Set<(notice: MockNotice) => void>()
  private markReady: (() => void) | undefined
  private readonly whenReady: Promise<void>
  private releaseTabLock: (() => void) | undefined
  private stopPageHide: (() => void) | undefined

  private constructor(private readonly options: MockHostOptions) {
    this.env = options.environment ?? browserEnvironment()
    this.log = options.log ?? defaultLog
    this.seed = options.seed ?? demoState()
    const namespace =
      options.namespace ?? mockNamespace(options.basePath ?? basePathOf(this.env.baseURI))
    this.names = hostNames(namespace)
    this.tab = this.env.randomId()
    this.transport = new MockTransport(this.table, options.transport)
    if (options.onNotice !== undefined) this.listeners.add(options.onNotice)
    this.whenReady = new Promise((resolve) => {
      this.markReady = resolve
    })
  }

  /** Starts hosting; resolves once a host answers, or after `readyTimeoutMs`. Never rejects. */
  static async create(options: MockHostOptions = {}): Promise<MockHost> {
    const host = new MockHost(options)
    await host.start()
    return host
  }

  private async start(): Promise<void> {
    await this.holdTabLock()
    this.stopPageHide = this.env.onPageHide(() => {
      this.backend?.pageHide()
    })
    this.use(this.chooseMode())
    const timeout = this.options.readyTimeoutMs ?? 10_000
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.whenReady,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.log({ level: 'warn', message: `mock host: no host answered in ${timeout} ms` })
          resolve()
        }, timeout)
      }),
    ])
    clearTimeout(timer)
  }

  /** Holds this tab's lock while it is open, so the host can tell when the tab has gone. */
  private async holdTabLock(): Promise<void> {
    const locks = this.env.locks
    if (locks === undefined) return
    await new Promise<void>((acquired) => {
      // The name is this tab's own, so the lock comes at once; never wait long for it.
      setTimeout(acquired, 1_000)
      locks
        .request(this.names.tabLock(this.tab), {}, () => {
          acquired()
          return new Promise<void>((release) => {
            this.releaseTabLock = release
          })
        })
        .catch((error: unknown) => {
          this.log({ level: 'warn', message: 'mock host: no tab lock', detail: error })
          acquired()
        })
    })
  }

  private chooseMode(): HostingMode {
    const { env } = this
    let wanted = this.options.hosting ?? 'auto'
    if (wanted === 'auto') {
      let stored: string | null = null
      try {
        stored = env.storage?.getItem(this.names.storageKey('hosting')) ?? null
      } catch {
        // Storage blocked: no override.
      }
      if (isHostingMode(stored)) wanted = stored
    }
    const canWorker = env.startWorker !== undefined
    const canLeader = env.locks !== undefined && env.openChannel !== undefined
    if (wanted === 'shared-worker' && canWorker) return 'shared-worker'
    if (wanted === 'auto' && canWorker) return 'shared-worker'
    if (wanted !== 'local' && canLeader) return 'leader'
    if (wanted !== 'local') {
      this.notify({
        kind: 'not-shared',
        reason: 'no SharedWorker, and no Web Locks or BroadcastChannel',
        text: 'This browser cannot share the mock between tabs: each tab has its own game.',
      })
    }
    return 'local'
  }

  private context(): TabContext {
    const events: BackendEvents = {
      ready: (notices) => {
        for (const notice of notices) {
          const key = JSON.stringify(notice)
          if (this.startupSeen.has(key)) continue
          this.startupSeen.add(key)
          this.notify(notice)
        }
        this.markReady?.()
      },
      notice: (notice) => {
        this.notify(notice)
      },
      failed: (reason) => {
        this.fallBack(reason)
      },
    }
    return {
      tab: this.tab,
      names: this.names,
      table: this.table,
      seed: this.seed,
      log: this.log,
      events,
      openStore: this.env.openStore,
      saveDelayMs: this.options.saveDelayMs,
      migrations: this.options.migrations,
      controlTimeoutMs: this.options.controlTimeoutMs ?? 30_000,
    }
  }

  private use(mode: HostingMode): void {
    const { env } = this
    const ctx = this.context()
    if (mode === 'shared-worker' && env.startWorker !== undefined) {
      try {
        const backend = new WorkerBackend(ctx, env.startWorker(this.names.worker))
        this.backend = backend
        backend.start()
        return
      } catch (error) {
        this.log({ level: 'error', message: 'mock host: cannot start SharedWorker', detail: error })
        mode = 'leader'
      }
    }
    if (mode !== 'local' && env.locks !== undefined && env.openChannel !== undefined) {
      const backend = new LeaderBackend(ctx, env.locks, env.openChannel)
      this.backend = backend
      backend.start()
      return
    }
    const backend = new LocalBackend(ctx)
    this.backend = backend
    void backend.start()
  }

  /** The SharedWorker failed: elect a leader tab instead. */
  private fallBack(reason: string): void {
    if (this.backend?.mode !== 'shared-worker') return
    this.log({ level: 'warn', message: 'mock host: falling back to a leader tab', detail: reason })
    this.use('leader')
  }

  private notify(notice: MockNotice): void {
    this.received.push(notice)
    for (const listener of [...this.listeners]) {
      try {
        listener(notice)
      } catch (error) {
        this.log({ level: 'error', message: 'mock host: notice listener failed', detail: error })
      }
    }
  }

  // ---- Transport --------------------------------------------------------------------------------

  /** The endpoint is ignored: every session talks to the deployment's shared mock server. */
  connect(options: ConnectOptions): Outcome<Session> {
    return this.transport.connect(options)
  }

  // ---- status -----------------------------------------------------------------------------------

  /** How this tab reaches the server. */
  get hosting(): HostingMode {
    return this.backend?.mode ?? 'local'
  }

  /** True when the server runs in this tab (the elected leader, or a tab on its own). */
  isHosting(): boolean {
    return this.backend?.isHosting() ?? false
  }

  /** Every notice so far, oldest first, including those from before a listener was added. */
  notices(): readonly MockNotice[] {
    return [...this.received]
  }

  onNotice(listener: (notice: MockNotice) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ---- database controls (PLY-21), applied to the shared server -----------------------------------

  /** Back to the seed. Every session in every tab is dropped and reconnects (PLY-2). */
  async resetToSeed(): Promise<Result<void, string>> {
    const result = await this.control({ op: 'reset' })
    return result.ok ? { ok: true, value: undefined } : result
  }

  /** The whole database as JSON, for saving to a file or making a seed (PLY-34). */
  async exportDatabase(): Promise<Result<string, string>> {
    const result = await this.control({ op: 'export' })
    if (!result.ok) return result
    if (result.json === undefined) return { ok: false, error: 'the host sent no data' }
    return { ok: true, value: result.json }
  }

  /**
   * Replaces the database with an export, migrated if it is from an older release. Invalid input
   * changes nothing and fails with the reason. Sessions are dropped and reconnect.
   */
  async importDatabase(json: string): Promise<Result<void, string>> {
    const result = await this.control({ op: 'import', json })
    return result.ok ? { ok: true, value: undefined } : result
  }

  private async control(control: Parameters<Backend['control']>[0]) {
    await this.whenReady
    if (this.backend === undefined) return { ok: false as const, error: 'not started' }
    return this.backend.control(control)
  }

  /** Stops hosting in this tab: sessions end, and another tab takes over if this one led. */
  async close(): Promise<void> {
    this.stopPageHide?.()
    const backend = this.backend
    this.backend = undefined
    await backend?.close()
    this.table.close()
    this.releaseTabLock?.()
  }
}

/** The mock Transport for this deployment, shared by all its tabs (D17). Never rejects. */
export function connectMockTransport(options: MockHostOptions = {}): Promise<MockHost> {
  return MockHost.create(options)
}
