// The script worker (PY-4), from S17: Pyodide in a dedicated module worker, with no DOM. It loads
// the interpreter and the packages from the build's own `py/pyodide/` folder, then, before any
// script runs, takes away every global a script could use to reach the network, storage or
// other contexts, keeping a private `postMessage` for the bridge. Python reaches the page only
// through `_wrx_bridge.call(op, payload)`, strings in and out, and the page decides what each
// call may do; events for a run's subscriptions come back through `_wrx_bridge.next_event`
// (WP 6.4). The SDK, `wrx` (python/wrx), is written into Pyodide's file system; `wrx.Game()`
// finds the bridge.
//
// The lockdown cannot remove `eval`, `Function` or `import()`: the worker's policy does. The
// runner creates this worker from a `blob:` bootstrap so that it runs under the page's policy,
// header or `<meta>` (S17 item 5).
import type { PyodideAPI } from 'pyodide'
import type { InitMessage, RunMessage, ToWorker } from './protocol.ts'

/** The SDK's sources, bundled into this worker: `wrx/__init__.py` and the rest. */
const SDK_SOURCES = import.meta.glob<string>('../../../python/wrx/**/*.py', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SDK_HOME = '/home/pyodide/'
/** What `import wrx` needs; pydantic is in the build (PY-1), loaded at the first run using it. */
const SDK_PACKAGES = Object.freeze(['pydantic'])
/** Uses of the SDK's tabular helpers, which import pandas only when called (PY-3). */
const USES_FRAMES = /\bto_frame\b|\bwrx\.frames\b|\bfrom\s+wrx\s+import\b[^\n]*\bframes\b/
/** A script that names the SDK (`import wrx`, `import sys, wrx`, `from wrx import ...`). */
const USES_SDK = /\bwrx\b/

interface PyodideFs {
  mkdirTree(path: string): void
  writeFile(path: string, data: string): void
}

/** Writes the SDK and the runner's module into the interpreter's home folder, on `sys.path`. */
function installSdk(api: PyodideAPI): void {
  const fs = api.FS as PyodideFs
  const files = Object.entries(SDK_SOURCES).map(
    ([path, source]) => [path.slice(path.indexOf('/python/') + '/python/'.length), source] as const,
  )
  if (!files.some(([path]) => path === 'wrx/__init__.py')) throw new Error('the SDK is missing')
  for (const [path, source] of files) {
    fs.mkdirTree(SDK_HOME + path.slice(0, path.lastIndexOf('/')))
    fs.writeFile(SDK_HOME + path, source)
  }
}

const started = performance.now()
// Captured before the lockdown removes them from the global scope.
const post: (message: unknown) => void = self.postMessage.bind(self)
const nativeFetch: typeof fetch = self.fetch.bind(self)

const MAX_TEXT = 100_000
const MAX_ERROR = 4_000

/** Bytes of the interpreter's linear memory. */
function wasmMemory(pyodide: PyodideAPI | undefined): number {
  const module = (pyodide as unknown as { _module?: { HEAPU8?: Uint8Array } } | undefined)?._module
  return module?.HEAPU8?.byteLength ?? 0
}

/**
 * The only fetch left after the lockdown: a GET of a file under the Pyodide folder, which the
 * build fills with the core and the shipped wheels. A script that reaches it can load a shipped
 * package, which `import` would do anyway, and nothing else.
 */
function guardedFetch(indexURL: string): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), indexURL)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (!url.href.startsWith(indexURL) || method !== 'GET' || url.search !== '') {
      return Promise.reject(new TypeError(`fetch refused by the script sandbox: ${url.href}`))
    }
    return nativeFetch(url.href, { integrity: init?.integrity ?? '', credentials: 'same-origin' })
  }
}

/** Globals a script must not reach (PY-4): network, storage, other contexts, script loading. */
export const REMOVED_GLOBALS = Object.freeze([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'cookieStore',
  'BroadcastChannel',
  'Worker',
  'SharedWorker',
  'postMessage',
  'MessageChannel',
  'FileSystemHandle',
  'StorageManager',
  'Notification',
  'webkitRequestFileSystem',
  'webkitResolveLocalFileSystemURL',
] as const)
const REMOVED_FROM_NAVIGATOR = Object.freeze([
  'storage',
  'locks',
  'serviceWorker',
  'usb',
  'serial',
  'hid',
] as const)

/** Removes a property from an object and every prototype above it. */
function strip(target: object, name: string): void {
  for (let o: object | null = target; o !== null; o = Object.getPrototypeOf(o) as object | null) {
    const descriptor = Object.getOwnPropertyDescriptor(o, name)
    if (descriptor === undefined) continue
    if (descriptor.configurable === true) {
      Reflect.deleteProperty(o, name)
    } else if (descriptor.writable === true) {
      Reflect.set(o, name, undefined)
    }
  }
}

function lockdown(indexURL: string): void {
  for (const name of REMOVED_GLOBALS) strip(self, name)
  for (const name of REMOVED_FROM_NAVIGATOR) strip(navigator, name)
  // Pyodide's own loader calls the global `fetch` when a script imports a shipped package.
  Object.defineProperty(self, 'fetch', { value: guardedFetch(indexURL), configurable: false })
}

/** The `js` module a script sees: timers only (asyncio needs them), never the global scope. */
function scriptGlobals(): object {
  const timers = {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => {
      clearTimeout(id)
    },
  }
  return Object.freeze(Object.assign(Object.create(null) as object, timers))
}

/** Events the worker keeps for a run until its script takes them; past it the oldest go. */
export const MAX_QUEUED_EVENTS = 1_000

/** The worker's state, and its message handler: one run at a time. */
function serve(): void {
  let pyodide: PyodideAPI | undefined
  let nextCall = 1
  const pending = new Map<number, (result: string) => void>()
  let currentRun = 0
  let running = false
  // Events for the current run (WP 6.4), and the script waiting for one, if it is.
  const events: string[] = []
  let dropped = 0
  let waiting: { resolve: (event: string | null) => void; timer: number | undefined } | undefined

  function deliver(event: string | null): void {
    const w = waiting
    if (w === undefined) return
    waiting = undefined
    if (w.timer !== undefined) clearTimeout(w.timer)
    w.resolve(event)
  }

  function output(stream: 'stdout' | 'stderr', text: string): void {
    if (running) post({ kind: 'output', runId: currentRun, stream, text: text.slice(0, MAX_TEXT) })
  }

  async function init(message: InitMessage): Promise<void> {
    if (pyodide !== undefined) throw new Error('already initialised')
    const { loadPyodide } = (await import(
      /* @vite-ignore */ `${message.indexURL}pyodide.mjs`
    )) as typeof import('pyodide')
    const api = await loadPyodide({
      indexURL: message.indexURL,
      jsglobals: scriptGlobals(),
      // The lock file the build trimmed to the shipped packages; relative wheels resolve to it.
      lockFileURL: `${message.indexURL}pyodide-lock.json`,
      packageBaseUrl: message.indexURL,
      stdout: (text: string) => {
        output('stdout', text)
      },
      stderr: (text: string) => {
        output('stderr', text)
      },
    })
    pyodide = api
    const loaded = performance.now()
    if (message.packages.length > 0) {
      await api.loadPackage([...message.packages], { messageCallback: () => undefined })
    }
    const packagesDone = performance.now()
    api.registerJsModule('_wrx_bridge', {
      // The one function a script gets from the page: an operation name and a JSON string.
      call: (op: unknown, payload: unknown) =>
        new Promise<string>((resolve) => {
          const callId = nextCall++
          pending.set(callId, resolve)
          post({
            kind: 'call',
            runId: currentRun,
            callId,
            op: String(op),
            payload: String(payload),
          })
        }),
      // The next event of the run's subscriptions, as JSON text, or null when `timeoutMs` (if
      // given, and not negative) passes first. One waiter at a time; a second takes its place.
      next_event: (timeoutMs: unknown) =>
        new Promise<string | null>((resolve) => {
          deliver(null)
          const queued = events.shift()
          if (queued !== undefined) {
            resolve(queued)
            return
          }
          const ms = typeof timeoutMs === 'number' && timeoutMs >= 0 ? timeoutMs : undefined
          const timer =
            ms === undefined
              ? undefined
              : (setTimeout(() => {
                  deliver(null)
                }, ms) as unknown as number)
          waiting = { resolve, timer }
        }),
      // How many events were dropped because the script did not take them in time.
      dropped_events: () => dropped,
    })
    installSdk(api)
    lockdown(message.indexURL)
    // The worker's own step, after the lockdown and before any script: a fresh interpreter for
    // each run (M1) then starts with the SDK imported, as the previous run's interpreter had it.
    if (message.preimportSdk) {
      await api.loadPackage([...SDK_PACKAGES], { messageCallback: () => undefined })
      const sdk = api.pyimport('wrx') as { destroy?: () => void }
      sdk.destroy?.()
    }
    const sdkDone = performance.now()
    post({
      kind: 'ready',
      timings: {
        loadPyodide: loaded - started,
        loadPackages: packagesDone - loaded,
        importSdk: sdkDone - packagesDone,
        wasmMemory: wasmMemory(pyodide),
      },
    })
  }

  async function run(message: RunMessage): Promise<void> {
    const api = pyodide
    if (api === undefined || running) return
    running = true
    currentRun = message.runId
    events.length = 0
    dropped = 0
    deliver(null)
    const t0 = performance.now()
    const globals = api.toPy({ __name__: '__main__' }) as { destroy(): void }
    try {
      // Shipped packages the script imports load now, only when used (PY-3), from the build.
      await api.loadPackagesFromImports(message.code, { messageCallback: () => undefined })
      const needs = [
        ...(USES_SDK.test(message.code) ? SDK_PACKAGES : []),
        ...(USES_FRAMES.test(message.code) ? ['pandas'] : []),
      ]
      if (needs.length > 0) await api.loadPackage(needs, { messageCallback: () => undefined })
      const imports = performance.now() - t0
      // The time limit starts now, on the page (PY-10): start-up and imports are not the script's.
      post({ kind: 'started', runId: message.runId })
      await api.runPythonAsync(message.code, { globals: globals as never })
      post({
        kind: 'done',
        runId: message.runId,
        ok: true,
        ms: performance.now() - t0,
        importsMs: imports,
        wasmMemory: wasmMemory(pyodide),
      })
    } catch (error) {
      post({
        kind: 'done',
        runId: message.runId,
        ok: false,
        error: String(error).slice(-MAX_ERROR),
        ms: performance.now() - t0,
        wasmMemory: wasmMemory(pyodide),
      })
    } finally {
      running = false
      globals.destroy()
    }
  }

  self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
    const message = event.data
    if (message.kind === 'init') {
      init(message).catch((error: unknown) => {
        post({ kind: 'init-failed', error: String(error).slice(-MAX_ERROR) })
      })
    } else if (message.kind === 'run') {
      void run(message)
    } else if (message.kind === 'event') {
      if (!running || message.runId !== currentRun) return
      if (waiting !== undefined) {
        deliver(message.event)
      } else {
        events.push(message.event)
        if (events.length > MAX_QUEUED_EVENTS) {
          events.shift()
          dropped++
        }
      }
    } else {
      pending.get(message.callId)?.(message.result)
      pending.delete(message.callId)
    }
  })
  // The worker listens: a `blob:` bootstrap imports this module after its own script ends, so a
  // message the page sent before this would be lost.
  post({ kind: 'hello' })
}

serve()
