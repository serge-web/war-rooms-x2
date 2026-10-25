// The player shell: a header, the workspace slot (WP 2.5 fills it) and the fixed out-of-game
// column on the right (PLY-36, WP 2.7 fills it). Each part has a *Core that takes plain props
// and a wrapper that reads @wrx/hooks (NFR-18).
import type { StoreStatus } from '@wrx/domain'
import { useGameSetup, useMe, useSessionStatus } from '@wrx/hooks'
import type { ThemeTokens } from '@wrx/schemas'
import { Banner, Button, Spinner, ThemeScope } from '@wrx/ui'
import { useId } from 'react'
import type { ReactNode } from 'react'

// ---- Connection status (PLY-2) ------------------------------------------------------------

export function ConnectionIndicatorCore({ status }: { readonly status: StoreStatus }) {
  if (status.state !== 'reconnecting') return null
  return (
    <Banner className="wrx-connection" tone="info" title="Reconnecting…">
      The connection to the server dropped (attempt {status.attempt}). What you see stays here, and
      missed messages are fetched when it is back.
    </Banner>
  )
}

// ---- Rooms (placeholder workspace until WP 2.5) ------------------------------------------------

export interface RoomSummary {
  readonly id: string
  readonly name: string
  readonly access: 'write' | 'read'
}

export function RoomListCore({ rooms }: { readonly rooms: readonly RoomSummary[] }) {
  const headingId = useId()
  return (
    <section className="wrx-room-list" aria-labelledby={headingId}>
      <h2 id={headingId}>Your rooms</h2>
      {rooms.length === 0 ? (
        <p className="wrx-empty" role="status">
          Your role has no rooms yet. Rooms appear here as soon as the admin gives your role access.
        </p>
      ) : (
        <ul className="wrx-room-list__items">
          {rooms.map((room) => (
            <li key={room.id} className="wrx-room-list__item">
              <span className="wrx-room-list__name">{room.name}</span>
              {room.access === 'read' ? (
                <span className="wrx-room-list__access">read only</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The role's visible rooms, in display order (PLY-4), from `useMe`. */
export function RoomList() {
  const me = useMe()
  if (me.status === 'loading') return <Spinner label="Loading your rooms" />
  return (
    <RoomListCore
      rooms={me.data.rooms.map(({ room, access }) => ({ id: room.id, name: room.name, access }))}
    />
  )
}

// ---- Empty states (PLY-32) ----------------------------------------------------------------

export function NoGameCore() {
  const headingId = useId()
  return (
    <section className="wrx-no-game" aria-labelledby={headingId}>
      <h2 id={headingId}>No game yet</h2>
      <p className="wrx-empty" role="status">
        No game has been published yet. This page updates by itself when the admin publishes one.
      </p>
    </section>
  )
}

/** Placeholder for the out-of-game column until WP 2.7 (PLY-36). */
export function OutOfGameColumnPlaceholder() {
  return (
    <>
      <section className="wrx-column__section" aria-label="Game time">
        <p className="wrx-column__reserved">Game time and turn: not used in this version.</p>
      </section>
      <section className="wrx-column__section" aria-label="Announcements">
        <h2 className="wrx-column__heading">Announcements</h2>
        <p className="wrx-empty">None yet.</p>
      </section>
    </>
  )
}

// ---- The shell ----------------------------------------------------------------------------------

export interface ShellRole {
  /** Role name, or "Admin". */
  readonly name: string
  readonly forceName?: string | undefined
  readonly forceColour?: string | undefined
}

export interface ShellCoreProps {
  readonly status: StoreStatus
  readonly gameName: string | undefined
  /** The game theme styles the client by default (D19). */
  readonly theme?: ThemeTokens | undefined
  readonly role: ShellRole | undefined
  /** The backend badge (PLY-1). */
  readonly backend: ReactNode
  readonly onLogout: () => void
  /** True while logging out. */
  readonly loggingOut?: boolean
  /** `none` shows the no-game empty state instead of the workspace (PLY-32). */
  readonly game: 'loading' | 'ready' | 'none'
  /** The workspace slot (WP 2.5). */
  readonly workspace: ReactNode
  /** The out-of-game column slot (WP 2.7). */
  readonly column: ReactNode
}

export function ShellCore({
  status,
  gameName,
  theme,
  role,
  backend,
  onLogout,
  loggingOut = false,
  game,
  workspace,
  column,
}: ShellCoreProps) {
  const starting = status.state === 'starting' || game === 'loading'
  return (
    <ThemeScope tokens={theme} className="wrx-shell">
      <header className="wrx-shell__header">
        <div className="wrx-shell__brand">
          <h1 className="wrx-shell__product">War Rooms X1</h1>
          {gameName === undefined ? null : <span className="wrx-shell__game">{gameName}</span>}
        </div>
        <div className="wrx-shell__session">
          {role === undefined ? null : (
            <span className="wrx-shell__role" aria-label={roleLabel(role)}>
              {role.forceColour === undefined ? null : (
                <span
                  className="wrx-shell__swatch"
                  aria-hidden="true"
                  style={{ background: role.forceColour }}
                />
              )}
              {role.name}
              {role.forceName === undefined ? null : (
                <span className="wrx-shell__force">{role.forceName}</span>
              )}
            </span>
          )}
          {backend}
          <Button size="small" onClick={onLogout} busy={loggingOut}>
            Log out
          </Button>
        </div>
      </header>
      <ConnectionIndicatorCore status={status} />
      <div className="wrx-shell__body">
        <main className="wrx-shell__workspace" aria-label="Workspace">
          {starting ? (
            <div className="wrx-shell__loading">
              <Spinner label="Loading the game" />
            </div>
          ) : game === 'none' ? (
            <NoGameCore />
          ) : (
            workspace
          )}
        </main>
        <aside className="wrx-shell__column" aria-label="Out-of-game column">
          {column}
        </aside>
      </div>
    </ThemeScope>
  )
}

function roleLabel(role: ShellRole): string {
  return role.forceName === undefined
    ? `Logged in as ${role.name}`
    : `Logged in as ${role.name}, ${role.forceName}`
}

export interface ShellProps {
  readonly backend: ReactNode
  readonly onLogout: () => void
  readonly loggingOut?: boolean
  /** The workspace; default the role's room list until WP 2.5. */
  readonly workspace?: ReactNode
  /** The out-of-game column; default a placeholder until WP 2.7. */
  readonly column?: ReactNode
}

/** The shell over the pane's store; needs a SessionStoreProvider. */
export function Shell({ backend, onLogout, loggingOut, workspace, column }: ShellProps) {
  const status = useSessionStatus().data
  const me = useMe().data
  const setup = useGameSetup()
  const game = setup.data !== undefined ? 'ready' : setup.status === 'loading' ? 'loading' : 'none'
  const role: ShellRole | undefined =
    me.role !== undefined
      ? { name: me.role.name, forceName: me.force?.name, forceColour: me.force?.colour }
      : me.identity.isAdmin
        ? { name: 'Admin' }
        : undefined
  return (
    <ShellCore
      status={status}
      gameName={setup.data?.name}
      theme={setup.data?.theme.tokens}
      role={role}
      backend={backend}
      onLogout={onLogout}
      loggingOut={loggingOut}
      game={game}
      workspace={workspace ?? <RoomList />}
      column={column ?? <OutOfGameColumnPlaceholder />}
    />
  )
}
