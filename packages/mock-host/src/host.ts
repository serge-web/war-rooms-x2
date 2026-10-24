// The server end of the mock host (ARC-7): one MockServer for the deployment, run by whichever
// context hosts it, a SharedWorker or the leader tab. It loads the stored database (migrating
// it, or falling back to the seed with a notice: DOC-17), saves it back after requests, and
// applies the database controls (PLY-21) for every tab at once.
import { MockServer, realScheduler } from '@wrx/mock-server'
import type {
  Cancel,
  ClientFrame,
  MockServerOptions,
  MockState,
  OpName,
  Scheduler,
  ServerFrame,
  ServerPort,
} from '@wrx/mock-server'
import { MOCK_STATE_MIGRATIONS, MOCK_STATE_VERSION, migrateMockState } from './migrate.ts'
import type { StateMigrations } from './migrate.ts'
import type { StateStore } from './store.ts'
import type { Control, ControlResult, Log, MockNotice } from './wire.ts'

export interface ServerHostOptions {
  readonly store: StateStore
  /** Where the mock starts when nothing usable is stored, and what reset returns to. */
  readonly seed: MockState
  readonly log: Log
  /** Tells every tab: resets, imports, a failed save. */
  readonly broadcast: (notice: MockNotice) => void
  /**
   * How long after a change the state is saved (ms); changes in between share one write.
   * Default 0: the next microtask, so a leader tab that closes loses as little as possible.
   */
  readonly saveDelayMs?: number
  readonly migrations?: StateMigrations
  readonly scheduler?: Scheduler
  /** Clock, randomness and anonymous login for the server (tests). */
  readonly server?: Omit<MockServerOptions, 'seed'>
}

export const DEFAULT_SAVE_DELAY_MS = 0

/** Operations that change nothing a save would keep, so need no save. */
const READ_ONLY_OPS: readonly OpName[] = Object.freeze([
  'muc.getAffiliations',
  'muc.getRoomConfig',
  'muc.listRooms',
  'mam.queryRoom',
  'pubsub.getItems',
  'pubsub.listNodes',
  'pubsub.getNodeConfig',
  'pubsub.getAffiliations',
  'pubsub.getSubscriptions',
  'admin.onlineUsers',
  'admin.getPrivate',
])

interface Entry {
  readonly port: ServerPort
  readonly sink: (frame: ServerFrame) => void
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** Frames after which the server has closed the connection. */
function isFinal(frame: ServerFrame): boolean {
  return frame.t === 'refused' || frame.t === 'end' || frame.t === 'closed' || frame.t === 'dropped'
}

export class ServerHost {
  private readonly tabs = new Map<string, Map<number, Entry>>()
  private readonly saveDelayMs: number
  private readonly scheduler: Scheduler
  private saveTimer: Cancel | undefined
  private writing: Promise<void> | undefined
  private dirty = false
  private lastSaved: string | undefined
  private saveFailureReported = false
  private retired = false

  private constructor(
    private readonly server: MockServer,
    private readonly options: ServerHostOptions,
    /** False when storage failed on load: the host runs in memory only. */
    private readonly persistent: boolean,
    /** What the host had to tell on start: migration, reset, unavailable storage. */
    readonly notices: readonly MockNotice[],
  ) {
    this.saveDelayMs = options.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS
    this.scheduler = options.scheduler ?? realScheduler
  }

  /** Loads the stored database, or the seed, and starts serving. Never rejects. */
  static async start(options: ServerHostOptions): Promise<ServerHost> {
    const { store, seed, log } = options
    const notices: MockNotice[] = []
    let stored: unknown
    let persistent = true
    try {
      stored = await store.load()
    } catch (error) {
      persistent = false
      const reason = describe(error)
      log({ level: 'warn', message: 'mock host: storage unavailable', detail: reason })
      notices.push({
        kind: 'storage-unavailable',
        reason,
        text: 'This browser will not keep the mock database: changes are lost on reload.',
      })
    }
    let initial: MockState | undefined
    let save = stored === undefined
    if (stored !== undefined) {
      const read = migrateMockState(stored, options.migrations ?? MOCK_STATE_MIGRATIONS)
      if (read.ok) {
        initial = read.value.state
        if (read.value.from !== MOCK_STATE_VERSION) {
          save = true
          notices.push({
            kind: 'migrated',
            from: read.value.from,
            to: MOCK_STATE_VERSION,
            text: 'The mock database was updated for this release.',
          })
        }
      } else {
        save = true
        log({ level: 'warn', message: 'mock host: stored state unreadable', detail: read.error })
        notices.push({
          kind: 'reset-unreadable',
          reason: read.error,
          text: 'The stored mock database could not be read by this release, so it was reset to the demo scenario.',
        })
      }
    }
    const server = new MockServer({ ...options.server, seed })
    if (initial !== undefined) server.importState(initial)
    const host = new ServerHost(server, options, persistent, notices)
    if (save) await host.flush()
    return host
  }

  // ---- connections ----------------------------------------------------------------------------

  /** A frame from connection `conn` of `tab`; replies go to `sink`. */
  receive(tab: string, conn: number, frame: ClientFrame, sink: (frame: ServerFrame) => void): void {
    if (this.retired) {
      if (frame.t === 'login') {
        sink({
          t: 'refused',
          error: { condition: 'service-unavailable', text: 'a newer release hosts the mock' },
        })
      }
      return
    }
    const connections = this.tabs.get(tab) ?? new Map<number, Entry>()
    this.tabs.set(tab, connections)
    let entry = connections.get(conn)
    if (entry === undefined) {
      if (frame.t !== 'login') {
        // The connection is not known here, e.g. it was opened on a previous host: the session
        // must start again.
        if (frame.t === 'logout') sink({ t: 'closed' })
        else if (frame.t === 'request') sink({ t: 'dropped' })
        return
      }
      const forward = (out: ServerFrame) => {
        if (isFinal(out) && connections.get(conn) === created) {
          connections.delete(conn)
          if (connections.size === 0 && this.tabs.get(tab) === connections) this.tabs.delete(tab)
        }
        sink(out)
      }
      const created: Entry = { port: this.server.attach(forward), sink }
      entry = created
      connections.set(conn, created)
    }
    entry.port.send(frame)
    if (frame.t === 'logout' || frame.t === 'drop') connections.delete(conn)
    if (frame.t === 'request' && !READ_ONLY_OPS.includes(frame.request.op)) this.scheduleSave()
    if (connections.size === 0) this.tabs.delete(tab)
  }

  /** The tab has gone: its sessions end as a dropped connection would (others see them leave). */
  dropTab(tab: string): void {
    const connections = this.tabs.get(tab)
    this.tabs.delete(tab)
    for (const entry of connections?.values() ?? []) entry.port.send({ t: 'drop' })
  }

  /** Tabs with an open connection, for tests and diagnostics. */
  connectedTabs(): readonly string[] {
    return [...this.tabs.keys()]
  }

  /** Bound sessions on the server. */
  sessions(): readonly string[] {
    return this.server.sessions()
  }

  // ---- controls (PLY-21) ------------------------------------------------------------------------

  async control(control: Control): Promise<ControlResult> {
    if (this.retired) return { ok: false, error: 'a newer release hosts the mock' }
    switch (control.op) {
      case 'export':
        return { ok: true, json: JSON.stringify(this.server.exportState()) }
      case 'reset':
        this.server.reset()
        await this.flush()
        this.options.broadcast({ kind: 'reset', text: 'The mock was reset to its seed scenario.' })
        return { ok: true }
      case 'import': {
        const read = migrateMockState(control.json, this.options.migrations)
        if (!read.ok) return { ok: false, error: read.error }
        this.server.importState(read.value.state)
        await this.flush()
        this.options.broadcast({ kind: 'imported', text: 'A mock database was imported.' })
        return { ok: true }
      }
    }
  }

  // ---- persistence ------------------------------------------------------------------------------

  private scheduleSave(): void {
    if (!this.persistent || this.retired || this.saveTimer !== undefined) return
    this.saveTimer = this.scheduler.after(this.saveDelayMs, () => {
      this.saveTimer = undefined
      void this.flush()
    })
  }

  /**
   * Saves now, if anything changed since the last save. One write is in flight at a time;
   * changes made meanwhile go in one more write after it. Resolves when written; never rejects.
   */
  flush(): Promise<void> {
    this.saveTimer?.()
    this.saveTimer = undefined
    if (!this.persistent || this.retired) return this.writing ?? Promise.resolve()
    this.dirty = true
    this.writing ??= this.drain()
    return this.writing
  }

  private async drain(): Promise<void> {
    // Never finish synchronously, so `writing` is set before it is cleared below.
    await Promise.resolve()
    while (this.dirty && !this.retired) {
      this.dirty = false
      const json = JSON.stringify(this.server.exportState())
      if (json === this.lastSaved) continue
      try {
        await this.options.store.save(json)
        this.lastSaved = json
      } catch (error) {
        const reason = describe(error)
        this.options.log({ level: 'error', message: 'mock host: save failed', detail: reason })
        if (!this.saveFailureReported) {
          this.saveFailureReported = true
          this.options.broadcast({
            kind: 'storage-failed',
            reason,
            text: 'The mock database could not be saved (is browser storage full?). Recent changes may be lost on reload.',
          })
        }
      }
    }
    this.writing = undefined
  }

  /**
   * Stops serving for good, without saving again: another host (a newer release's worker) has
   * taken over the database. Sessions are dropped and new logins refused.
   */
  retire(): void {
    if (this.retired) return
    this.retired = true
    this.saveTimer?.()
    this.saveTimer = undefined
    for (const connections of this.tabs.values()) {
      for (const entry of connections.values()) {
        entry.sink({ t: 'dropped' })
        entry.port.send({ t: 'drop' })
      }
    }
    this.tabs.clear()
  }

  /** Saves and releases storage; the host serves nothing more. */
  async close(): Promise<void> {
    await this.flush()
    this.retire()
    this.options.store.close()
  }
}
