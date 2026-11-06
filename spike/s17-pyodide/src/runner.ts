// The runner on the page: starts the script worker, runs one script at a time through a bridge,
// and stops it on request or at its time limit (PY-10) by terminating the worker. A run's draft
// writes are applied only when it finishes well (PD9); a stopped, timed-out or failed run leaves
// the draft as it was.
import type { WorldState } from '../../../packages/schemas/src/index.ts'
import type { ScriptBridge } from './bridge.ts'
import { fromWorkerSchema } from './protocol.ts'
import type { FromWorker, InitMessage, RunMessage, Timings } from './protocol.ts'
import workerUrl from './worker.ts?worker&url'

/** How the worker is created. `blob`: from a blob: wrapper, so it inherits the page's policy. */
export type WorkerMode = 'direct' | 'blob'

export interface StartOptions {
  readonly packages: readonly string[]
  readonly lockdown: boolean
  readonly mode: WorkerMode
  /** Give up on a worker that is not ready by then. Default 60 s. */
  readonly timeoutMs?: number
}

export interface RunOutcome {
  readonly status: 'finished' | 'failed' | 'stopped' | 'timed-out'
  readonly error?: string
  readonly output: string
  readonly ms: number
  /** ms of the run spent loading the shipped packages the script imports (PY-3). */
  readonly importsMs?: number
  readonly wasmMemory?: number
  /** The draft this run wrote, if it finished well; it is now the page's draft. */
  readonly applied?: WorldState
}

export interface StartResult {
  readonly timings: Timings
  /** ms from creating the worker to its `ready`, on the page's clock. */
  readonly totalMs: number
}

export class ScriptRunner {
  private worker: Worker | undefined
  private nextRun = 1
  private active:
    | { runId: number; bridge: ScriptBridge; output: string[]; finish: (o: RunOutcome) => void; t0: number }
    | undefined
  /** Messages from the worker that failed validation: kept, for the leak probes. */
  readonly rejected: unknown[] = []

  constructor(private readonly applyDraft: (state: WorldState) => void) {}

  get running(): boolean {
    return this.active !== undefined
  }

  start(options: StartOptions): Promise<StartResult> {
    this.terminate()
    const t0 = performance.now()
    const url = new URL(workerUrl, document.baseURI).href
    const worker =
      options.mode === 'direct'
        ? new Worker(url, { type: 'module' })
        : new Worker(
            URL.createObjectURL(
              new Blob([`import(${JSON.stringify(url)})`], { type: 'text/javascript' }),
            ),
            { type: 'module' },
          )
    this.worker = worker
    return new Promise((resolve, reject) => {
      // Pyodide logs a failed WebAssembly instantiation and never settles: give up after a limit.
      const timer = setTimeout(
        () => reject(new Error(`no ready within ${options.timeoutMs ?? 60_000} ms`)),
        options.timeoutMs ?? 60_000,
      )
      const settle = <T>(f: (v: T) => void) => (v: T) => {
        clearTimeout(timer)
        f(v)
      }
      resolve = settle(resolve)
      reject = settle(reject)
      worker.addEventListener('error', (event) => reject(new Error(event.message || 'worker error')))
      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        const parsed = fromWorkerSchema.safeParse(event.data)
        if (!parsed.success) {
          this.rejected.push(event.data)
          return
        }
        const message = parsed.data
        if (message.kind === 'hello') {
          // The worker listens: a blob: worker imports the real module after its own script
          // ends, so a message sent before this would be lost.
          const init: InitMessage = {
            kind: 'init',
            indexURL: new URL('pyodide/', document.baseURI).href,
            packages: options.packages,
            lockdown: options.lockdown,
          }
          worker.postMessage(init)
        } else if (message.kind === 'ready') {
          resolve({ timings: message.timings, totalMs: performance.now() - t0 })
        } else if (message.kind === 'init-failed') reject(new Error(message.error))
        else this.onMessage(message)
      })
    })
  }

  private onMessage(message: FromWorker): void {
    const run = this.active
    if (run === undefined || !('runId' in message) || message.runId !== run.runId) return
    if (message.kind === 'output') run.output.push(message.text)
    else if (message.kind === 'call') {
      void run.bridge.handle(run.runId, message.op, message.payload).then((result) => {
        if (this.active?.runId !== run.runId) return // stopped meanwhile: no reply
        this.worker?.postMessage({ kind: 'reply', callId: message.callId, result: JSON.stringify(result) })
      })
    } else if (message.kind === 'done') {
      const draft = run.bridge.takeDraft(run.runId)
      if (message.ok && draft !== undefined) this.applyDraft(draft)
      run.finish({
        status: message.ok ? 'finished' : 'failed',
        ...(message.error === undefined ? {} : { error: message.error }),
        output: run.output.join('\n'),
        ms: message.ms,
        ...(message.importsMs === undefined ? {} : { importsMs: message.importsMs }),
        wasmMemory: message.wasmMemory,
        ...(message.ok && draft !== undefined ? { applied: draft } : {}),
      })
    }
  }

  /** Runs a script as the bridge's role; `timeoutMs` is the run's limit (PY-10). */
  run(bridge: ScriptBridge, code: string, context: object, timeoutMs = 30_000): Promise<RunOutcome> {
    const worker = this.worker
    if (worker === undefined) return Promise.reject(new Error('the worker is not started'))
    if (this.active !== undefined) return Promise.reject(new Error('a script is running'))
    const runId = this.nextRun++
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.stop('timed-out'), timeoutMs)
      this.active = {
        runId,
        bridge,
        output: [],
        t0: performance.now(),
        finish: (outcome) => {
          clearTimeout(timer)
          this.active = undefined
          resolve(outcome)
        },
      }
      const message: RunMessage = { kind: 'run', runId, code, context: JSON.stringify(context) }
      worker.postMessage(message)
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

  terminate(): void {
    this.worker?.terminate()
    this.worker = undefined
  }
}
