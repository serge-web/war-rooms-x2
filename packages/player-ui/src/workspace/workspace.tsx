// The workspace slot of the player shell (WP 2.5): WorkspaceCore over the pane's store. One tab
// per room the role can see (PLY-4), each the room type's player component in the room's theme,
// plus the game info and online panels (PLY-8). The layout is saved per server, role and design
// version (PLY-5) in the storage the host passes in.
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import { useGameSetup, useMe } from '@wrx/hooks'
import type { AdminEditor, PlayerPanel, ReactRoomTypeRegistry } from '@wrx/hooks'
import { Spinner } from '@wrx/ui'
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

/** The dockable workspace over the pane's store; needs a SessionStoreProvider. */
export function Workspace({ storage, registry = EMPTY_REGISTRY, tabBadge }: WorkspaceProps) {
  const me = useMe()
  const setup = useGameSetup()
  if (me.status === 'loading' || (setup.status === 'loading' && setup.data === undefined)) {
    return <Spinner label="Loading your rooms" />
  }
  const { identity, rooms } = me.data
  const role = identity.roleId ?? (identity.isAdmin ? 'admin' : undefined)
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
