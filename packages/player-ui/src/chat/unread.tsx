// Unread counts per room (PLY-11). A room's read marker is the newest message seen while its
// panel was on screen; the count is the messages after it that another role sent. The markers
// live in a ReadMarkers object that UnreadProvider makes per session store, so each pane of the
// multi-client view counts on its own (D15) and nothing is held at module level (ARC-2).
//
// The history present when a room is first loaded counts as read: unread counts start at zero
// each session. The markers are not saved across reloads.
import type { TimelineEntry } from '@wrx/domain'
import { useRoomMessages, useSessionStore } from '@wrx/hooks'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { UnreadBadge } from '../workspace/tabs.tsx'
import type { RoomTabBadgeProps } from '../workspace/tabs.tsx'

/** The newest message seen in a room. `ms` is its server time; `-Infinity` before any. */
export interface ReadMarker {
  readonly id: string
  readonly ms: number
}

export const NOTHING_READ: ReadMarker = Object.freeze({ id: '', ms: -Infinity })

/** Read markers by room, with change notification. One per session store. */
export class ReadMarkers {
  private readonly marks = new Map<string, ReadMarker>()
  private readonly listeners = new Set<() => void>()

  get(roomId: string): ReadMarker | undefined {
    return this.marks.get(roomId)
  }

  /** Moves the room's marker to `marker`, unless it is already there or later. */
  mark(roomId: string, marker: ReadMarker): void {
    const current = this.marks.get(roomId)
    if (current !== undefined && (current.id === marker.id || current.ms > marker.ms)) return
    this.marks.set(roomId, marker)
    for (const listener of [...this.listeners]) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** The marker for the newest of `messages`, or {@link NOTHING_READ} when there are none. */
export function markerOf(messages: readonly TimelineEntry[]): ReadMarker {
  const newest = messages[messages.length - 1]
  if (newest === undefined) return NOTHING_READ
  return { id: newest.id, ms: Date.parse(newest.timestamp) }
}

/**
 * Messages after `marker` not sent by this role. Walks back from the newest and stops at the
 * marker, so it costs the number unread, not the room's size (NFR-11).
 */
export function countUnread(
  messages: readonly TimelineEntry[],
  marker: ReadMarker,
  isOwn: (entry: TimelineEntry) => boolean,
): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const entry = messages[i]
    if (entry === undefined || entry.id === marker.id) break
    if (Date.parse(entry.timestamp) < marker.ms) break
    if (!isOwn(entry)) count++
  }
  return count
}

const ReadMarkersContext = createContext<ReadMarkers | undefined>(undefined)

/**
 * Holds the read markers for everything inside it: put it around the `Workspace`, under the
 * pane's SessionStoreProvider. A new store (another login) starts with fresh markers.
 */
export function UnreadProvider({ children }: { readonly children?: ReactNode }) {
  const store = useSessionStore()
  // One set of markers per store: `store` is the dependency even though it is not read.
  const markers = useMemo(() => new ReadMarkers(), [store])
  return <ReadMarkersContext.Provider value={markers}>{children}</ReadMarkersContext.Provider>
}

/** The markers of the enclosing UnreadProvider, if any. */
export function useReadMarkers(): ReadMarkers | undefined {
  return useContext(ReadMarkersContext)
}

function useMarker(markers: ReadMarkers | undefined, roomId: string): ReadMarker | undefined {
  return useSyncExternalStore(
    (onChange) => markers?.subscribe(onChange) ?? (() => undefined),
    () => markers?.get(roomId),
    () => markers?.get(roomId),
  )
}

/** Whether a message came from this session's role, in any of its sessions (D22). */
export function useIsOwn(): (entry: TimelineEntry) => boolean {
  const { identity } = useSessionStore()
  return useMemo(
    () => (entry: TimelineEntry) =>
      entry.sender.jid === identity.bareJid ||
      (identity.roleId !== undefined && entry.sender.roleId === identity.roleId),
    [identity],
  )
}

/** A room's unread count; 0 outside an UnreadProvider. Joins the room while mounted. */
export function useUnreadCount(roomId: string): number {
  const view = useRoomMessages(roomId).data
  const markers = useReadMarkers()
  const marker = useMarker(markers, roomId)
  const isOwn = useIsOwn()
  const messages = view?.messages
  const loaded = view?.historyLoaded === true
  // The first load's history is the baseline: it was there before this session (PLY-11).
  useEffect(() => {
    if (markers !== undefined && marker === undefined && loaded && messages !== undefined) {
      markers.mark(roomId, markerOf(messages))
    }
  }, [markers, marker, loaded, messages, roomId])
  return useMemo(
    () =>
      marker === undefined || messages === undefined ? 0 : countUnread(messages, marker, isOwn),
    [messages, marker, isOwn],
  )
}

/** Marks a room read up to its newest message while `onScreen` (the panel is visible). */
export function useMarkRead(
  roomId: string,
  messages: readonly TimelineEntry[] | undefined,
  loaded: boolean,
  onScreen: boolean,
): void {
  const markers = useReadMarkers()
  useEffect(() => {
    if (markers !== undefined && onScreen && loaded && messages !== undefined) {
      markers.mark(roomId, markerOf(messages))
    }
  }, [markers, roomId, messages, loaded, onScreen])
}

/** The workspace's tab badge for chat rooms (PLY-11): pass it as `tabBadge`. */
export function ChatUnreadBadge({ roomId }: RoomTabBadgeProps) {
  return <UnreadBadge count={useUnreadCount(roomId)} />
}
