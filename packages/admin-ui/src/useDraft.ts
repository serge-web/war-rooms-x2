// React bindings for the framework-free draft store.
import type { RoomTypeRegistry } from '@wrx/domain'
import { useMemo, useSyncExternalStore } from 'react'
import type { Draft, DraftSnapshot, DraftStore, DraftValidation } from './draft/index.ts'
import { validateDraft } from './draft/index.ts'

/** The store's current draft and its load and save errors; re-renders on each commit. */
export function useDraft(store: DraftStore): DraftSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** The draft's live checks, recomputed only when the design changes. */
export function useDraftValidation(draft: Draft, registry?: RoomTypeRegistry): DraftValidation {
  const design = draft.design
  return useMemo(
    () => validateDraft(design, registry === undefined ? {} : { registry }),
    [design, registry],
  )
}
