// One player client: the welcome page and login while signed out, the shell while signed in.
// The multi-client view (WP 2.9) renders one per pane, each with its own session and store.
import { SessionStoreProvider } from '@wrx/hooks'
import type { ReactNode } from 'react'
import { BackendBadge } from './backend.tsx'
import type { BackendInfo } from './backend.tsx'
import { ForcedLogoutNotice } from './ended.tsx'
import { LoginFormCore } from './login-form.tsx'
import type { DemoLogin } from './login-form.tsx'
import { useAnonymousStore, usePlayerSession } from './session.ts'
import type { AnonymousOptions, Connection, PlayerSession, SessionOptions } from './session.ts'
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
  /** The workspace slot (WP 2.5); rendered inside the session's SessionStoreProvider. */
  readonly workspace?: ReactNode
  /** The out-of-game column slot (WP 2.7); inside the SessionStoreProvider too. */
  readonly column?: ReactNode
  readonly sessionOptions?: SessionOptions
  readonly anonymousOptions?: AnonymousOptions
}

export function PlayerClient(props: PlayerClientProps) {
  const session = usePlayerSession(props.connection, props.sessionOptions)
  const { state } = session
  if (state.phase === 'signed-in') {
    return (
      <SessionStoreProvider store={state.store}>
        <Shell
          backend={<BackendBadge backend={props.backend} />}
          onLogout={() => void session.logout()}
          workspace={props.workspace}
          column={props.column}
        />
      </SessionStoreProvider>
    )
  }
  return <SignedOut {...props} session={session} />
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
