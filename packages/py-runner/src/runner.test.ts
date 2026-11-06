// The runner's time limit (PY-10, WP 6.4): it counts the script's own time, from the worker's
// `started`, not the worker's start-up or the packages the script imports; those are bounded by
// the start limit. A fake worker stands in for Pyodide.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScriptBridge } from './bridge.ts'
import { ScriptRunner } from './runner.ts'

class FakeWorker {
  static last: FakeWorker | undefined
  readonly sent: unknown[] = []
  terminated = false
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()
  constructor() {
    FakeWorker.last = this
    queueMicrotask(() => {
      this.emit({ kind: 'hello' })
    })
  }
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  terminate(): void {
    this.terminated = true
  }
  emit(data: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data })
  }
}

const bridge = { discard: () => undefined, takeDraft: () => undefined } as unknown as ScriptBridge
const timings = { loadPyodide: 1, loadPackages: 0, wasmMemory: 0 }
const START = { workerUrl: 'http://x/w.js', indexURL: 'http://x/', packages: [], timeoutMs: 5_000 }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Worker', FakeWorker)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function started(runner: ScriptRunner): Promise<FakeWorker> {
  const ready = runner.start(START)
  await vi.advanceTimersByTimeAsync(0)
  const worker = FakeWorker.last
  if (worker === undefined) throw new Error('no worker')
  worker.emit({ kind: 'ready', timings })
  await ready
  return worker
}

describe('the time limit', () => {
  it('starts when the script starts, not while the worker loads its packages', async () => {
    const runner = new ScriptRunner(() => undefined)
    const worker = await started(runner)
    let outcome: string | undefined
    void runner.run(bridge, 'pass', 1_000).then((o) => (outcome = o.status))
    await vi.advanceTimersByTimeAsync(0)
    expect(worker.sent.at(-1)).toMatchObject({ kind: 'run', runId: 1 })
    // Imports take 3 s, three times the limit: not the script's time.
    await vi.advanceTimersByTimeAsync(3_000)
    expect(outcome).toBeUndefined()
    worker.emit({ kind: 'started', runId: 1 })
    await vi.advanceTimersByTimeAsync(999)
    expect(outcome).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome).toBe('timed-out')
    expect(worker.terminated).toBe(true)
  })

  it('a script that never starts fails at the start limit, distinctly', async () => {
    const runner = new ScriptRunner(() => undefined)
    await started(runner)
    const run = runner.run(bridge, 'pass', 1_000)
    await vi.advanceTimersByTimeAsync(5_000)
    const outcome = await run
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toMatch(/did not start within 5000 ms/)
  })

  it('a run asked for while the worker starts waits for it, untimed', async () => {
    const runner = new ScriptRunner(() => undefined)
    const ready = runner.start(START)
    let outcome: string | undefined
    void runner.run(bridge, 'pass', 500).then((o) => (outcome = o.status))
    await vi.advanceTimersByTimeAsync(2_000)
    const worker = FakeWorker.last
    if (worker === undefined) throw new Error('no worker')
    worker.emit({ kind: 'ready', timings })
    await ready
    await vi.advanceTimersByTimeAsync(0)
    worker.emit({ kind: 'started', runId: 1 })
    worker.emit({ kind: 'done', runId: 1, ok: true, ms: 10, wasmMemory: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toBe('finished')
  })
})
