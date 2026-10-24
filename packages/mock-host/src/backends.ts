// The three ways a tab reaches the shared mock server (D17, ARC-7):
// - `shared-worker`: the server runs in a SharedWorker, one per deployment;
// - `leader`: without SharedWorker, the tab holding the deployment's Web Lock runs it and the
//   others relay frames to it over a BroadcastChannel; when it closes, the next tab in the lock
//   queue takes over and loads the database from IndexedDB;
// - `local`: without Web Locks or BroadcastChannel, this tab runs a server of its own.
import type { MockState } from '@wrx/mock-server'
import type { Channel, Locks, WorkerHandle } from './env.ts'
import { ServerHost } from './host.ts'
import type { StateMigrations } from './migrate.ts'
import type { HostNames } from './namespace.ts'
import type { ConnectionTable } from './relay.ts'
import type { StateStore } from './store.ts'
import { busMessageSchema, downMessageSchema, parseMessage } from './wire.ts'
import type {
  BusMessage,
  Control,
  ControlResult,
  DownMessage,
  Log,
  MockNotice,
  UpMessage,
} from './wire.ts'

export type HostingMode = 'shared-worker' | 'leader' | 'local'

/** What a backend tells the tab. */
export interface BackendEvents {
  /** The host is serving; called again with a new host's notices when the leader changes. */
  ready(notices: readonly MockNotice[]): void
  notice(notice: MockNotice): void
  /** The backend cannot work (the worker failed to load): the tab should try another. */
  failed(reason: string): void
}

export interface TabContext {
  readonly tab: string
  readonly names: HostNames
  readonly table: ConnectionTable
  readonly seed: MockState
  readonly log: Log
  readonly events: BackendEvents
  readonly openStore: (name: string) => StateStore
  readonly saveDelayMs: number | undefined
  readonly migrations: StateMigrations | undefined
  readonly controlTimeoutMs: number
}

export interface Backend {
  readonly mode: HostingMode
  /** True in the tab that runs the server (`leader` and `local`). */
  isHosting(): boolean
  control(control: Control): Promise<ControlResult>
  /** The page is unloading: tell the host, and save if this tab hosts. */
  pageHide(): void
  close(): Promise<void>
}

function hostOptions(ctx: TabContext, broadcast: (notice: MockNotice) => void) {
  return {
    store: ctx.openStore(ctx.names.database),
    seed: ctx.seed,
    log: ctx.log,
    broadcast,
    ...(ctx.saveDelayMs === undefined ? {} : { saveDelayMs: ctx.saveDelayMs }),
    ...(ctx.migrations === undefined ? {} : { migrations: ctx.migrations }),
  }
}

/** Control requests waiting for the host's answer. */
class PendingControls {
  private nextId = 1
  private readonly pending = new Map<number, (result: ControlResult) => void>()

  constructor(private readonly timeoutMs: number) {}

  create(send: (id: number) => void): Promise<ControlResult> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: 'the mock host did not answer' })
      }, this.timeoutMs)
      this.pending.set(id, (result) => {
        clearTimeout(timer)
        resolve(result)
      })
      send(id)
    })
  }

  settle(id: number, result: ControlResult): void {
    const settle = this.pending.get(id)
    this.pending.delete(id)
    settle?.(result)
  }

  failAll(error: string): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const settle of pending) settle({ ok: false, error })
  }
}

// ---- SharedWorker ---------------------------------------------------------------------------

export class WorkerBackend implements Backend {
  readonly mode = 'shared-worker'
  private readonly controls: PendingControls
  private closed = false

  constructor(
    private readonly ctx: TabContext,
    private readonly worker: WorkerHandle,
  ) {
    this.controls = new PendingControls(ctx.controlTimeoutMs)
  }

  start(): void {
    const { ctx, worker } = this
    worker.onError((reason) => {
      if (this.closed) return
      this.closed = true
      ctx.log({ level: 'error', message: 'mock host: SharedWorker failed', detail: reason })
      this.controls.failAll(reason)
      ctx.events.failed(reason)
    })
    worker.port.listen((data) => {
      const message = parseMessage(downMessageSchema, data, 'SharedWorker to tab', ctx.log)
      if (message !== undefined) this.handle(message)
    })
    this.post({ k: 'hello', tab: ctx.tab, seed: ctx.seed })
    ctx.table.setRoute({
      id: 'worker',
      send: (conn, frame) => {
        this.post({ k: 'c2s', tab: ctx.tab, conn, frame })
      },
    })
  }

  private post(message: UpMessage): void {
    if (!this.closed) this.worker.port.post(message)
  }

  private handle(message: DownMessage): void {
    if (message.k !== 'notice' && message.tab !== this.ctx.tab) return
    switch (message.k) {
      case 'ready':
        this.ctx.events.ready(message.notices)
        return
      case 's2c':
        this.ctx.table.deliver('worker', message.conn, message.frame)
        return
      case 'result':
        this.controls.settle(message.id, message.result)
        return
      case 'notice':
        this.ctx.events.notice(message.notice)
        return
    }
  }

  isHosting(): boolean {
    return false
  }

  control(control: Control): Promise<ControlResult> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'the mock host is closed' })
    return this.controls.create((id) => {
      this.post({ k: 'control', tab: this.ctx.tab, id, control })
    })
  }

  pageHide(): void {
    this.post({ k: 'bye', tab: this.ctx.tab })
  }

  close(): Promise<void> {
    this.pageHide()
    this.closed = true
    this.controls.failAll('the mock host is closed')
    this.worker.port.close()
    return Promise.resolve()
  }
}

// ---- leader tab -----------------------------------------------------------------------------

export class LeaderBackend implements Backend {
  readonly mode = 'leader'
  private readonly controls: PendingControls
  private readonly bus: Channel
  private host: ServerHost | undefined
  private leader: string | undefined
  private readonly watched = new Set<string>()
  private resign: (() => void) | undefined
  private closed = false

  constructor(
    private readonly ctx: TabContext,
    private readonly locks: Locks,
    openChannel: (name: string) => Channel,
  ) {
    this.controls = new PendingControls(ctx.controlTimeoutMs)
    this.bus = openChannel(ctx.names.channel)
  }

  start(): void {
    this.bus.listen((data) => {
      const message = parseMessage(busMessageSchema, data, 'tab to tab', this.ctx.log)
      if (message !== undefined) this.handle(message)
    })
    // Queued behind the current leader; granted when it closes (re-election).
    this.locks
      .request(this.ctx.names.leaderLock, {}, () => this.lead())
      .catch((error: unknown) => {
        if (this.closed) return
        // Taken by a SharedWorker of a newer release.
        this.ctx.log({ level: 'warn', message: 'mock host: leadership lost', detail: error })
        this.host?.retire()
        this.ctx.events.notice({
          kind: 'superseded',
          text: 'A newer version of the app is open in another tab. Reload this tab.',
        })
      })
    this.post({ k: 'who', tab: this.ctx.tab })
  }

  private post(message: BusMessage): void {
    if (!this.closed) this.bus.post(message)
  }

  private hasClosed(): boolean {
    return this.closed
  }

  private down(message: DownMessage): void {
    this.post({ k: 'down', from: this.ctx.tab, m: message })
  }

  /** Runs while this tab holds the leader lock; the lock is released when it resolves. */
  private async lead(): Promise<void> {
    if (this.closed) return
    const { ctx } = this
    const host = await ServerHost.start(
      hostOptions(ctx, (notice) => {
        this.down({ k: 'notice', notice })
        ctx.events.notice(notice)
      }),
    )
    // close() may have run while the database loaded.
    if (this.hasClosed()) {
      await host.close()
      return
    }
    this.host = host
    this.leader = ctx.tab
    this.controls.failAll('the mock host changed; try again')
    ctx.table.setRoute({
      id: ctx.tab,
      send: (conn, frame) => {
        host.receive(ctx.tab, conn, frame, (out) => {
          ctx.table.deliver(ctx.tab, conn, out)
        })
      },
    })
    this.post({ k: 'leader', leader: ctx.tab, notices: [...host.notices] })
    ctx.events.ready(host.notices)
    await new Promise<void>((resolve) => {
      this.resign = resolve
    })
  }

  private handle(message: BusMessage): void {
    const { ctx } = this
    switch (message.k) {
      case 'who':
        if (this.host !== undefined) {
          this.post({ k: 'leader', leader: ctx.tab, notices: [...this.host.notices] })
        }
        return
      case 'leader':
        if (message.leader === ctx.tab || message.leader === this.leader) return
        this.follow(message.leader, message.notices)
        return
      case 'up':
        if (message.to === ctx.tab && this.host !== undefined) this.serve(this.host, message.m)
        return
      case 'down': {
        if (message.from !== this.leader || this.host !== undefined) return
        const m = message.m
        if (m.k !== 'notice' && m.tab !== ctx.tab) return
        switch (m.k) {
          case 's2c':
            ctx.table.deliver(message.from, m.conn, m.frame)
            return
          case 'result':
            this.controls.settle(m.id, m.result)
            return
          case 'notice':
            ctx.events.notice(m.notice)
            return
          case 'ready':
            return
        }
      }
    }
  }

  /** Another tab leads: send this tab's connections there. */
  private follow(leader: string, notices: readonly MockNotice[]): void {
    const { ctx } = this
    this.leader = leader
    // Controls sent to an earlier leader will not be answered.
    this.controls.failAll('the mock host changed; try again')
    ctx.table.setRoute({
      id: leader,
      send: (conn, frame) => {
        this.post({ k: 'up', to: leader, m: { k: 'c2s', tab: ctx.tab, conn, frame } })
      },
    })
    ctx.events.ready(notices)
  }

  /** As leader: a message from a follower tab. */
  private serve(host: ServerHost, message: UpMessage): void {
    switch (message.k) {
      case 'c2s': {
        this.watch(message.tab)
        const { tab, conn } = message
        host.receive(tab, conn, message.frame, (frame) => {
          this.down({ k: 's2c', tab, conn, frame })
        })
        return
      }
      case 'control':
        void host.control(message.control).then((result) => {
          this.down({ k: 'result', tab: message.tab, id: message.id, result })
        })
        return
      case 'bye':
        host.dropTab(message.tab)
        return
      case 'hello':
        return
    }
  }

  /** When a follower's tab lock comes free, the tab has closed: drop its sessions. */
  private watch(tab: string): void {
    if (tab === this.ctx.tab || this.watched.has(tab)) return
    this.watched.add(tab)
    void this.locks
      .request(this.ctx.names.tabLock(tab), {}, () => {
        this.watched.delete(tab)
        this.host?.dropTab(tab)
      })
      .catch(() => undefined)
  }

  isHosting(): boolean {
    return this.host !== undefined
  }

  control(control: Control): Promise<ControlResult> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'the mock host is closed' })
    if (this.host !== undefined) return this.host.control(control)
    const leader = this.leader
    if (leader === undefined) {
      return Promise.resolve({ ok: false, error: 'no tab hosts the mock yet; try again' })
    }
    return this.controls.create((id) => {
      this.post({ k: 'up', to: leader, m: { k: 'control', tab: this.ctx.tab, id, control } })
    })
  }

  pageHide(): void {
    if (this.host !== undefined) void this.host.flush()
    else if (this.leader !== undefined) {
      this.post({ k: 'up', to: this.leader, m: { k: 'bye', tab: this.ctx.tab } })
    }
  }

  async close(): Promise<void> {
    this.pageHide()
    const host = this.host
    this.host = undefined
    this.closed = true
    this.controls.failAll('the mock host is closed')
    if (host !== undefined) await host.close()
    this.resign?.()
    this.bus.close()
  }
}

// ---- this tab only --------------------------------------------------------------------------

export class LocalBackend implements Backend {
  readonly mode = 'local'
  private host: ServerHost | undefined

  constructor(private readonly ctx: TabContext) {}

  async start(): Promise<void> {
    const { ctx } = this
    const host = await ServerHost.start(
      hostOptions(ctx, (notice) => {
        ctx.events.notice(notice)
      }),
    )
    this.host = host
    ctx.table.setRoute({
      id: 'local',
      send: (conn, frame) => {
        host.receive(ctx.tab, conn, frame, (out) => {
          ctx.table.deliver('local', conn, out)
        })
      },
    })
    ctx.events.ready(host.notices)
  }

  isHosting(): boolean {
    return true
  }

  control(control: Control): Promise<ControlResult> {
    if (this.host === undefined) return Promise.resolve({ ok: false, error: 'not started' })
    return this.host.control(control)
  }

  pageHide(): void {
    void this.host?.flush()
  }

  async close(): Promise<void> {
    await this.host?.close()
    this.host = undefined
  }
}
