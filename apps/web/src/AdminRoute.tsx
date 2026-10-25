// `#/admin`: the admin backend opens only after a login as the server's `admin` account
// (ADM-1, D3). The login and the session are the app's; what is shown after it is the AdminApp
// seam (WP 2.2). Any other account is logged out again with a message.
import { demoPassword } from '@wrx/mock-server'
import { AppBarCore, LoginFormCore, usePlayerSession } from '@wrx/player-ui'
import type { DemoLogin } from '@wrx/player-ui'
import { SessionStoreProvider } from '@wrx/hooks'
import { Banner, ThemeScope } from '@wrx/ui'
import { useEffect, useMemo, useState } from 'react'
import { AdminApp } from './seams/AdminApp.tsx'
import type { RouteProps } from './seams/types.ts'

export function AdminRoute(props: RouteProps) {
  const session = usePlayerSession(props.connection)
  const { state, logout } = session
  const [refused, setRefused] = useState(false)
  const store = state.phase === 'signed-in' ? state.store : undefined
  const isAdmin = store?.identity.isAdmin === true

  useEffect(() => {
    if (store !== undefined && !store.identity.isAdmin) {
      setRefused(true)
      void logout()
    }
  }, [store, logout])

  const demo = useMemo<readonly DemoLogin[]>(
    () =>
      props.backendId === 'mock'
        ? [{ roleId: 'admin', label: 'Admin', password: demoPassword('admin') }]
        : [],
    [props.backendId],
  )

  if (store !== undefined && isAdmin) {
    return (
      <SessionStoreProvider store={store}>
        <AdminApp {...props} session={store} onLogout={() => void logout()} />
      </SessionStoreProvider>
    )
  }

  const error =
    state.phase === 'signed-out' && state.error !== undefined
      ? state.error
      : refused
        ? 'Only the admin account can open the admin backend.'
        : undefined
  return (
    <ThemeScope className="wrx-placeholder-page">
      <AppBarCore backend={props.backend}>{props.nav}</AppBarCore>
      <main className="wrx-placeholder">
        {state.phase === 'signed-out' && state.ended !== undefined ? (
          <Banner tone="warning" title="You were logged out">
            The admin session ended.
          </Banner>
        ) : null}
        <LoginFormCore
          title="Admin login"
          busy={state.phase === 'signing-in' || (store !== undefined && !isAdmin)}
          error={error}
          demoLogins={demo}
          onSubmit={(roleId, password) => {
            setRefused(false)
            void session.login(roleId, password)
          }}
        />
      </main>
    </ThemeScope>
  )
}
