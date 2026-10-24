// The React shapes of the room-type registry's UI slots (ARC-5). The registry itself is
// framework-neutral in `@wrx/domain`; these types close its `Player` and `Editor` parameters.
// WP 2.6 fills `playerComponent` for chat, and WP 2.2 fills `adminEditor`, with `withSlots`.
import type { RoomTypeDefinition, RoomTypeRegistry } from '@wrx/domain'
import type { Room } from '@wrx/schemas'
import type { ComponentType } from 'react'

/** Props of a room panel in the player workspace. */
export interface PlayerPanelProps {
  readonly roomId: string
  /** The live room document. */
  readonly room: Room
  /**
   * The effective config, already validated by the type's `configSchema` (see `roomConfig`).
   * Typed `unknown` at the registry boundary; a panel narrows it with its own schema.
   */
  readonly config: unknown
}

/** Props of the type-specific part of the admin's room editor. */
export interface AdminEditorProps {
  /** The room as currently edited, not necessarily published. */
  readonly room: Room
  readonly config: unknown
  /** Proposes a new config; the editor validates it with the type's `configSchema`. */
  readonly onChange: (config: Readonly<Record<string, unknown>>) => void
  readonly disabled?: boolean
}

export type PlayerPanel = ComponentType<PlayerPanelProps>
export type AdminEditor = ComponentType<AdminEditorProps>

export type ReactRoomTypeDefinition = RoomTypeDefinition<PlayerPanel, AdminEditor>
export type ReactRoomTypeRegistry = RoomTypeRegistry<PlayerPanel, AdminEditor>
