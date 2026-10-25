// One player client: the welcome page and login while signed out, the shell while signed in.
// The multi-client view (WP 2.9) renders one per pane, each with its own session and store. An
// admin login gets the game view with its preview-as-role selector (ADM-28–31).
import { SessionStoreProvider } from '@wrx/hooks'
import type { ReactNode } from 'react'
import { BackendBadge } from './backend.tsx'
import type { BackendInfo } from './backend.tsx'
import { ForcedLogoutNotice } from './ended.tsx'
import { LoginFormCore } from './login-form.tsx'
import type { DemoLogin } from './login-form.tsx'
import { useAnonymousStore, usePlayerSession } from './session.ts'
import type { AnonymousOptions, Connection, PlayerSession, SessionOptions } from './session.ts'
import { AdminGameView } from './preview/admin-game-view.tsx'
import { Shell } from './shell.tsx'
import { WelcomePage } from './welcome.tsx'

/** The bar along the top of the signed-out pages: product name and backend (PLY-1). */
export function AppBarCore({
  backend,
  children,
}: {
  readonly backend: BackendInfo
  /** Extra items, e.g. links to other views. */
  readonly children?: ReactNode
}) {
  return (
    <header className="wrx-app-bar">
      <h1 className="wrx-app-bar__product">War Rooms X1</h1>
      <div className="wrx-app-bar__end">
        {children}
        <BackendBadge backend={backend} />
      </div>
    </header>
  )
}

export interface PlayerClientProps {
  readonly connection: Connection
  readonly backend: BackendInfo
  /** The backend choice (PLY-20), shown in the login form. */
  readonly backendChoice?: ReactNode
  /** Mock only: the demo logins (NFR-6). */
  readonly demoLogins?: readonly DemoLogin[]
  /** Extra app-bar items on the welcome page. */
  readonly appBarItems?: ReactNode
  /**
   * The workspace slot; rendered inside the session's SessionStoreProvider. Default a
   * `Workspace` without saved layouts: the host passes one with its storage (PLY-5, DOC-10).
   */
  readonly workspace?: ReactNode
  /** The out-of-game column slot (WP 2.7); inside the SessionStoreProvider too. */
  readonly column?: ReactNode
  readonly sessionOptions?: SessionOptions
  readonly anonymousOptions?: AnonymousOptions
  /**
   * A session the host owns, e.g. a multi-client pane that logs in from its own header
   * (PLY-18). Without it the client makes its own. Do not switch between the two while mounted.
   */
  readonly session?: PlayerSession
  /** Shown instead of the welcome page while signed out, e.g. a pane's compact login. */
  readonly signedOut?: ReactNode
  /** Replaces the shell's product heading, e.g. with the pane's name. */
  readonly title?: ReactNode
}

export function PlayerClient(props: PlayerClientProps) {
  return props.session === undefined ? (
    <OwnSessionClient {...props} />
  ) : (
    <PlayerClientView {...props} session={props.session} />
  )
}

function OwnSessionClient(props: PlayerClientProps) {
  const session = usePlayerSession(props.connection, props.sessionOptions)
  return <PlayerClientView {...props} session={session} />
}

function PlayerClientView(props: PlayerClientProps & { readonly session: PlayerSession }) {
  const { session } = props
  const { state } = session
  if (state.phase === 'signed-in') {
    const shell = {
      backend: <BackendBadge backend={props.backend} />,
      onLogout: () => void session.logout(),
      workspace: props.workspace,
      column: props.column,
      title: props.title,
    }
    return (
      <SessionStoreProvider store={state.store}>
        {state.store.identity.isAdmin ? <AdminGameView {...shell} /> : <Shell {...shell} />}
      </SessionStoreProvider>
    )
  }
  if (props.signedOut !== undefined) return <>{props.signedOut}</>
  return <SignedOut {...props} />
}

function SignedOut({
  connection,
  backend,
  backendChoice,
  demoLogins,
  appBarItems,
  anonymousOptions,
  session,
}: PlayerClientProps & { readonly session: PlayerSession }) {
  // Only while signed out: logging in unmounts this and releases the anonymous session (D20).
  const anonymous = useAnonymousStore(connection, anonymousOptions)
  const { state } = session
  const ended = state.phase === 'signed-out' ? state.ended : undefined
  return (
    <WelcomePage
      store={anonymous.phase === 'ready' ? anonymous.store : undefined}
      pending={anonymous.phase === 'connecting'}
      header={<AppBarCore backend={backend}>{appBarItems}</AppBarCore>}
      notices={
        ended === undefined ? undefined : (
          <ForcedLogoutNotice
            ended={ended}
            onDismiss={() => {
              session.acknowledge()
            }}
          />
        )
      }
    >
      <LoginFormCore
        before={backendChoice}
        busy={state.phase === 'signing-in'}
        error={state.phase === 'signed-out' ? state.error : undefined}
        demoLogins={demoLogins}
        onSubmit={(roleId, password) => {
          void session.login(roleId, password)
        }}
      />
    </WelcomePage>
  )
}
