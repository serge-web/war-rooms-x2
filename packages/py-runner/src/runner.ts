// The runner on the page, from S17: starts the script worker from a `blob:` bootstrap, runs one
// script at a time through a bridge, and stops it on request or at its time limit (PY-10) by
// terminating the worker. A run's draft writes are applied only when it finishes well (PD9); a
// stopped, timed-out or failed run leaves the draft as it was.
import type { WorldState } from '@wrx/schemas'
import type { ScriptBridge } from './bridge.ts'
import { fromWorkerSchema } from './protocol.ts'
import type { FromWorker, InitMessage, RunMessage, Timings } from './protocol.ts'

export interface StartOptions {
  /** Absolute URL of the worker module. */
  readonly workerUrl: string
  /** Absolute URL of the Pyodide folder, with a trailing slash. */
  readonly indexURL: string
  /** Packages to load before the first run (lock-file names); default none. */
  readonly packages: readonly string[]
  /** Give up on a worker that is not ready by then. */
  readonly timeoutMs: number
}

export type RunStatus = 'finished' | 'failed' | 'stopped' | 'timed-out'

export interface RunOutcome {
  readonly status: RunStatus
  readonly error?: string
  /** What the script printed, stdout and stderr together (the last 200,000 characters). */
  readonly output: string
  readonly ms: number
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
  readonly finish: (outcome: RunOutcome) => void
}

export class ScriptRunner {
  private worker: Worker | undefined
  private ready: Promise<StartResult> | undefined
  private nextRun = 1
  private active: ActiveRun | undefined
  private abortStart: (() => void) | undefined
  /** Messages from the worker that failed validation, newest last (bounded). */
  readonly rejected: unknown[] = []

  constructor(private readonly applyDraft: (state: WorldState) => void) {}

  get running(): boolean {
    return this.active !== undefined
  }

  get started(): boolean {
    return this.worker !== undefined
  }

  /** Starts a worker, or returns the one starting or started. */
  start(options: StartOptions): Promise<StartResult> {
    if (this.ready !== undefined) return this.ready
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
        if (this.worker === worker) this.terminate()
        reject(error)
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
    if (message.kind === 'output') {
      run.output.push(message.text)
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
      const applied = message.ok && draft !== undefined ? draft : undefined
      if (applied !== undefined) this.applyDraft(applied)
      run.finish({
        status: message.ok ? 'finished' : 'failed',
        ...(message.error === undefined ? {} : { error: message.error }),
        output: run.output.join('\n'),
        ms: message.ms,
        ...(message.importsMs === undefined ? {} : { importsMs: message.importsMs }),
        wasmMemory: message.wasmMemory,
        ...(applied === undefined ? {} : { applied }),
      })
    }
  }

  /** Runs a script through `bridge`, in a started worker; `timeoutMs` is its limit (PY-10). */
  run(bridge: ScriptBridge, code: string, timeoutMs: number): Promise<RunOutcome> {
    const ready = this.ready
    if (ready === undefined) return Promise.reject(new Error('the script worker is not started'))
    if (this.active !== undefined) return Promise.reject(new Error('a script is already running'))
    const runId = this.nextRun++
    return new Promise<RunOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.stop('timed-out')
      }, timeoutMs)
      // The slot is held while the worker finishes starting, so a second run is refused at once.
      const run: ActiveRun = {
        runId,
        bridge,
        output: [],
        outputChars: 0,
        t0: performance.now(),
        finish: (outcome) => {
          clearTimeout(timer)
          if (this.active === run) this.active = undefined
          resolve(outcome)
        },
      }
      this.active = run
      ready.then(
        () => {
          const worker = this.worker
          if (this.active !== run || worker === undefined) return // stopped meanwhile
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
  stop(status: 'stopped' | 'timed-out' = 'stopped'): void {
    const run = this.active
    this.terminate()
    if (run === undefined) return
    run.bridge.discard(run.runId)
    run.finish({ status, output: run.output.join('\n'), ms: performance.now() - run.t0 })
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
