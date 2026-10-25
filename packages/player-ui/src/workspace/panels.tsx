// The workspace's panels: a room panel (the room type's player component, or a placeholder for a
// type with none), and the non-room panels game info and online (PLY-8). Each has a *Core
// over plain props (NFR-18).
import { roomConfig } from '@wrx/domain'
import type { Author, Occupant } from '@wrx/domain'
import { useAuthors, useGameSetup, useMe } from '@wrx/hooks'
import type { ReactRoomTypeRegistry } from '@wrx/hooks'
import { RoomThemeScope } from '@wrx/theme/react'
import { MarkdownView } from '@wrx/ui'
import { useId } from 'react'
import { useOccupantsOf } from './online.ts'

// ---- Room panel ------------------------------------------------------------------------------

export interface RoomPlaceholderCoreProps {
  readonly name: string
  /** The room type's label, e.g. "Chat". */
  readonly typeLabel: string
  readonly access: 'write' | 'read'
  /** Why the room cannot be shown, when its config is invalid. */
  readonly problem?: string | undefined
}

/** Stands in for a room type's panel until one is registered. */
export function RoomPlaceholderCore({
  name,
  typeLabel,
  access,
  problem,
}: RoomPlaceholderCoreProps) {
  return (
    <div className="wrx-room-placeholder">
      <h2 className="wrx-room-placeholder__name">{name}</h2>
      <p className="wrx-room-placeholder__type">
        {typeLabel} room{access === 'read' ? ', read only' : ''}
      </p>
      <p className="wrx-empty">
        {problem === undefined
          ? 'This room’s panel is not in this build yet.'
          : `This room cannot be shown: ${problem}`}
      </p>
    </div>
  )
}

export interface RoomPanelProps {
  readonly roomId: string
  readonly registry: ReactRoomTypeRegistry
}

/** One room's panel, in the room's theme (PLY-24, PLY-26). */
export function RoomPanel({ roomId, registry }: RoomPanelProps) {
  const me = useMe().data
  const game = useGameSetup().data
  const entry = me.rooms.find((r) => r.room.id === roomId)
  if (entry === undefined) return null
  const { room, access } = entry
  const definition = registry.get(room.roomType)
  const config = roomConfig(registry, room, game)
  const Panel = definition?.playerComponent
  return (
    <RoomThemeScope
      roomId={roomId}
      as="section"
      className="wrx-room-panel"
      aria-label={room.name}
      data-room={roomId}
    >
      {Panel !== undefined && config.ok ? (
        <Panel roomId={roomId} room={room} config={config.value} access={access} />
      ) : (
        <RoomPlaceholderCore
          name={room.name}
          typeLabel={definition?.label ?? room.roomType}
          access={access}
          problem={config.ok ? undefined : config.error}
        />
      )}
    </RoomThemeScope>
  )
}

// ---- Game info --------------------------------------------------------------------------------

export interface GameInfoPanelCoreProps {
  readonly name: string
  readonly description: string
  /** Markdown, sanitised by MarkdownView. */
  readonly briefing: string
}

export function GameInfoPanelCore({ name, description, briefing }: GameInfoPanelCoreProps) {
  const headingId = useId()
  return (
    <section className="wrx-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="wrx-panel__heading">
        {name}
      </h2>
      {description === '' ? null : <p className="wrx-panel__lead">{description}</p>}
      {briefing.trim() === '' ? (
        <p className="wrx-empty">No briefing.</p>
      ) : (
        <MarkdownView markdown={briefing} label="Game briefing" />
      )}
    </section>
  )
}

/** The game's name, description and briefing. */
export function GameInfoPanel() {
  const game = useGameSetup().data
  if (game === undefined) return <p className="wrx-empty wrx-panel">No game has been published.</p>
  return (
    <GameInfoPanelCore name={game.name} description={game.description} briefing={game.briefing} />
  )
}

// ---- Online -----------------------------------------------------------------------------------

export interface OnlineRole {
  /** Role id, or the nickname when the occupant has no role (the admin). */
  readonly id: string
  readonly name: string
  readonly forceName?: string | undefined
  readonly colour?: string | undefined
  readonly self: boolean
}

export function OnlinePanelCore({ roles }: { readonly roles: readonly OnlineRole[] }) {
  const headingId = useId()
  return (
    <section className="wrx-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="wrx-panel__heading">
        Online
      </h2>
      {roles.length === 0 ? (
        <p className="wrx-empty">Nobody is online in your rooms yet.</p>
      ) : (
        <ul className="wrx-online">
          {roles.map((role) => (
            <li key={role.id} className="wrx-online__role">
              <span
                className="wrx-online__swatch"
                aria-hidden="true"
                style={role.colour === undefined ? undefined : { background: role.colour }}
              />
              <span className="wrx-online__name">{role.name}</span>
              {role.forceName === undefined ? null : (
                <span className="wrx-online__force">{role.forceName}</span>
              )}
              {role.self ? <span className="wrx-online__self">(you)</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Occupants merged by role (the sessions of one role share it, D22) and sorted by name, with
 * their display data from the role and force documents.
 */
export function onlineRoles(
  occupants: readonly Occupant[],
  authors: ReadonlyMap<string, Author>,
): readonly OnlineRole[] {
  const byId = new Map<string, OnlineRole>()
  for (const occupant of occupants) {
    const id = occupant.roleId ?? occupant.nick
    const known = byId.get(id)
    if (known !== undefined) {
      if (occupant.self && !known.self) byId.set(id, { ...known, self: true })
      continue
    }
    const author = occupant.roleId === undefined ? undefined : authors.get(occupant.roleId)
    byId.set(id, {
      id,
      name: author?.name ?? occupant.nick,
      forceName: author?.forceName,
      colour: author?.colour,
      self: occupant.self,
    })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/** Roles present in any of the given rooms, by name. Joins those rooms while shown. */
export function OnlinePanel({ roomIds }: { readonly roomIds: readonly string[] }) {
  const lists = useOccupantsOf(roomIds)
  const authors = useAuthors().data
  return <OnlinePanelCore roles={onlineRoles(lists.flat(), authors)} />
}
