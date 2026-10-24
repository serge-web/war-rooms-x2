// Stand-ins for the browser, for unit tests in Node: a Web Locks manager with the queueing and
// stealing the host relies on, BroadcastChannels (Node has them), and an in-memory store shared
// by every "tab". Each tab can be killed as a closed browser tab dies: its locks are released,
// its channels and storage go dead, and nothing more is sent. SharedWorkers are simulated with
// MessageChannels, one worker per release and name.
import { portChannel } from './env.ts'
import type { Channel, HostEnvironment, LockOptions, Locks } from './env.ts'
import { MemoryStore } from './store.ts'
import type { StateStore } from './store.ts'
import type { Log } from './wire.ts'
import { serveSharedWorker } from './worker-host.ts'
import type { WorkerHost } from './worker-host.ts'

interface Request {
  readonly client: number
  readonly callback: (lock: unknown) => unknown
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
}

export class FakeLockManager {
  private readonly held = new Map<string, Request>()
  private readonly queues = new Map<string, Request[]>()
  private nextClient = 1

  /** The `navigator.locks` of one context. */
  client(): { readonly locks: Locks; readonly kill: () => void } {
    const client = this.nextClient++
    const locks: Locks = {
      request: (name: string, options: LockOptions, callback: (lock: unknown) => unknown) =>
        new Promise((resolve, reject) => {
          const request: Request = { client, callback, resolve, reject }
          const holder = this.held.get(name)
          if (options.steal === true && holder !== undefined) {
            this.held.delete(name)
            holder.reject(new DOMException('The lock was stolen', 'AbortError'))
          }
          if (this.held.has(name)) {
            if (options.ifAvailable === true) {
              Promise.resolve(callback(null)).then(resolve, reject)
              return
            }
            const queue = this.queues.get(name) ?? []
            queue.push(request)
            this.queues.set(name, queue)
            return
          }
          this.grant(name, request)
        }),
    }
    return {
      locks,
      kill: () => {
        for (const [name, queue] of this.queues) {
          this.queues.set(
            name,
            queue.filter((r) => r.client !== client),
          )
        }
        for (const [name, holder] of [...this.held]) {
          if (holder.client === client) this.release(name, holder)
        }
      },
    }
  }

  isHeld(name: string): boolean {
    return this.held.has(name)
  }

  private grant(name: string, request: Request): void {
    this.held.set(name, request)
    void Promise.resolve()
      .then(() => request.callback({ name }))
      .then(
        (value) => {
          this.release(name, request)
          request.resolve(value)
        },
        (error: unknown) => {
          this.release(name, request)
          request.reject(error)
        },
      )
  }

  private release(name: string, request: Request): void {
    if (this.held.get(name) !== request) return
    this.held.delete(name)
    const next = this.queues.get(name)?.shift()
    if (next !== undefined) this.grant(name, next)
  }
}

/** A store that stops reading and writing once its tab is killed. */
class TabStore implements StateStore {
  constructor(
    private readonly shared: StateStore,
    private readonly alive: () => boolean,
  ) {}

  load(): Promise<unknown> {
    return this.alive() ? this.shared.load() : new Promise(() => undefined)
  }

  save(json: string): Promise<void> {
    return this.alive() ? this.shared.save(json) : Promise.resolve()
  }

  clear(): Promise<void> {
    return this.alive() ? this.shared.clear() : Promise.resolve()
  }

  close(): void {
    // The shared store outlives tabs.
  }
}

/** One browser profile: shared locks, channels and storage for its "tabs". */
export class FakeBrowser {
  readonly locks = new FakeLockManager()
  readonly stores = new Map<string, MemoryStore>()
  private tabCount = 0
  /** Node's BroadcastChannels are process-wide, so each fake browser gets its own names. */
  private readonly id = Math.random().toString(36).slice(2)
  private readonly workers = new Map<string, WorkerHost>()
  private readonly ports: MessagePort[] = []

  store(name: string): MemoryStore {
    const store = this.stores.get(name) ?? new MemoryStore()
    this.stores.set(name, store)
    return store
  }

  /** The real BroadcastChannel name behind a host's channel name. */
  channelName(name: string): string {
    return `${this.id}|${name}`
  }

  /** The SharedWorker of `release` named `name`, started on first use, as a browser does. */
  private worker(release: string, name: string, log: Log): WorkerHost {
    const key = `${release}|${name}`
    let worker = this.workers.get(key)
    if (worker === undefined) {
      worker = serveSharedWorker({
        name,
        locks: this.locks.client().locks,
        openStore: (db) => this.store(db),
        log,
      })
      this.workers.set(key, worker)
    }
    return worker
  }

  /**
   * A tab at `url`. With `worker`, the tab has SharedWorker and `worker` names the release
   * whose worker script it loads; without, it has none.
   */
  tab(
    url = 'http://localhost/app/',
    options: { readonly worker?: string; readonly workerLog?: Log } = {},
  ): {
    readonly environment: HostEnvironment
    readonly kill: () => void
  } {
    const n = ++this.tabCount
    const { locks, kill } = this.locks.client()
    const channels: { close(): void }[] = []
    let alive = true
    const release = options.worker
    const environment: HostEnvironment = {
      baseURI: url,
      locks,
      openChannel: (name: string): Channel => {
        const channel = new BroadcastChannel(this.channelName(name))
        channels.push(channel)
        return {
          post: (message) => {
            if (alive) channel.postMessage(message)
          },
          listen: (listener) => {
            channel.onmessage = (event: MessageEvent<unknown>) => {
              if (alive) listener(event.data)
            }
          },
          close: () => {
            channel.close()
          },
        }
      },
      startWorker:
        release === undefined
          ? undefined
          : (name: string) => {
              const worker = this.worker(release, name, options.workerLog ?? (() => undefined))
              const { port1, port2 } = new MessageChannel()
              this.ports.push(port1, port2)
              channels.push(port1)
              worker.connect(portChannel(port2))
              const tabEnd = portChannel(port1)
              return {
                port: {
                  post: (message) => {
                    if (alive) tabEnd.post(message)
                  },
                  listen: (listener) => {
                    tabEnd.listen((data) => {
                      if (alive) listener(data)
                    })
                  },
                  close: () => {
                    tabEnd.close()
                  },
                },
                onError: () => undefined,
              }
            },
      openStore: (name) => new TabStore(this.store(name), () => alive),
      onPageHide: () => () => undefined,
      storage: undefined,
      randomId: () => `tab-${n}`,
    }
    return {
      environment,
      kill: () => {
        alive = false
        kill()
        for (const channel of channels) channel.close()
      },
    }
  }

  /** Closes every worker port, so Node can exit. */
  close(): void {
    for (const port of this.ports.splice(0)) port.close()
  }
}
