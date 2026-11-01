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
  RoomTemplates,
  RoomView,
  SessionStore,
  Snapshot,
  StoreStatus,
  TimelineEntry,
} from '@wrx/domain'
import type {
  Asset,
  Force,
  GameSetup,
  Objectives,
  Retired,
  Role,
  Room,
  Template,
} from '@wrx/schemas'
import type { TemplateCheck } from '@wrx/templates'
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

/**
 * Deleted forces and roles, by their last names (§3 rule 1, TPL-9): so a template card or picker
 * still names a GUID whose force or role is gone, marked deleted; live.
 */
export function useRetired(): Snapshot<readonly Retired[]> {
  return useStoreSnapshot((s) => s.retired(), undefined, 'retired')
}

/** Every message template in the game, by name (Annex A, TPL-1); live. */
export function useTemplates(): Snapshot<readonly Template[]> {
  return useStoreSnapshot((s) => s.templates(), undefined, 'templates')
}

/**
 * What a room offers the current role for posting (TD3, TD4), live: `data.freeText`, and
 * `data.templates`, the templates it may use there in the room config's order (none for an
 * observer; every template the room names for the admin and the White Force's writers);
 * `data.config` is the room's chat config, version 2. The composer's source (WP 4.2).
 */
export function useRoomTemplates(roomId: string): Snapshot<RoomTemplates> {
  return useStoreSnapshot((s) => s.roomTemplates(roomId), undefined, `room-templates:${roomId}`)
}

/**
 * The receiver's check of a timeline entry (TPL-6), re-run live as templates, the room's config
 * and the documents change: `undefined` for a message that is not templated, else `valid` (show
 * the card), `invalid` (plain text with a warning) or `not-permitted` (the card with a warning).
 */
export function useTemplateCheck(entry: TimelineEntry): TemplateCheck | undefined {
  const store = useSessionStore()
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store])
  const getSnapshot = () => (entry.kind === 'message' ? store.checkTemplate(entry) : undefined)
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
