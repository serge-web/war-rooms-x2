// Time for the mock (ARC-7, §11 limits of the guarantee): the server reads a Clock for its
// timestamps, and the transport waits on a Scheduler for delivery, latency and reconnection.
// Both are injected, so tests can run on a controllable clock. Nothing here touches a browser
// API: `setTimeout` and `queueMicrotask` exist in workers, pages and Node alike.

/** Server time, in milliseconds since the epoch. Fractions are kept down to the microsecond. */
export interface Clock {
  now(): number
}

export type Cancel = () => void

/** Runs a task later. `ms <= 0` means "as soon as possible", after the current task. */
export interface Scheduler {
  after(ms: number, task: () => void): Cancel
}

export const systemClock: Clock = Object.freeze({ now: () => Date.now() })

/** Real timers: a microtask for zero delay, `setTimeout` otherwise. */
export const realScheduler: Scheduler = Object.freeze({
  after(ms: number, task: () => void): Cancel {
    if (ms <= 0) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) task()
      })
      return () => {
        cancelled = true
      }
    }
    const timer = setTimeout(task, ms)
    return () => {
      clearTimeout(timer)
    }
  },
})

interface Timer {
  readonly at: number
  readonly seq: number
  readonly task: () => void
  cancelled: boolean
}

/**
 * A controllable clock and scheduler in one, for tests (DOC-20 screenshots, unit tests): time
 * moves only when `advance` is called, and tasks due by then run in time order.
 */
export class ManualTime implements Clock, Scheduler {
  private current: number
  private seq = 0
  private timers: Timer[] = []

  /** Starts at `start` (epoch ms); the default is 2026-10-24T09:00:00Z. */
  constructor(start = Date.UTC(2026, 9, 24, 9, 0, 0)) {
    this.current = start
  }

  now(): number {
    return this.current
  }

  /** Sets the time without running tasks; it may not go backwards. */
  set(ms: number): void {
    if (ms < this.current) throw new RangeError('ManualTime cannot go backwards')
    this.current = ms
  }

  after(ms: number, task: () => void): Cancel {
    const timer: Timer = {
      at: this.current + Math.max(0, ms),
      seq: this.seq++,
      task,
      cancelled: false,
    }
    this.timers.push(timer)
    return () => {
      timer.cancelled = true
    }
  }

  /** Tasks waiting to run. */
  pending(): number {
    return this.timers.filter((t) => !t.cancelled).length
  }

  /**
   * Moves time forward by `ms`, running every task due on the way, in order, and yielding to
   * the event loop between tasks so promise continuations run as they would for real.
   */
  async advance(ms = 0): Promise<void> {
    const until = this.current + Math.max(0, ms)
    for (let guard = 0; guard < 100_000; guard++) {
      await yieldToEventLoop()
      const next = this.nextDue(until)
      if (next === undefined) break
      this.current = Math.max(this.current, next.at)
      next.task()
    }
    this.current = until
    await yieldToEventLoop()
  }

  private nextDue(until: number): Timer | undefined {
    this.timers = this.timers.filter((t) => !t.cancelled)
    let best: Timer | undefined
    for (const timer of this.timers) {
      if (timer.at > until) continue
      if (
        best === undefined ||
        timer.at < best.at ||
        (timer.at === best.at && timer.seq < best.seq)
      )
        best = timer
    }
    if (best !== undefined) best.cancelled = true
    return best
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
