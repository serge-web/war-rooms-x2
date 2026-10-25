// One pane of the multi-client view (PLY-16–18): a full player client with its own session, store
// and layout (PLY-17, D15), or the admin backend. Signed in, the shell's header is the pane header:
// role, force colour and backend (PLY-18). Signed out, the pane offers quick login from the game's
// role list on the mock, and a login form on a real server.
import { Button, Spinner, ThemeScope } from '@wrx/ui'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { BackendBadge } from '../backend.tsx'
import type { BackendInfo } from '../backend.tsx'
import { ForcedLogoutNotice } from '../ended.tsx'
import { LoginFormCore } from '../login-form.tsx'
import type { DemoLogin } from '../login-form.tsx'
import { PlayerClient } from '../player-client.tsx'
import { usePlayerSession } from '../session.ts'
import type { Connection, PlayerSession } from '../session.ts'
import type { PaneKind } from './presets.ts'

export interface ClientPaneProps {
  /** 1-based, for the pane's name. */
  readonly number: number
  readonly kind: PaneKind
  readonly onKindChange: (kind: PaneKind) => void
  readonly connection: Connection
  readonly backend: BackendInfo
  /** Mock only: one-click logins (PLY-18, NFR-6). */
  readonly demoLogins?: readonly DemoLogin[] | undefined
  /** The pane's workspace, e.g. a `Workspace` with saved layouts; each pane renders its own. */
  readonly workspace?: ReactNode
  /** The admin backend for an admin pane; without it, panes are player clients only. */
  readonly renderAdmin?: (() => ReactNode) | undefined
  /** A role to log in as on mount, from a preset (PLY-19): logged in on the mock, filled in otherwise. */
  readonly autoLogin?: string | undefined
  /** Told the role id the pane is logged in as (`admin` for the game view), or undefined. */
  readonly onLogin?: ((roleId: string | undefined) => void) | undefined
}

export function ClientPane(props: ClientPaneProps) {
  const name = `Pane ${props.number}`
  return (
    <section className="wrx-multi__pane" aria-label={name} data-pane={props.number}>
      {/* Each pane is its own theme root, so one pane's theme never reaches another (PLY-24). */}
      <ThemeScope root className="wrx-multi__pane-body">
        {props.kind === 'admin' && props.renderAdmin !== undefined ? (
          <AdminPane {...props} name={name} renderAdmin={props.renderAdmin} />
        ) : (
          <PlayerPane {...props} name={name} />
        )}
      </ThemeScope>
    </section>
  )
}

function AdminPane({
  name,
  onKindChange,
  onLogin,
  renderAdmin,
}: ClientPaneProps & { readonly name: string; readonly renderAdmin: () => ReactNode }) {
  const report = useRef(onLogin)
  report.current = onLogin
  useEffect(() => {
    report.current?.(undefined)
  }, [])
  return (
    <div className="wrx-multi__admin">
      <div className="wrx-multi__pane-bar">
        <h2 className="wrx-multi__pane-name">{name}: admin backend</h2>
        <Button
          size="small"
          onClick={() => {
            onKindChange('player')
          }}
        >
          Show a player client
        </Button>
      </div>
      <div className="wrx-multi__admin-body">{renderAdmin()}</div>
    </div>
  )
}

function PlayerPane(props: ClientPaneProps & { readonly name: string }) {
  const { connection, demoLogins, autoLogin, onLogin, name } = props
  const session = usePlayerSession(connection)
  const store = session.state.phase === 'signed-in' ? session.state.store : undefined
  const roleId =
    store === undefined
      ? undefined
      : (store.identity.roleId ?? (store.identity.isAdmin ? 'admin' : undefined))

  const report = useRef(onLogin)
  report.current = onLogin
  useEffect(() => {
    report.current?.(roleId)
  }, [roleId])

  // A preset's login (PLY-19), on the mock where its demo password is known (NFR-6). Under
  // StrictMode this runs twice; the session keeps only the later attempt.
  useEffect(() => {
    const demo = demoLogins?.find((d) => d.roleId === autoLogin)
    if (demo !== undefined) void session.login(demo.roleId, demo.password)
    // On mount only: a preset is applied by remounting the pane.
  }, [])

  return (
    <PlayerClient
      connection={connection}
      backend={props.backend}
      session={session}
      workspace={props.workspace}
      title={<h2 className="wrx-shell__product wrx-multi__pane-name">{name}</h2>}
      signedOut={
        <PaneSignedOut
          {...props}
          session={session}
          prefill={demoLogins?.some((d) => d.roleId === autoLogin) === true ? undefined : autoLogin}
        />
      }
    />
  )
}

function PaneSignedOut({
  name,
  backend,
  demoLogins = [],
  renderAdmin,
  onKindChange,
  session,
  prefill,
}: ClientPaneProps & {
  readonly name: string
  readonly session: PlayerSession
  readonly prefill: string | undefined
}) {
  const headingId = useId()
  const { state } = session
  const busy = state.phase === 'signing-in'
  const error = state.phase === 'signed-out' ? state.error : undefined
  const ended = state.phase === 'signed-out' ? state.ended : undefined
  return (
    <div className="wrx-multi__signed-out">
      <div className="wrx-multi__pane-bar">
        <h2 className="wrx-multi__pane-name">{name}</h2>
        <span className="wrx-multi__pane-status">Not logged in</span>
        <BackendBadge backend={backend} />
      </div>
      <div className="wrx-multi__login">
        {ended === undefined ? null : (
          <ForcedLogoutNotice
            ended={ended}
            onDismiss={() => {
              session.acknowledge()
            }}
          />
        )}
        {busy ? <Spinner label="Logging in" /> : null}
        {demoLogins.length === 0 ? null : (
          <section aria-labelledby={headingId} className="wrx-multi__quick">
            <h3 id={headingId} className="wrx-multi__quick-heading">
              Quick login
            </h3>
            <p className="wrx-multi__note">Demo roles with their known demo passwords.</p>
            <ul className="wrx-multi__quick-list">
              {demoLogins.map((login) => (
                <li key={login.roleId}>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      void session.login(login.roleId, login.password)
                    }}
                  >
                    {`Log in as ${login.label}`}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {demoLogins.length === 0 ? (
          <LoginFormCore
            title={`Log in to ${name}`}
            busy={busy}
            error={error}
            initialRoleId={prefill}
            onSubmit={(roleId, password) => {
              void session.login(roleId, password)
            }}
          />
        ) : (
          <>
            {error === undefined ? null : (
              <p className="wrx-login__error" role="alert">
                {error}
              </p>
            )}
            <details className="wrx-multi__other-login">
              <summary>Log in with a role id and password</summary>
              <LoginFormCore
                title={`Log in to ${name}`}
                busy={busy}
                initialRoleId={prefill}
                onSubmit={(roleId, password) => {
                  void session.login(roleId, password)
                }}
              />
            </details>
          </>
        )}
        {renderAdmin === undefined ? null : (
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              onKindChange('admin')
            }}
          >
            Show the admin backend in this pane
          </Button>
        )}
      </div>
    </div>
  )
}
