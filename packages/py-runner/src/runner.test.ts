// The runner's time limit (PY-10, WP 6.4): it counts the script's own time, from the worker's
// `started`, not the worker's start-up or the packages the script imports; those are bounded by
// the start limit. A fresh interpreter for every run (review M1): a worker runs one script and
// ends with it. A fake worker stands in for Pyodide.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScriptBridge } from './bridge.ts'
import { ScriptRunner } from './runner.ts'

class FakeWorker {
  static last: FakeWorker | undefined
  static all: FakeWorker[] = []
  readonly sent: unknown[] = []
  terminated = false
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()
  constructor() {
    FakeWorker.last = this
    FakeWorker.all.push(this)
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

const bridge = {
  discard: () => undefined,
  takeDraft: () => undefined,
  beginRun: () => undefined,
  endRun: () => undefined,
} as unknown as ScriptBridge
const timings = { loadPyodide: 1, loadPackages: 0, importSdk: 0, wasmMemory: 0 }
const START = { workerUrl: 'http://x/w.js', indexURL: 'http://x/', packages: [], timeoutMs: 5_000 }

beforeEach(() => {
  FakeWorker.all = []
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

/** Makes the newest worker ready, as Pyodide would once it has started. */
async function readyNewest(): Promise<FakeWorker> {
  await vi.advanceTimersByTimeAsync(0)
  const worker = FakeWorker.last
  if (worker === undefined) throw new Error('no worker')
  worker.emit({ kind: 'ready', timings })
  await vi.advanceTimersByTimeAsync(0)
  return worker
}

function finishRun(worker: FakeWorker, runId: number): void {
  worker.emit({ kind: 'started', runId })
  worker.emit({ kind: 'done', runId, ok: true, ms: 10, wasmMemory: 0 })
}

describe('a fresh interpreter for every run (review M1)', () => {
  it('ends the worker with its run and starts the next one at once (prewarm)', async () => {
    const runner = new ScriptRunner(() => undefined)
    const first = await started(runner)
    const one = runner.run(bridge, 'pass', 1_000)
    await vi.advanceTimersByTimeAsync(0)
    finishRun(first, 1)
    expect((await one).status).toBe('finished')
    expect(first.terminated).toBe(true)
    // The next worker is already starting, before any run asks for it.
    expect(FakeWorker.all).toHaveLength(2)
    const second = await readyNewest()
    expect(second).not.toBe(first)
    const two = runner.run(bridge, 'pass', 1_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(first.sent.filter((m) => (m as { kind: string }).kind === 'run')).toHaveLength(1)
    expect(second.sent.at(-1)).toMatchObject({ kind: 'run', runId: 2 })
    finishRun(second, 2)
    const outcome = await two
    expect(outcome.status).toBe('finished')
    expect(outcome.startMs).toBeGreaterThanOrEqual(0)
    expect(second.terminated).toBe(true)
  })

  it('a failed, timed-out or stopped run ends its worker too', async () => {
    const runner = new ScriptRunner(() => undefined)
    const first = await started(runner)
    const failing = runner.run(bridge, 'raise', 1_000)
    await vi.advanceTimersByTimeAsync(0)
    first.emit({ kind: 'started', runId: 1 })
    first.emit({ kind: 'done', runId: 1, ok: false, error: 'boom', ms: 1, wasmMemory: 0 })
    expect((await failing).status).toBe('failed')
    expect(first.terminated).toBe(true)
    const second = await readyNewest()
    const slow = runner.run(bridge, 'while True: pass', 500)
    await vi.advanceTimersByTimeAsync(0)
    second.emit({ kind: 'started', runId: 2 })
    await vi.advanceTimersByTimeAsync(500)
    expect((await slow).status).toBe('timed-out')
    expect(second.terminated).toBe(true)
    const third = await readyNewest()
    const stopped = runner.run(bridge, 'pass', 1_000)
    await vi.advanceTimersByTimeAsync(0)
    runner.stop()
    expect((await stopped).status).toBe('stopped')
    expect(third.terminated).toBe(true)
    expect(FakeWorker.all).toHaveLength(4)
  })

  it('without prewarm, the next worker starts only when the next run asks', async () => {
    const runner = new ScriptRunner(() => undefined, { prewarm: false })
    const first = await started(runner)
    const one = runner.run(bridge, 'pass', 1_000)
    await vi.advanceTimersByTimeAsync(0)
    finishRun(first, 1)
    await one
    expect(first.terminated).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(FakeWorker.all).toHaveLength(1)
    expect(runner.started).toBe(false)
    void runner.start(START)
    expect(FakeWorker.all).toHaveLength(2)
  })

  it('a run refused while another runs does not end the running worker', async () => {
    const runner = new ScriptRunner(() => undefined)
    const worker = await started(runner)
    void runner.run(bridge, 'pass', 1_000)
    await expect(runner.run(bridge, 'pass', 1_000)).rejects.toThrow(/already running/)
    expect(worker.terminated).toBe(false)
  })

  it('nothing starts again once disposed', async () => {
    const runner = new ScriptRunner(() => undefined)
    const worker = await started(runner)
    const one = runner.run(bridge, 'pass', 1_000)
    await vi.advanceTimersByTimeAsync(0)
    runner.dispose()
    expect((await one).status).toBe('stopped')
    expect(worker.terminated).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(FakeWorker.all).toHaveLength(1)
    await expect(runner.start(START)).rejects.toThrow(/disposed/)
  })
})
