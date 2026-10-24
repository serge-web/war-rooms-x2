import { BackendBadge } from './BackendBadge.tsx'
import type { Backend } from './BackendBadge.tsx'

export interface AppProps {
  readonly backend: Backend
}

/**
 * The app shell. Scaffold only (WP 0.5): the welcome page, login and workspace arrive in
 * WP 2.4 and 2.5.
 */
export function App({ backend }: AppProps) {
  return (
    <div className="shell">
      <header className="shell-header">
        <h1>War Rooms X1</h1>
        <BackendBadge backend={backend} />
      </header>
      <main className="shell-main">
        <p role="status">No game has been published yet.</p>
      </main>
    </div>
  )
}
