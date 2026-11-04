// The player shell: a header, the workspace slot (the dockable workspace of WP 2.5) and the
// out-of-game column on the right (PLY-36, WP 2.7). In a narrow client the column becomes a
// workspace tab instead (FT-1). Each part has a *Core that takes plain props and a wrapper that
// reads @wrx/hooks (NFR-18).
import { UMPIRE_NAME } from '@wrx/domain'
import type { StoreStatus } from '@wrx/domain'
import { useGameSetup, useMe, useSessionStatus } from '@wrx/hooks'
import type { ThemeTokens } from '@wrx/schemas'
import { Banner, Button, Spinner, ThemeScope } from '@wrx/ui'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { OutOfGameColumn, useUnseenAnnouncements } from './column/index.ts'
import { UnreadBadge, Workspace, WorkspaceSpecialProvider } from './workspace/index.ts'
import type { WorkspaceSpecialSlot } from './workspace/index.ts'

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

// ---- Rooms (a plain list, the workspace before WP 2.5; kept for hosts that want no layout) ----

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

// ---- The shell ----------------------------------------------------------------------------------

export interface ShellRole {
  /** Role name, or "Umpire" for the admin. */
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
  /** Replaces the product heading, e.g. with a pane's name in the multi-client view. */
  readonly title?: ReactNode
  /** Extra header items before the backend badge, e.g. the admin's preview selector. */
  readonly headerItems?: ReactNode
  /** A notice under the header, e.g. that the admin is previewing as a role. */
  readonly notice?: ReactNode
  /**
   * FT-1: where the out-of-game column goes. `auto` (the default) makes it a workspace tab while
   * the client is narrower than `columnBreakpoint`, and the fixed column otherwise.
   */
  readonly columnForm?: ColumnForm
  /** FT-1: the client width, in rem, below which the column becomes a tab. */
  readonly columnBreakpoint?: number
  /** FT-1: shown on the tab after its name, e.g. the unread announcements badge. */
  readonly columnBadge?: ReactNode
  /** FT-1: told whether the column's content is on screen (always, as the fixed column). */
  readonly onColumnShownChange?: (shown: boolean) => void
}

export type ColumnForm = 'auto' | 'column' | 'tab'

/**
 * FT-1: below this client width (rem) the out-of-game column becomes a tab. The column is 18rem
 * wide (13rem in a multi-client pane), so at 45rem it takes at most 40% of the client and leaves
 * the workspace 27rem, about one chat room. Measured on the client, not the screen, so each
 * multi-client pane switches on its own width; rem, so browser zoom and font size count.
 */
export const COLUMN_BREAKPOINT_REM = 45

/** The tab's name and the region it holds. */
export const COLUMN_TAB_NAME = 'Out of game'

/** Whether the element is narrower than `breakpointRem`; false until it has been laid out. */
function useNarrow(ref: RefObject<HTMLElement | null>, breakpointRem: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    const measure = () => {
      const width = element.getBoundingClientRect().width
      const view = element.ownerDocument.defaultView
      const rem =
        Number.parseFloat(
          view?.getComputedStyle(element.ownerDocument.documentElement).fontSize ?? '',
        ) || 16
      setNarrow(width > 0 && width < breakpointRem * rem)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref, breakpointRem])
  return narrow
}

/** A megaphone: the tab holds the admin's announcements (decorative; the name is the label). */
function OutOfGameIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" focusable="false">
      <path d="M1.5 6.25h3.25L11.5 2.5v11L4.75 9.75H1.5z" />
      <path d="M5 10.5h2l1 3.5H6z" />
      <path d="M13 6h1.75v4H13z" />
    </svg>
  )
}

type Place = 'aside' | 'tab' | 'stash'

/**
 * FT-1: renders the column once, into a node of its own, and moves that node between the fixed
 * column, the workspace tab and a hidden stash (no workspace yet, or a tab never opened). The
 * column's React tree never remounts, so its state (a half-written announcement, the force
 * shown, an open editor) survives the switch.
 */
function useColumnHome(asTab: boolean) {
  const [holder] = useState(() => {
    const element = document.createElement('div')
    element.className = 'wrx-shell__column-content'
    return element
  })
  const places = useRef<Record<Place, HTMLElement | null>>({ aside: null, tab: null, stash: null })
  const asTabRef = useRef(asTab)
  asTabRef.current = asTab
  const settle = useCallback(() => {
    const p = places.current
    const target = (asTabRef.current ? p.tab : p.aside) ?? p.stash
    if (target !== null && holder.parentElement !== target) target.appendChild(holder)
  }, [holder])
  const place = useCallback(
    (key: Place) => (element: HTMLElement | null) => {
      places.current[key] = element
      settle()
    },
    [settle],
  )
  const refs = useMemo(
    () => ({ aside: place('aside'), tab: place('tab'), stash: place('stash') }),
    [place],
  )
  useLayoutEffect(settle)
  return { holder, refs }
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
  title,
  headerItems,
  notice,
  columnForm = 'auto',
  columnBreakpoint = COLUMN_BREAKPOINT_REM,
  columnBadge,
  onColumnShownChange,
}: ShellCoreProps) {
  const starting = status.state === 'starting' || game === 'loading'
  const bodyRef = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(bodyRef, columnBreakpoint)
  const hasColumn = column !== undefined && column !== null && column !== false
  const wantTab = hasColumn && (columnForm === 'tab' || (columnForm === 'auto' && narrow))
  // A tab only where a workspace is mounted to hold it (not while loading or with no game).
  const [claims, setClaims] = useState(0)
  const claim = useCallback(() => {
    setClaims((n) => n + 1)
    return () => {
      setClaims((n) => n - 1)
    }
  }, [])
  const asTab = wantTab && claims > 0
  const [tabShown, setTabShown] = useState(false)
  const shown = !asTab || tabShown
  useEffect(() => {
    onColumnShownChange?.(shown)
  }, [shown, onColumnShownChange])
  const { holder, refs } = useColumnHome(asTab)
  const tabContent = useMemo(
    () => <section ref={refs.tab} className="wrx-shell__column-tab" aria-label={COLUMN_TAB_NAME} />,
    [refs.tab],
  )
  const slot = useMemo<WorkspaceSpecialSlot>(
    () => ({
      tab: wantTab
        ? {
            id: 'out-of-game',
            name: COLUMN_TAB_NAME,
            content: tabContent,
            icon: <OutOfGameIcon />,
            badge: columnBadge,
          }
        : undefined,
      claim,
      onShownChange: setTabShown,
    }),
    [wantTab, tabContent, columnBadge, claim],
  )
  return (
    <ThemeScope tokens={theme} className="wrx-shell">
      <header className="wrx-shell__header">
        <div className="wrx-shell__brand">
          {title ?? <h1 className="wrx-shell__product">War Rooms X1</h1>}
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
          {headerItems}
          {backend}
          <Button size="small" onClick={onLogout} busy={loggingOut}>
            Log out
          </Button>
        </div>
      </header>
      {notice}
      <ConnectionIndicatorCore status={status} />
      <div className="wrx-shell__body" ref={bodyRef} data-column={asTab ? 'tab' : 'column'}>
        <main className="wrx-shell__workspace" aria-label="Workspace">
          <WorkspaceSpecialProvider value={slot}>
            {starting ? (
              <div className="wrx-shell__loading">
                <Spinner label="Loading the game" />
              </div>
            ) : game === 'none' ? (
              <NoGameCore />
            ) : (
              workspace
            )}
          </WorkspaceSpecialProvider>
        </main>
        {asTab ? null : (
          <aside ref={refs.aside} className="wrx-shell__column" aria-label="Out-of-game column" />
        )}
        <div ref={refs.stash} className="wrx-shell__column-stash" hidden />
        {hasColumn ? createPortal(column, holder) : null}
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
  /** The workspace; default the dockable `Workspace`, without saved layouts. */
  readonly workspace?: ReactNode
  /** The out-of-game column; default `OutOfGameColumn` (PLY-36). */
  readonly column?: ReactNode
  readonly title?: ReactNode
  readonly headerItems?: ReactNode
  readonly notice?: ReactNode
  /** Who the header names; default the session's role, or "Umpire" for the admin. */
  readonly role?: ShellRole
  /** FT-1: see `ShellCoreProps`. */
  readonly columnForm?: ColumnForm
  readonly columnBreakpoint?: number
}

/** The shell over the pane's store; needs a SessionStoreProvider. */
export function Shell({
  backend,
  onLogout,
  loggingOut,
  workspace,
  column,
  title,
  headerItems,
  notice,
  role: roleOverride,
  columnForm,
  columnBreakpoint,
}: ShellProps) {
  // FT-1: announcements that arrive while the column's tab is hidden are counted on the tab.
  const [columnShown, setColumnShown] = useState(true)
  const unseen = useUnseenAnnouncements(columnShown)
  const columnBadge = useMemo(() => <UnreadBadge count={unseen} />, [unseen])
  const status = useSessionStatus().data
  const me = useMe().data
  const setup = useGameSetup()
  const game = setup.data !== undefined ? 'ready' : setup.status === 'loading' ? 'loading' : 'none'
  const role: ShellRole | undefined =
    roleOverride ??
    (me.role !== undefined
      ? { name: me.role.name, forceName: me.force?.name, forceColour: me.force?.colour }
      : me.identity.isAdmin
        ? // The admin is the umpire, in the White Force (glossary, SC-5).
          { name: UMPIRE_NAME, forceName: me.force?.name, forceColour: me.force?.colour }
        : undefined)
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
      workspace={workspace ?? <Workspace />}
      column={column ?? <OutOfGameColumn />}
      title={title}
      headerItems={headerItems}
      notice={notice}
      columnBadge={columnBadge}
      onColumnShownChange={setColumnShown}
      {...(columnForm === undefined ? {} : { columnForm })}
      {...(columnBreakpoint === undefined ? {} : { columnBreakpoint })}
    />
  )
}
