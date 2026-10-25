// What every route gets from the app: the chosen backend and its transport. The admin backend
// (WP 2.2) and the multi-client view (WP 2.9) take these props through their seams.
import type { SessionStore } from '@wrx/domain'
import type { MockHost } from '@wrx/mock-host'
import type { BackendInfo, Connection } from '@wrx/player-ui'
import type { ReactNode } from 'react'
import type { BackendId, Backends } from '../backends.ts'

export interface RouteProps {
  /** The chosen backend's transport and endpoint. */
  readonly connection: Connection
  /** For the badge (PLY-1). */
  readonly backend: BackendInfo
  readonly backendId: BackendId
  /** Every backend this page can use, for views that log in to several (PLY-16). */
  readonly backends: Backends
  /** The mock host when the mock is chosen: database controls (PLY-21) for WP 2.9. */
  readonly mockHost: MockHost | undefined
  /** The app bar's navigation links, for views that draw their own bar. */
  readonly nav: ReactNode
}

/** The admin backend's props: the route's, plus the logged-in admin session (ADM-1). */
export interface AdminAppProps extends RouteProps {
  /** The admin's session store; also provided through SessionStoreProvider. */
  readonly session: SessionStore
  /** Logs the admin out, back to the admin login. */
  readonly onLogout: () => void
}
