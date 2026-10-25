// Seam for WP 2.9: the multi-client view at `#/multi` (PLY-16–19), and the mock's admin
// controls (PLY-21). Replace this placeholder with the real view, taking RouteProps
// (./types.ts). Each pane renders its own <PlayerClient> from @wrx/player-ui with its own
// connection, so no in-memory state is shared between panes (D15, PLY-17).
import { AppBarCore } from '@wrx/player-ui'
import { ThemeScope } from '@wrx/ui'
import type { RouteProps } from './types.ts'

export function MultiClientApp({ backend, nav }: RouteProps) {
  return (
    <ThemeScope className="wrx-placeholder-page">
      <AppBarCore backend={backend}>{nav}</AppBarCore>
      <main className="wrx-placeholder">
        <h2>Multi-client view</h2>
        <p role="status">The multi-client view is not in this build yet.</p>
      </main>
    </ThemeScope>
  )
}
