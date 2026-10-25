// Where the host keeps the mock database between visits (ARC-7, DOC-17): one JSON document in
// IndexedDB, under the deployment's own database name (DOC-10). A tiny wrapper of our own, so
// the host has no runtime dependency beyond the workspace.

/** One stored document, read back as untrusted data. */
export interface StateStore {
  /** The stored value, or undefined when nothing is stored. Rejects if storage is unusable. */
  load(): Promise<unknown>
  save(json: string): Promise<void>
  clear(): Promise<void>
  close(): void
}

const STORE = 'state'
const KEY = 'current'

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'))
    }
  })
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve()
    }
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    }
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'))
    }
  })
}

/** The IndexedDB database `name`, with one object store holding the state under one key. */
export class IndexedDbStore implements StateStore {
  private db: Promise<IDBDatabase> | undefined

  constructor(
    private readonly factory: IDBFactory,
    private readonly name: string,
  ) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.name, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE)
        }
      }
      request.onsuccess = () => {
        const db = request.result
        // Another context deleting or upgrading the database: let it, and reopen next time.
        db.onversionchange = () => {
          db.close()
          this.db = undefined
        }
        resolve(db)
      }
      request.onerror = () => {
        reject(request.error ?? new Error(`cannot open IndexedDB ${this.name}`))
      }
      request.onblocked = () => {
        reject(new Error(`IndexedDB ${this.name} is blocked by another tab`))
      }
    })
    this.db.catch(() => {
      this.db = undefined
    })
    return this.db
  }

  async load(): Promise<unknown> {
    const db = await this.open()
    const tx = db.transaction(STORE, 'readonly')
    const value: unknown = await promised(tx.objectStore(STORE).get(KEY))
    return value
  }

  async save(json: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(json, KEY)
    await completed(tx)
  }

  async clear(): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    await completed(tx)
  }

  close(): void {
    void this.db?.then((db) => {
      db.close()
    })
    this.db = undefined
  }
}

/** For tests, and when IndexedDB is unavailable: nothing survives the context. */
export class MemoryStore implements StateStore {
  constructor(private value?: unknown) {}

  get current(): unknown {
    return this.value
  }

  load(): Promise<unknown> {
    return Promise.resolve(this.value)
  }

  save(json: string): Promise<void> {
    this.value = json
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.value = undefined
    return Promise.resolve()
  }

  close(): void {
    // Nothing to release.
  }
}

/** Fails every call, as IndexedDB does in some private modes. */
export class UnavailableStore implements StateStore {
  constructor(private readonly reason: string) {}

  load(): Promise<unknown> {
    return Promise.reject(new Error(this.reason))
  }

  save(): Promise<void> {
    return Promise.reject(new Error(this.reason))
  }

  clear(): Promise<void> {
    return Promise.reject(new Error(this.reason))
  }

  close(): void {
    // Nothing to release.
  }
}
