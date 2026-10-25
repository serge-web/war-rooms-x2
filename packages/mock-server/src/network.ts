// The simulated network between sessions and the server (§11, limits of the guarantee): every
// frame is delivered asynchronously, in order by default, with injectable latency, jitter,
// reordering and loss of connectivity. Test controls only; the defaults are a fast, ordered,
// always-up link.
import { realScheduler } from './time.ts'
import type { Cancel, Scheduler } from './time.ts'

export interface NetworkConditions {
  /** Added to every frame, each way. Default 0: the next microtask. */
  readonly latencyMs: number
  /** A random extra delay of up to this much per frame. Default 0. */
  readonly jitterMs: number
  /**
   * Deliver each frame when its own delay is up, so jitter reorders frames. Off by default,
   * where frames keep their order whatever their delays (as on a TCP stream). Reordering breaks
   * guarantees the contract suite asserts, on purpose.
   */
  readonly reorder: boolean
  /** While false, connections and reconnections fail; existing links are unaffected. */
  readonly online: boolean
}

const DEFAULT_CONDITIONS: NetworkConditions = Object.freeze({
  latencyMs: 0,
  jitterMs: 0,
  reorder: false,
  online: true,
})

export interface MockNetworkOptions {
  readonly scheduler?: Scheduler
  /** For jitter. Default Math.random. */
  readonly random?: () => number
}

/** Shared by the sessions of one MockTransport. */
export class MockNetwork {
  readonly scheduler: Scheduler
  private readonly random: () => number
  private current: NetworkConditions = DEFAULT_CONDITIONS

  constructor(options: MockNetworkOptions = {}) {
    this.scheduler = options.scheduler ?? realScheduler
    this.random = options.random ?? Math.random
  }

  get conditions(): NetworkConditions {
    return this.current
  }

  /** Changes some conditions; frames already in flight keep their delays. */
  set(conditions: Partial<NetworkConditions>): void {
    this.current = { ...this.current, ...conditions }
  }

  /** Back to the defaults. */
  clear(): void {
    this.current = DEFAULT_CONDITIONS
  }

  delay(): number {
    const { latencyMs, jitterMs } = this.current
    return Math.max(0, latencyMs) + (jitterMs > 0 ? this.random() * jitterMs : 0)
  }
}

interface Entry<T> {
  readonly item: T
  ready: boolean
  cancel: Cancel
}

/**
 * One direction of one connection. Frames wait out their delay; then, unless the network
 * reorders, they are delivered strictly in the order sent. A paused channel holds frames
 * until resumed (a connection being resumed with XEP-0198).
 */
export class Channel<T> {
  private queue: Entry<T>[] = []
  private paused = false
  private closed = false
  private flushing = false

  constructor(
    private readonly network: MockNetwork,
    private readonly deliver: (item: T) => void,
  ) {}

  push(item: T): void {
    if (this.closed) return
    const entry: Entry<T> = { item, ready: false, cancel: () => undefined }
    this.queue.push(entry)
    entry.cancel = this.network.scheduler.after(this.network.delay(), () => {
      entry.ready = true
      this.flush()
    })
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    this.flush()
  }

  /** Drops whatever is in flight; nothing more is delivered. */
  close(): void {
    this.closed = true
    for (const entry of this.queue) entry.cancel()
    this.queue = []
  }

  private flush(): void {
    if (this.flushing) return
    this.flushing = true
    try {
      while (!this.paused && !this.closed) {
        const index = this.network.conditions.reorder
          ? this.queue.findIndex((e) => e.ready)
          : this.queue[0]?.ready === true
            ? 0
            : -1
        if (index < 0) break
        const [entry] = this.queue.splice(index, 1)
        if (entry !== undefined) this.deliver(entry.item)
      }
    } finally {
      this.flushing = false
    }
  }
}
