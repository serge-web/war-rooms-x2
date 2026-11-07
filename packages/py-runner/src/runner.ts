// The runner on the page, from S17: starts the script worker from a `blob:` bootstrap, runs one
// script at a time through a bridge, and stops it on request or at its time limit (PY-10) by
// terminating the worker. The time limit counts the script's own time: it starts when the worker
// says the script has started (`started`, after its packages load), and the worker's start and
// the imports are bounded by the start limit instead (WP 6.4). A run's draft writes are applied only when it finishes well (PD9); a
// stopped, timed-out or failed run leaves the draft as it was.
//
// Every run gets a fresh interpreter (Phase 6 security review M1, the owner's decision of
// Nov 6, 2026): a worker runs one script at most and is terminated when that run ends, however
// it ends, so nothing a script leaves behind (a patched module, a value in `builtins`) reaches
// the next run. With `prewarm` on (the default), the next worker starts in the background as
// soon as a run ends, so a run asked for a few seconds later finds it ready.
import type { WorldState } from '@wrx/schemas'
import type { DraftWrite, ScriptBridge } from './bridge.ts'
import { fromWorkerSchema } from './protocol.ts'
import type { EventMessage, FromWorker, InitMessage, RunMessage, Timings } from './protocol.ts'

export interface StartOptions {
  /** Absolute URL of the worker module. */
  readonly workerUrl: string
  /** Absolute URL of the Pyodide folder, with a trailing slash. */
  readonly indexURL: string
  /** Packages to load before the first run (lock-file names); default none. */
  readonly packages: readonly string[]
  /** Give up on a worker that is not ready by then. */
  readonly timeoutMs: number
  /** Import the SDK (and so pydantic) in each new worker before it is ready; default false. */
  readonly preimportSdk?: boolean
}

export type RunStatus = 'finished' | 'failed' | 'stopped' | 'timed-out'

/** One line a script printed (WP 6.3). */
export interface OutputLine {
  readonly stream: 'stdout' | 'stderr'
  readonly text: string
}

export interface RunOutcome {
  readonly status: RunStatus
  readonly error?: string
  /** What the script printed, stdout and stderr together (the last 200,000 characters). */
  readonly output: string
  readonly ms: number
  /**
   * ms on the page from asking for the run to its script starting: waiting for a fresh worker
   * (when none was ready) and loading the packages the script imports. Absent if it never started.
   */
  readonly startMs?: number
  /** ms of the run spent loading the shipped packages the script imports (PY-3). */
  readonly importsMs?: number
  readonly wasmMemory?: number
  /** The draft this run wrote, if it finished well and wrote one: it has been applied. */
  readonly applied?: WorldState
}

export interface StartResult {
  readonly timings: Timings
  /** ms from creating the worker to its `ready`, on the page's clock. */
  readonly totalMs: number
}

const MAX_OUTPUT = 200_000

/** The bootstrap: a module worker from a `blob:` URL takes the page's policy (S17 item 5). */
function bootstrap(workerUrl: string): string {
  const source = `import(${JSON.stringify(workerUrl)})`
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
}

interface ActiveRun {
  readonly runId: number
  readonly bridge: ScriptBridge
  readonly output: string[]
  outputChars: number
  readonly t0: number
  /** Whether the script has started (`started` came), so its time limit runs. */
  started: boolean
  /** ms from asking for the run to `started`, on the page's clock. */
  startMs: number | undefined
  /** The worker the run was sent to; it runs nothing else and ends with the run (M1). */
  worker: Worker | undefined
  readonly onStarted: () => void
  readonly onOutput: ((line: OutputLine) => void) | undefined
  readonly finish: (outcome: RunOutcome) => void
}

export class ScriptRunner {
  private worker: Worker | undefined
  private ready: Promise<StartResult> | undefined
  private nextRun = 1
  private active: ActiveRun | undefined
  private abortStart: (() => void) | undefined
  /** The start limit of the last `start`: also bounds a run's wait for its script to start. */
  private startTimeoutMs = 60_000
  /** The options of the last `start`, for the worker started after a run ends. */
  private startOptions: StartOptions | undefined
  private closed = false
  /** Messages from the worker that failed validation, newest last (bounded). */
  readonly rejected: unknown[] = []
  /** Start the next run's worker as soon as a run ends (M1); otherwise when the next run asks. */
  readonly prewarm: boolean

  constructor(
    private readonly applyDraft: (write: DraftWrite) => void,
    options: { readonly prewarm?: boolean } = {},
  ) {
    this.prewarm = options.prewarm ?? true
  }

  get running(): boolean {
    return this.active !== undefined
  }

  get started(): boolean {
    return this.worker !== undefined
  }

  /** Starts a worker, or returns the one starting or started. */
  start(options: StartOptions): Promise<StartResult> {
    if (this.closed) return Promise.reject(new Error('the runner was disposed'))
    if (this.ready !== undefined) return this.ready
    this.startOptions = options
    this.startTimeoutMs = options.timeoutMs
    const t0 = performance.now()
    const blobUrl = bootstrap(options.workerUrl)
    const worker = new Worker(blobUrl, { type: 'module' })
    this.worker = worker
    const ready = new Promise<StartResult>((resolve, reject) => {
      // Pyodide logs a failed WebAssembly instantiation and never settles: give up at a limit.
      const timer = setTimeout(() => {
        fail(new Error(`the script worker was not ready within ${options.timeoutMs} ms`))
      }, options.timeoutMs)
      const settle = () => {
        clearTimeout(timer)
        URL.revokeObjectURL(blobUrl)
      }
      const fail = (error: Error) => {
        settle()
        // The real reason goes to the caller, not the abort's "stopped while starting".
        reject(error)
        if (this.worker === worker) this.terminate()
      }
      this.abortStart = () => {
        settle()
        reject(new Error('the script worker was stopped while starting'))
      }
      worker.addEventListener('error', (event) => {
        fail(new Error(event.message || 'the script worker failed to load'))
      })
      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        const parsed = fromWorkerSchema.safeParse(event.data)
        if (!parsed.success) {
          if (this.rejected.length >= 100) this.rejected.shift()
          this.rejected.push(event.data)
          return
        }
        const message = parsed.data
        if (message.kind === 'hello') {
          const init: InitMessage = {
            kind: 'init',
            indexURL: options.indexURL,
            packages: options.packages,
            preimportSdk: options.preimportSdk ?? false,
          }
          worker.postMessage(init)
        } else if (message.kind === 'ready') {
          settle()
          this.abortStart = undefined
          resolve({ timings: message.timings, totalMs: performance.now() - t0 })
        } else if (message.kind === 'init-failed') {
          fail(new Error(message.error))
        } else {
          this.onMessage(worker, message)
        }
      })
    })
    this.ready = ready
    return ready
  }

  private onMessage(worker: Worker, message: FromWorker): void {
    const run = this.active
    if (worker !== this.worker || run === undefined) return
    if (!('runId' in message) || message.runId !== run.runId) return
    if (message.kind === 'started') {
      if (!run.started) {
        run.started = true
        run.startMs = performance.now() - run.t0
        run.onStarted()
      }
    } else if (message.kind === 'output') {
      run.output.push(message.text)
      try {
        run.onOutput?.({ stream: message.stream ?? 'stdout', text: message.text })
      } catch {
        // The page's listener failing must not stop the run.
      }
      run.outputChars += message.text.length + 1
      while (run.outputChars > MAX_OUTPUT && run.output.length > 1) {
        run.outputChars -= (run.output.shift()?.length ?? 0) + 1
      }
    } else if (message.kind === 'call') {
      void run.bridge.handle(run.runId, message.op, message.payload).then((result) => {
        if (this.active?.runId !== run.runId || this.worker !== worker) return // stopped
        worker.postMessage({
          kind: 'reply',
          callId: message.callId,
          result,
        })
      })
    } else {
      const draft = run.bridge.takeDraft(run.runId)
      const write = message.ok && draft !== undefined ? draft : undefined
      if (write !== undefined) this.applyDraft(write)
      const applied = write?.state
      run.finish({
        status: message.ok ? 'finished' : 'failed',
        ...(message.error === undefined ? {} : { error: message.error }),
        output: run.output.join('\n'),
        ms: message.ms,
        ...(run.startMs === undefined ? {} : { startMs: run.startMs }),
        ...(message.importsMs === undefined ? {} : { importsMs: message.importsMs }),
        wasmMemory: message.wasmMemory,
        ...(applied === undefined ? {} : { applied }),
      })
    }
  }

  /**
   * Runs a script through `bridge`, in a started worker; `timeoutMs` is its limit (PY-10),
   * counted from the moment the script starts. Until then (the worker starting, the packages the
   * script imports loading) the start limit applies; a run that does not start within it fails.
   */
  run(
    bridge: ScriptBridge,
    code: string,
    timeoutMs: number,
    onOutput?: (line: OutputLine) => void,
  ): Promise<RunOutcome> {
    const ready = this.ready
    if (ready === undefined) return Promise.reject(new Error('the script worker is not started'))
    if (this.active !== undefined) return Promise.reject(new Error('a script is already running'))
    const runId = this.nextRun++
    const startLimit = this.startTimeoutMs
    return new Promise<RunOutcome>((resolve) => {
      let timer = setTimeout(() => {
        if (this.active !== run) return
        this.stop('failed', `the script did not start within ${startLimit} ms`)
      }, startLimit)
      // The slot is held while the worker finishes starting, so a second run is refused at once.
      const run: ActiveRun = {
        runId,
        bridge,
        output: [],
        outputChars: 0,
        t0: performance.now(),
        started: false,
        startMs: undefined,
        worker: undefined,
        onStarted: () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            if (this.active === run) this.stop('timed-out')
          }, timeoutMs)
        },
        onOutput,
        finish: (outcome) => {
          clearTimeout(timer)
          // Its subscriptions stop and the rooms it held are let go (WP 6.4).
          bridge.endRun(runId)
          if (this.active === run) this.active = undefined
          this.retire(run.worker)
          resolve(outcome)
        },
      }
      this.active = run
      // Events for the run's subscriptions go to its worker while it is the active run.
      bridge.beginRun(runId, (event) => {
        const worker = this.worker
        if (this.active !== run || worker === undefined) return
        const message: EventMessage = { kind: 'event', runId, event }
        worker.postMessage(message)
      })
      ready.then(
        () => {
          const worker = this.worker
          if (this.active !== run || worker === undefined) return // stopped meanwhile
          // A worker that ran a script never runs another (M1): `retire` ends it with the run.
          run.worker = worker
          const message: RunMessage = { kind: 'run', runId, code }
          worker.postMessage(message)
        },
        (error: unknown) => {
          if (this.active === run) {
            run.finish({ status: 'failed', error: String(error), output: '', ms: 0 })
          }
        },
      )
    })
  }

  /** Stops the running script by terminating the worker; its draft writes are dropped (PD9). */
  stop(status: 'stopped' | 'timed-out' | 'failed' = 'stopped', error?: string): void {
    const run = this.active
    this.terminate()
    if (run === undefined) return
    run.bridge.discard(run.runId)
    run.finish({
      status,
      ...(error === undefined ? {} : { error }),
      output: run.output.join('\n'),
      ms: performance.now() - run.t0,
      ...(run.startMs === undefined ? {} : { startMs: run.startMs }),
    })
  }

  /**
   * Ends the worker a run used, so the next run gets a fresh interpreter (M1), and starts that
   * one now when `prewarm` is on. A run that never reached a worker (it failed or was stopped
   * while the worker started) leaves the worker alone, since no script ran in it.
   */
  private retire(worker: Worker | undefined): void {
    if (worker !== undefined && worker === this.worker) this.terminate()
    if (worker === undefined || !this.prewarm || this.closed) return
    const options = this.startOptions
    if (options === undefined || this.ready !== undefined) return
    // A failed background start is reported by the next run, which starts again.
    this.start(options).catch(() => undefined)
  }

  /** Ends the worker for good: nothing starts again. */
  dispose(): void {
    this.closed = true
    this.stop()
    this.terminate()
  }

  /** Ends the worker; the next start begins a new one. */
  terminate(): void {
    const abort = this.abortStart
    this.abortStart = undefined
    this.worker?.terminate()
    this.worker = undefined
    this.ready = undefined
    abort?.()
  }
}
