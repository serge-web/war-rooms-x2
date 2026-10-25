// The draft store: the current draft, saved on every change, with a subscription for the UI.
// Framework-free; `useDraft` in the React layer reads it through `useSyncExternalStore`.
import type { Draft } from './draft.ts'
import { createDraft } from './draft.ts'
import { browserDraftPersistence, parseStoredDraft, serialiseDraft } from './storage.ts'
import type { DraftPersistence } from './storage.ts'

export interface DraftSnapshot {
  readonly draft: Draft
  /**
   * Why the saved draft could not be read, when it could not. The store then starts from
   * `initial`, and the unreadable text stays in storage until the first change replaces it.
   */
  readonly loadError: string | undefined
  /** Why the last save failed (quota, blocked storage), until a save succeeds. */
  readonly saveError: string | undefined
}

export interface DraftStore {
  readonly getSnapshot: () => DraftSnapshot
  readonly subscribe: (listener: () => void) => () => void
  /** Replaces the draft and saves it. Committing the current draft does nothing. */
  readonly commit: (next: Draft) => void
  /**
   * Forgets the saved draft and starts again from `next`, or from `initial` (after a publish,
   * or "discard"). A given draft is saved at once.
   */
  readonly reset: (next?: Draft) => void
}

export interface DraftStoreOptions {
  readonly persistence: DraftPersistence
  /** The draft to start from when nothing is saved. Default: an empty design. */
  readonly initial?: () => Draft
}

export function createDraftStore(options: DraftStoreOptions): DraftStore {
  const { persistence } = options
  const initial = options.initial ?? (() => createDraft())
  const listeners = new Set<() => void>()

  let snapshot: DraftSnapshot = loadSnapshot()

  function loadSnapshot(): DraftSnapshot {
    let text: string | undefined
    try {
      text = persistence.load()
    } catch (error) {
      return { draft: initial(), loadError: describe(error), saveError: undefined }
    }
    if (text === undefined) return { draft: initial(), loadError: undefined, saveError: undefined }
    const parsed = parseStoredDraft(text)
    return parsed.ok
      ? { draft: parsed.value, loadError: undefined, saveError: undefined }
      : { draft: initial(), loadError: parsed.error, saveError: undefined }
  }

  function save(draft: Draft): string | undefined {
    try {
      persistence.save(serialiseDraft(draft))
      return undefined
    } catch (error) {
      return describe(error)
    }
  }

  function publish(next: DraftSnapshot) {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    commit: (next) => {
      if (next === snapshot.draft) return
      publish({ draft: next, loadError: snapshot.loadError, saveError: save(next) })
    },
    reset: (next) => {
      let saveError: string | undefined
      try {
        persistence.clear()
      } catch (error) {
        saveError = describe(error)
      }
      const draft = next ?? initial()
      if (next !== undefined) saveError = save(draft) ?? saveError
      publish({ draft, loadError: undefined, saveError })
    },
  }
}

/**
 * A store over `localStorage` under `key`. Hosts key it by server; mock deployments use
 * mock-host's `names.storageKey('admin-draft')`.
 */
export function createBrowserDraftStore(
  key: string,
  options: Omit<DraftStoreOptions, 'persistence'> = {},
): DraftStore {
  return createDraftStore({ ...options, persistence: browserDraftPersistence(key) })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
