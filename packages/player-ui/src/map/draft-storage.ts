// Where the admin's world-state draft is kept (ADM-45, R25; WP 5.6): this browser's storage only,
// under a key per server and map room (`worldDraftKey`), which the host puts under the
// deployment's namespace (DOC-10). Every view in the tab that reads a key is told when it
// changes: the map room's editor, the turn panel and the admin backend's export, and other tabs
// of this browser through the `storage` event. A write that the browser refuses (blocked or full
// storage) is reported, and the draft then lasts until reload.
import type { WorldState } from '@wrx/schemas'

/** The subset of the Web Storage API used. */
export interface DraftStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** A state just published from a draft, shown until the room's echo replaces the one before. */
export interface JustPublished {
  readonly state: WorldState
  /** The stanza-id of the published state it replaces; undefined if there was none. */
  readonly replacing: string | undefined
}

/** What a key holds now: the stored text, and a state just published from it. */
export interface DraftSnapshot {
  readonly text: string | undefined
  readonly published: JustPublished | undefined
}

export interface WorldDraftStorage {
  /** What the key holds; the same object until it changes, for `useSyncExternalStore`. */
  snapshot(key: string): DraftSnapshot
  /** Saves; returns why the browser refused, if it did (the text is kept until reload). */
  save(key: string, text: string): string | undefined
  /** Removes the draft, e.g. "Discard draft" or a publish. */
  remove(key: string): void
  /**
   * Removes the draft after it was published, if it is still the text that was published (an
   * edit made meanwhile, in another view, is kept), and remembers the state until the map room
   * holds a newer one than `replacing`.
   */
  published(key: string, text: string, state: WorldState, replacing: string | undefined): void
  /** Called on any change to the key, in this tab or another. */
  subscribe(key: string, listener: () => void): () => void
}

/** Builds a storage over a backing store; `watch` reports changes made by other tabs. */
function createDraftStorage(
  backing: () => DraftStorageLike | undefined,
  storageKey: (key: string) => string,
  watch: ((changed: (fullKey: string | null) => void) => () => void) | undefined,
): WorldDraftStorage {
  const listeners = new Map<string, Set<() => void>>()
  const snapshots = new Map<string, DraftSnapshot>()
  // Text the browser would not keep: held here until reload, so the edit is not lost at once.
  const unsaved = new Map<string, string>()
  const recent = new Map<string, JustPublished>()

  const read = (key: string): string | undefined => {
    const held = unsaved.get(key)
    if (held !== undefined) return held
    try {
      return backing()?.getItem(storageKey(key)) ?? undefined
    } catch {
      return undefined
    }
  }
  const changed = (key: string) => {
    snapshots.delete(key)
    for (const listener of listeners.get(key) ?? []) listener()
  }
  let unwatch: (() => void) | undefined

  return {
    snapshot(key) {
      const text = read(key)
      const published = recent.get(key)
      const last = snapshots.get(key)
      if (last !== undefined && last.text === text && last.published === published) return last
      const next = Object.freeze({ text, published })
      snapshots.set(key, next)
      return next
    },
    save(key, text) {
      recent.delete(key)
      try {
        const target = backing()
        if (target === undefined) throw new Error('browser storage is not available')
        target.setItem(storageKey(key), text)
        unsaved.delete(key)
        return undefined
      } catch (error) {
        unsaved.set(key, text)
        return error instanceof Error ? error.message : String(error)
      } finally {
        changed(key)
      }
    },
    remove(key) {
      unsaved.delete(key)
      recent.delete(key)
      try {
        backing()?.removeItem(storageKey(key))
      } catch {
        // Blocked: nothing was stored either.
      }
      changed(key)
    },
    published(key, text, state, replacing) {
      if (read(key) === text) {
        unsaved.delete(key)
        try {
          backing()?.removeItem(storageKey(key))
        } catch {
          // As above.
        }
      }
      recent.set(key, Object.freeze({ state, replacing }))
      changed(key)
    },
    subscribe(key, listener) {
      let set = listeners.get(key)
      if (set === undefined) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(listener)
      if (unwatch === undefined && watch !== undefined) {
        unwatch = watch((fullKey) => {
          for (const k of listeners.keys()) {
            if (fullKey === null || fullKey === storageKey(k)) changed(k)
          }
        })
      }
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(key)
        if (listeners.size === 0 && unwatch !== undefined) {
          unwatch()
          unwatch = undefined
        }
      }
    },
  }
}

/**
 * Drafts in a Web Storage object (normally `localStorage`) under `storageKey(key)`. `storage` is
 * a function because merely reading `localStorage` throws where storage is blocked. Other tabs'
 * changes arrive through the window's `storage` event.
 */
export function webWorldDraftStorage(
  storage: () => DraftStorageLike,
  storageKey: (key: string) => string = (key) => key,
): WorldDraftStorage {
  return createDraftStorage(
    () => {
      try {
        return storage()
      } catch {
        return undefined
      }
    },
    storageKey,
    (changed) => {
      const onStorage = (event: StorageEvent) => {
        changed(event.key)
      }
      window.addEventListener('storage', onStorage)
      return () => {
        window.removeEventListener('storage', onStorage)
      }
    },
  )
}

/** Drafts in memory: for tests and stories. `failWith` makes every save fail with that reason. */
export function memoryWorldDraftStorage(
  options: { readonly failWith?: string } = {},
): WorldDraftStorage & { readonly entries: ReadonlyMap<string, string> } {
  const entries = new Map<string, string>()
  const backing: DraftStorageLike = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (options.failWith !== undefined) throw new Error(options.failWith)
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }
  return Object.assign(
    createDraftStorage(
      () => backing,
      (key) => key,
      undefined,
    ),
    { entries },
  )
}
