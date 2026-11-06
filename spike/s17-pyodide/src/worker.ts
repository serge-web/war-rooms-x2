// The script worker (PY-4): Pyodide in a dedicated module worker, with no DOM. It loads the
// interpreter and the packages from the build's own `pyodide/` folder, then (with `lockdown`)
// takes away every global a script could use to reach the network, storage or other contexts,
// keeping a private `postMessage` for the bridge. Python reaches the page only through
// `_wrx_bridge.call(op, payload)`, strings in and out, and the page decides what each call may do.
import type { PyodideAPI } from 'pyodide'
import type { InitMessage, RunMessage, ToWorker } from './protocol.ts'
import wrxSource from './wrx.py?raw'

const started = performance.now()
// Captured before the lockdown removes them from the global scope.
const post: (message: unknown) => void = self.postMessage.bind(self)
const nativeFetch: typeof fetch = self.fetch.bind(self)

let pyodide: PyodideAPI | undefined
let nextCall = 1
const pending = new Map<number, (result: string) => void>()
let currentRun = 0

/** Bytes of the interpreter's linear memory. */
function wasmMemory(): number {
  const module = (pyodide as unknown as { _module?: { HEAPU8?: Uint8Array } } | undefined)?._module
  return module?.HEAPU8?.byteLength ?? 0
}

/**
 * The only fetch left after the lockdown: GET of a file under the Pyodide folder, which the
 * build fills with the core and the shipped wheels. A script that reaches it can load a shipped
 * package, which `import` would do anyway, and nothing else.
 */
function guardedFetch(indexURL: string): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), indexURL)
    if (!url.href.startsWith(indexURL) || (init?.method ?? 'GET') !== 'GET') {
      return Promise.reject(new TypeError(`fetch refused by the script sandbox: ${url.href}`))
    }
    return nativeFetch(url.href, { integrity: init?.integrity ?? '' })
  }
}

/** Globals a script must not reach (PY-4): network, storage, other contexts, script loading. */
const REMOVED = [
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
] as const
const REMOVED_FROM_NAVIGATOR = ['storage', 'locks', 'serviceWorker', 'usb', 'serial', 'hid'] as const

/** Removes a property from an object and every prototype above it. */
function strip(target: object, name: string): void {
  for (let o: object | null = target; o !== null; o = Object.getPrototypeOf(o)) {
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
  for (const name of REMOVED) strip(self, name)
  for (const name of REMOVED_FROM_NAVIGATOR) strip(navigator, name)
  // Pyodide's own loader calls the global `fetch` when a script imports a shipped package.
  Object.defineProperty(self, 'fetch', { value: guardedFetch(indexURL), configurable: false })
}

/** The `js` module a script sees: timers only (asyncio needs them), never the global scope. */
function scriptGlobals(): object {
  const timers = {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  }
  return Object.freeze(Object.assign(Object.create(null) as object, timers))
}

async function init(message: InitMessage): Promise<void> {
  const { loadPyodide } = (await import(
    /* @vite-ignore */ `${message.indexURL}pyodide.mjs`
  )) as typeof import('pyodide')
  const api = await loadPyodide({
    indexURL: message.indexURL,
    jsglobals: message.lockdown ? scriptGlobals() : globalThis,
    // The lock file the build trimmed to the shipped packages; relative wheels resolve to it.
    lockFileURL: `${message.indexURL}pyodide-lock.json`,
    packageBaseUrl: message.indexURL,
    stdout: (text) => post({ kind: 'output', runId: currentRun, text }),
    stderr: (text) => post({ kind: 'output', runId: currentRun, text }),
  })
  pyodide = api
  const loaded = performance.now()
  if (message.packages.length > 0) {
    await api.loadPackage([...message.packages], { messageCallback: () => undefined })
  }
  const packagesDone = performance.now()
  api.registerJsModule('_wrx_bridge', {
    // The one function a script gets from the page: an operation name and a JSON string.
    call: (op: string, payload: string) =>
      new Promise<string>((resolve) => {
        const callId = nextCall++
        pending.set(callId, resolve)
        post({ kind: 'call', runId: currentRun, callId, op: String(op), payload: String(payload) })
      }),
  })
  api.FS.writeFile('/home/pyodide/wrx.py', wrxSource)
  if (message.lockdown) lockdown(message.indexURL)
  post({
    kind: 'ready',
    timings: {
      loadPyodide: loaded - started,
      loadPackages: packagesDone - loaded,
      wasmMemory: wasmMemory(),
    },
  })
}

async function run(message: RunMessage): Promise<void> {
  const api = pyodide
  if (api === undefined) throw new Error('not initialised')
  currentRun = message.runId
  const t0 = performance.now()
  const wrx = api.pyimport('wrx') as unknown as { _CONTEXT: string; destroy(): void }
  wrx._CONTEXT = message.context
  wrx.destroy()
  const globals = api.toPy({ __name__: '__main__' })
  try {
    // Shipped packages the script imports load now, only when used (PY-3), from the build.
    await api.loadPackagesFromImports(message.code, { messageCallback: () => undefined })
    const imports = performance.now() - t0
    await api.runPythonAsync(message.code, { globals })
    post({
      kind: 'done',
      runId: message.runId,
      ok: true,
      ms: performance.now() - t0,
      importsMs: imports,
      wasmMemory: wasmMemory(),
    })
  } catch (error) {
    post({
      kind: 'done',
      runId: message.runId,
      ok: false,
      error: String(error).slice(-4000),
      ms: performance.now() - t0,
      wasmMemory: wasmMemory(),
    })
  } finally {
    globals.destroy()
  }
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data
  if (message.kind === 'init') {
    init(message).catch((error: unknown) =>
      post({ kind: 'init-failed', error: String(error).slice(-4000) }),
    )
  } else if (message.kind === 'run') {
    void run(message)
  } else if (message.kind === 'reply') {
    pending.get(message.callId)?.(message.result)
    pending.delete(message.callId)
  }
})
post({ kind: 'hello' })
