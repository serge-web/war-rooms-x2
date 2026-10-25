// Thin `useSyncExternalStore` wrappers over the pane's session store (ARC-3). Each returns the
// store's `{data, status, error}` snapshot unchanged. Hooks that need a node or room acquire it
// inside `subscribe` and release it in the cleanup, so React StrictMode's double mount
// balances, and the store's deferred release absorbs the remount without network churn.
import { effectiveAccess, safeNodeName } from '@wrx/domain'
import type {
  AccessInput,
  AccessMatrix,
  AnnouncementEntry,
  Author,
  LiveDocument,
  Me,
  Occupant,
  Release,
  RoomView,
  SessionStore,
  Snapshot,
  StoreStatus,
} from '@wrx/domain'
import type { Asset, Force, GameSetup, Objectives, Role, Room } from '@wrx/schemas'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useSessionStore } from './context.ts'

export type { Snapshot }

/**
 * The shared plumbing: subscribe (acquiring first, when asked) and read a snapshot. `key`
 * identifies what is acquired, so a change of node or room re-subscribes.
 */
function useStoreSnapshot<T>(
  read: (store: SessionStore) => Snapshot<T>,
  acquire: ((store: SessionStore) => Release) | undefined,
  key: string,
): Snapshot<T> {
  const store = useSessionStore()
  // `read` and `acquire` are recreated each render; `key` says when they mean something new.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const release = acquire?.(store)
      const unsubscribe = store.subscribe(onChange)
      return () => {
        unsubscribe()
        release?.()
      }
    },
    [store, key],
  )
  const getSnapshot = () => read(store)
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Acquires a node, unless the id was invalid: then the store answers with an `invalid` error. */
function acquireNode(node: string | undefined): ((store: SessionStore) => Release) | undefined {
  return node === undefined ? undefined : (store) => store.acquire(node)
}

export function useSessionStatus(): Snapshot<StoreStatus> {
  return useStoreSnapshot((s) => s.sessionStatus(), undefined, 'status')
}

/** Any node's newest document; acquires the node while mounted. */
export function useDocument(node: string): Snapshot<LiveDocument | undefined> {
  return useStoreSnapshot((s) => s.document(node), acquireNode(node), `document:${node}`)
}

export function useGameSetup(): Snapshot<GameSetup | undefined> {
  return useStoreSnapshot(
    (s) => s.gameSetup(),
    (s) => s.acquire('game-setup'),
    'game-setup',
  )
}

export function useForces(): Snapshot<readonly Force[]> {
  return useStoreSnapshot((s) => s.forces(), undefined, 'forces')
}

export function useRoles(): Snapshot<readonly Role[]> {
  return useStoreSnapshot((s) => s.roles(), undefined, 'roles')
}

export function useRooms(): Snapshot<readonly Room[]> {
  return useStoreSnapshot((s) => s.rooms(), undefined, 'rooms')
}

export function useForce(forceId: string): Snapshot<Force | undefined> {
  const node = safeNodeName('force', forceId)
  return useStoreSnapshot((s) => s.force(forceId), acquireNode(node), `force:${forceId}`)
}

export function useRole(roleId: string): Snapshot<Role | undefined> {
  const node = safeNodeName('role', roleId)
  return useStoreSnapshot((s) => s.role(roleId), acquireNode(node), `role:${roleId}`)
}

export function useRoom(roomId: string): Snapshot<Room | undefined> {
  const node = safeNodeName('room', roomId)
  return useStoreSnapshot((s) => s.room(roomId), acquireNode(node), `room:${roomId}`)
}

/** A force's objectives (PLY-25, PLY-35). Readable by that force, umpires and the admin. */
export function useObjectives(forceId: string): Snapshot<Objectives | undefined> {
  const node = safeNodeName('objectives', forceId)
  return useStoreSnapshot((s) => s.objectives(forceId), acquireNode(node), `objectives:${forceId}`)
}

/** An asset, fetched on demand: assets are large, so the store holds only those in use. */
export function useAsset(assetId: string): Snapshot<Asset | undefined> {
  const node = safeNodeName('asset', assetId)
  return useStoreSnapshot((s) => s.asset(assetId), acquireNode(node), `asset:${assetId}`)
}

/** Announcements, oldest first (PLY-37, PLY-38). */
export function useAnnouncements(): Snapshot<readonly AnnouncementEntry[]> {
  return useStoreSnapshot(
    (s) => s.announcements(),
    (s) => s.acquire('announcements'),
    'announcements',
  )
}

/** This session's identity, role, force and visible rooms (PLY-4, PLY-25). */
export function useMe(): Snapshot<Me> {
  return useStoreSnapshot((s) => s.me(), undefined, 'me')
}

/** Message author display data, keyed by role id (§3 rule 6). */
export function useAuthors(): Snapshot<ReadonlyMap<string, Author>> {
  return useStoreSnapshot((s) => s.authors(), undefined, 'authors')
}

/** Effective access from the live documents (§3 rule 4). */
export function useEffectiveAccess(): Snapshot<AccessMatrix> {
  return useStoreSnapshot((s) => s.access(), undefined, 'access')
}

/**
 * Effective access for a design being edited (ADM-9), from the same function as the player
 * uses. Pure: needs no store, and recomputes only when the input changes.
 */
export function useDesignAccess(input: AccessInput): AccessMatrix {
  return useMemo(() => effectiveAccess(input), [input])
}

/** A room's messages and state; joins the room while mounted (PLY-9, PLY-49). */
export function useRoomMessages(roomId: string): Snapshot<RoomView | undefined> {
  return useStoreSnapshot(
    (s) => s.roomView(roomId),
    (s) => s.acquireRoom(roomId),
    `room-view:${roomId}`,
  )
}

/** Who is in a room (PLY-13); joins the room while mounted. */
export function useOccupants(roomId: string): Snapshot<readonly Occupant[]> {
  return useStoreSnapshot(
    (s) => s.occupants(roomId),
    (s) => s.acquireRoom(roomId),
    `occupants:${roomId}`,
  )
}
