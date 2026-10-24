import {
  createContext,
  useContext,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'

// Per-workspace unread counts. Each workspace owns one store, reached by context, so four
// workspaces on a page share nothing (D15). Tab renderers subscribe to it directly, so a
// count change re-renders one tab label and never the layout.

export interface UnreadStore {
  get(roomId: string): number
  set(roomId: string, count: number): void
  subscribe(listener: () => void): () => void
}

export function createUnreadStore(): UnreadStore {
  const counts = new Map<string, number>()
  const listeners = new Set<() => void>()
  return {
    get: (roomId) => counts.get(roomId) ?? 0,
    set(roomId, count) {
      counts.set(roomId, count)
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const UnreadContext = createContext<UnreadStore | null>(null)

export function UnreadProvider({ store, children }: { store: UnreadStore; children: ReactNode }) {
  return <UnreadContext value={store}>{children}</UnreadContext>
}

function useUnread(roomId: string): number {
  const store = useContext(UnreadContext)
  if (store === null) throw new Error('UnreadProvider missing')
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(roomId),
    () => 0,
  )
}

/** Tab content: the room name and its unread badge (PLY-11). */
export function RoomTabLabel({
  roomId,
  name,
  accent,
}: {
  roomId: string
  name: string
  accent: string
}) {
  const count = useUnread(roomId)
  return (
    <span
      className="room-tab"
      data-room-tab={roomId}
      style={{ '--room-accent': accent } as CSSProperties}
    >
      <span className="room-tab-name">{name}</span>
      {count > 0 && (
        <span className="unread-badge" data-unread={roomId} aria-label={`${count} unread`}>
          {count}
        </span>
      )}
    </span>
  )
}
