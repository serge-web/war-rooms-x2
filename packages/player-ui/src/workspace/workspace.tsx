// The workspace slot of the player shell (WP 2.5): WorkspaceCore over the pane's store. One tab
// per room the role can see (PLY-4), each the room type's player component in the room's theme,
// plus the game info and online panels (PLY-8). The layout is saved per server, role and design
// version (PLY-5) in the storage the host passes in; a new design version during the session (a
// structural change, §3 rule 8) resets it to the default, with a notice (PLY-5, R28).
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import { useGameSetup, useMe } from '@wrx/hooks'
import type { AdminEditor, PlayerPanel, ReactRoomTypeRegistry } from '@wrx/hooks'
import { Spinner, useOptionalToast } from '@wrx/ui'
import { useCallback, useEffect, useRef } from 'react'
import { GameInfoPanel, OnlinePanel, RoomPanel } from './panels.tsx'
import { layoutKey } from './storage.ts'
import type { LayoutStorage } from './storage.ts'
import type { RoomTabBadge } from './tabs.tsx'
import { WorkspaceCore } from './workspace-core.tsx'

/** The v1 room types with no player components yet: every room shows a placeholder. */
const EMPTY_REGISTRY: ReactRoomTypeRegistry = withSlots<PlayerPanel, AdminEditor>(
  defaultRoomTypes(),
  {},
)

export interface WorkspaceProps {
  /**
   * Where layouts are saved, e.g. `webLayoutStorage(() => localStorage, names.storageKey)`.
   * Without it the layout lasts until logout.
   */
  readonly storage?: LayoutStorage | undefined
  /** Room types with their player components (WP 2.6 fills `chat`). */
  readonly registry?: ReactRoomTypeRegistry | undefined
  /** The unread-count slot on room tabs (PLY-11, WP 2.6). */
  readonly tabBadge?: RoomTabBadge | undefined
}

/**
 * PLY-30: a room the role loses during play (a force move, a participant change, the room
 * removed) closes, and the player is told which, in a toast. Only for rooms seen in this
 * session: the first room list after login says nothing.
 */
function useClosedRoomNotice(
  rooms: readonly { readonly room: { readonly id: string; readonly name: string } }[] | undefined,
): void {
  const toast = useOptionalToast()
  const shown = useRef<ReadonlyMap<string, string> | undefined>(undefined)
  useEffect(() => {
    if (rooms === undefined) return
    const now = new Map(rooms.map(({ room }) => [room.id, room.name]))
    const before = shown.current
    shown.current = now
    if (before === undefined || toast === undefined) return
    const closed = [...before].filter(([id]) => !now.has(id)).map(([, name]) => name)
    if (closed.length === 0) return
    toast.show({
      tone: 'warning',
      title: closed.length === 1 ? `${closed[0] ?? ''} closed` : `${closed.length} rooms closed`,
      description: `Your role no longer has access to ${closed.join(', ')}.`,
      durationMs: 12_000,
    })
  }, [rooms, toast])
}

/** PLY-5, R28: the notice for a layout reset by a structural change of the game. */
function useLayoutResetNotice(): () => void {
  const toast = useOptionalToast()
  return useCallback(() => {
    toast?.show({
      tone: 'info',
      title: 'Layout reset',
      description:
        'The admin changed the game’s forces, roles or rooms, so your workspace is back to the default layout.',
      durationMs: 12_000,
    })
  }, [toast])
}

/** The dockable workspace over the pane's store; needs a SessionStoreProvider. */
export function Workspace({ storage, registry = EMPTY_REGISTRY, tabBadge }: WorkspaceProps) {
  const me = useMe()
  const setup = useGameSetup()
  const onReset = useLayoutResetNotice()
  // Not while the role itself is gone (PLY-29): that logout says why.
  const known = me.status === 'ready' && (me.data.role !== undefined || me.data.identity.isAdmin)
  useClosedRoomNotice(known ? me.data.rooms : undefined)
  if (me.status === 'loading' || (setup.status === 'loading' && setup.data === undefined)) {
    return <Spinner label="Loading your rooms" />
  }
  const { identity, rooms } = me.data
  // Keyed by the role's GUID, so a layout saved before GUID ids (keyed by the old role id, with
  // the old room ids) is not found, and the default layout is used once (PLY-5).
  const role = me.data.role?.id ?? (identity.isAdmin ? 'admin' : undefined)
  const key =
    role === undefined
      ? undefined
      : layoutKey({
          server: identity.domain,
          role,
          designVersion: setup.data?.designVersion ?? 0,
        })
  const roomIds = rooms.map(({ room }) => room.id)
  return (
    <WorkspaceCore
      rooms={rooms.map(({ room }) => ({ id: room.id, name: room.name }))}
      renderRoom={(roomId) => <RoomPanel roomId={roomId} registry={registry} />}
      panels={[
        { id: 'game-info', name: 'Game info', content: <GameInfoPanel /> },
        { id: 'online', name: 'Online', content: <OnlinePanel roomIds={roomIds} /> },
      ]}
      storage={storage}
      layoutKey={key}
      resetKey={setup.data?.designVersion}
      onReset={onReset}
      tabBadge={tabBadge}
      emptyState={
        rooms.length === 0 ? (
          <p className="wrx-empty" role="status">
            Your role has no rooms yet. Rooms appear here as soon as the admin gives your role
            access.
          </p>
        ) : undefined
      }
    />
  )
}
