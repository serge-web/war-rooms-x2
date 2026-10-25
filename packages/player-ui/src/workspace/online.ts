// Who is online (PLY-8): the occupants of every room this role can see, merged by role. The
// hooks package has `useOccupants` for one room; a list of rooms needs one subscription that
// acquires them all, so this composes the store's own `acquireRoom` and `occupants` the same way
// `@wrx/hooks` does, and returns a stable snapshot while nothing changes.
import type { Occupant } from '@wrx/domain'
import { useSessionStore } from '@wrx/hooks'
import { useCallback, useRef, useSyncExternalStore } from 'react'

/** Each room's occupants, in the order of `roomIds`. Joins the rooms while mounted. */
export function useOccupantsOf(roomIds: readonly string[]): readonly (readonly Occupant[])[] {
  const store = useSessionStore()
  const key = roomIds.join(' ')
  const cache = useRef<readonly (readonly Occupant[])[]>([])
  const subscribe = useCallback(
    (onChange: () => void) => {
      const releases = key === '' ? [] : key.split(' ').map((id) => store.acquireRoom(id))
      const unsubscribe = store.subscribe(onChange)
      return () => {
        unsubscribe()
        for (const release of releases) release()
      }
    },
    [store, key],
  )
  const getSnapshot = () => {
    const lists = roomIds.map((id) => store.occupants(id).data)
    const previous = cache.current
    if (previous.length === lists.length && previous.every((list, i) => list === lists[i])) {
      return previous
    }
    cache.current = lists
    return lists
  }
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
