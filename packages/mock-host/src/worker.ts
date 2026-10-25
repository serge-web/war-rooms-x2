// The SharedWorker entry (D17): bundled by Vite from env.ts's `new SharedWorker(new URL(...))`.
// Everything the worker holds lives inside serveSharedWorker's closure, not in this module.
import { portChannel } from './env.ts'
import type { Locks } from './env.ts'
import { IndexedDbStore, UnavailableStore } from './store.ts'
import { serveSharedWorker } from './worker-host.ts'

/** The parts of SharedWorkerGlobalScope used here; the DOM lib does not describe workers. */
interface SharedWorkerScope {
  readonly name: string
  readonly navigator: { readonly locks?: Locks }
  readonly indexedDB?: IDBFactory
  addEventListener(type: 'connect', listener: (event: MessageEvent) => void): void
}

function main(scope: SharedWorkerScope): void {
  const worker = serveSharedWorker({
    name: scope.name,
    locks: scope.navigator.locks,
    openStore: (name) =>
      scope.indexedDB === undefined
        ? new UnavailableStore('no IndexedDB in this worker')
        : new IndexedDbStore(scope.indexedDB, name),
    log: (entry) => {
      console.warn(entry.message, entry.detail)
    },
  })
  scope.addEventListener('connect', (event) => {
    const [port] = event.ports
    if (port !== undefined) worker.connect(portChannel(port))
  })
}

main(globalThis as unknown as SharedWorkerScope)
