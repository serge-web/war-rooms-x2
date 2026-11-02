// A room tab's own state (PLY-54): what a room panel remembers about how the player left it,
// kept in the tab node's `config` so it is saved and restored with the layout (PLY-5) and goes
// back to the defaults on Reset layout (PLY-42). The workspace provides the store; a panel
// rendered without one (a story, the out-of-game column, the admin's preview) keeps the state
// for as long as it is mounted. No layout library here: the standalone chat entry imports it.
import { createContext, useCallback, useContext, useState, useSyncExternalStore } from 'react'

/** What a room tab remembers. Every field is optional: unset means the panel's default. */
export interface RoomTabState {
  /** The composer is collapsed to a bar (PLY-54). */
  readonly composerCollapsed?: boolean | undefined
}

/** A room tab's state as stored, from untrusted JSON: known fields of the right type only. */
export function parseRoomTabState(value: unknown): RoomTabState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const collapsed = (value as { readonly composerCollapsed?: unknown }).composerCollapsed
  return typeof collapsed === 'boolean' ? { composerCollapsed: collapsed } : undefined
}

/** The room tabs' state in one workspace. */
export interface RoomTabStateStore {
  readonly get: (roomId: string) => RoomTabState
  /** Merges `patch` into the room's state; a no-op for a room with no tab. */
  readonly update: (roomId: string, patch: RoomTabState) => void
  /** Called after any change, including a new layout (reset, restore). */
  readonly subscribe: (listener: () => void) => () => void
}

export const RoomTabStateContext = createContext<RoomTabStateStore | undefined>(undefined)

const NO_STORE: RoomTabStateStore = Object.freeze({
  get: () => ({}),
  update: () => undefined,
  subscribe: () => () => undefined,
})

/**
 * Whether the room's composer is collapsed, as the player last left it (undefined: never set,
 * so the panel's default applies), and how to change it. In the workspace this lives in the
 * room's tab (PLY-54); without one, in this component until it unmounts.
 */
export function useComposerCollapsed(
  roomId: string,
): readonly [boolean | undefined, (collapsed: boolean) => void] {
  const provided = useContext(RoomTabStateContext)
  const store = provided ?? NO_STORE
  const stored = useSyncExternalStore(store.subscribe, () => {
    const value = store.get(roomId).composerCollapsed
    return typeof value === 'boolean' ? value : undefined
  })
  const [local, setLocal] = useState<boolean | undefined>(undefined)
  const set = useCallback(
    (collapsed: boolean) => {
      if (provided === undefined) setLocal(collapsed)
      else provided.update(roomId, { composerCollapsed: collapsed })
    },
    [provided, roomId],
  )
  return [provided === undefined ? local : stored, set]
}
