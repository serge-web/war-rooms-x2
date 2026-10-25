// The browser APIs the host uses, behind small interfaces so that unit tests can run the leader
// election in Node with stand-ins, and so a missing API is a fallback rather than a crash.
import { IndexedDbStore, UnavailableStore } from './store.ts'
import type { StateStore } from './store.ts'

export interface LockOptions {
  readonly steal?: boolean
  readonly ifAvailable?: boolean
}

/** The part of the Web Locks API (`navigator.locks`) the host uses. */
export interface Locks {
  request(
    name: string,
    options: LockOptions,
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>
}

/** One end of a message channel: a BroadcastChannel, or a SharedWorker's port. */
export interface Channel {
  post(message: unknown): void
  listen(listener: (data: unknown) => void): void
  close(): void
}

/** A SharedWorker as the tab sees it. */
export interface WorkerHandle {
  readonly port: Channel
  /** The worker script failed to load or run. */
  onError(listener: (reason: string) => void): void
}

export interface HostEnvironment {
  /** The document's base URL, from which the deployment's base path is taken (DOC-10). */
  readonly baseURI: string
  readonly locks: Locks | undefined
  readonly openChannel: ((name: string) => Channel) | undefined
  /** Starts (or joins) the SharedWorker with this name. Undefined without SharedWorker. */
  readonly startWorker: ((name: string) => WorkerHandle) | undefined
  readonly openStore: (name: string) => StateStore
  /** Called when the page is being unloaded; returns a function that stops listening. */
  readonly onPageHide: (listener: () => void) => () => void
  /** localStorage, if this context may use it. */
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined
  readonly randomId: () => string
}

function randomId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // randomUUID needs a secure context; ids here only need to be unique between tabs.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

function broadcastChannel(name: string): Channel {
  const channel = new BroadcastChannel(name)
  return {
    post: (message) => {
      channel.postMessage(message)
    },
    listen: (listener) => {
      channel.onmessage = (event: MessageEvent<unknown>) => {
        listener(event.data)
      }
    },
    close: () => {
      channel.close()
    },
  }
}

export function portChannel(port: MessagePort): Channel {
  return {
    post: (message) => {
      port.postMessage(message)
    },
    listen: (listener) => {
      port.onmessage = (event: MessageEvent<unknown>) => {
        listener(event.data)
      }
      port.start()
    },
    close: () => {
      port.close()
    },
  }
}

/**
 * The SharedWorker. Vite bundles `worker.ts` because of this exact `new SharedWorker(new
 * URL(...), ...)` form, under any base path (DOC-11): the URL is relative to this module.
 */
function sharedWorker(name: string): WorkerHandle {
  const worker = new SharedWorker(new URL('./worker.ts', import.meta.url), { type: 'module', name })
  return {
    port: portChannel(worker.port),
    onError: (listener) => {
      worker.onerror = (event: Event) => {
        listener(event instanceof ErrorEvent ? event.message : 'the SharedWorker failed')
      }
    },
  }
}

function localStorageOrUndefined(): HostEnvironment['storage'] {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    // Access throws where storage is blocked.
    return undefined
  }
}

/** The real browser APIs, where they exist. */
export function browserEnvironment(): HostEnvironment {
  const nav: Partial<Navigator> = typeof navigator === 'undefined' ? {} : navigator
  const locks: Locks | undefined = nav.locks
  return {
    baseURI: typeof document === 'undefined' ? '/' : document.baseURI,
    locks,
    openChannel: typeof BroadcastChannel === 'undefined' ? undefined : broadcastChannel,
    startWorker: typeof SharedWorker === 'undefined' ? undefined : sharedWorker,
    openStore: (name) => {
      try {
        if (typeof indexedDB === 'undefined') return new UnavailableStore('no IndexedDB')
        return new IndexedDbStore(indexedDB, name)
      } catch (error) {
        return new UnavailableStore(error instanceof Error ? error.message : 'no IndexedDB')
      }
    },
    onPageHide: (listener) => {
      if (typeof addEventListener === 'undefined') return () => undefined
      addEventListener('pagehide', listener)
      return () => {
        removeEventListener('pagehide', listener)
      }
    },
    storage: localStorageOrUndefined(),
    randomId,
  }
}
