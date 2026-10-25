// Seam for WP 2.2: the admin backend at `#/admin`, shown only after an `admin` login
// (AdminRoute.tsx, ADM-1). Replace this placeholder with a component taking AdminAppProps that
// renders @wrx/admin-ui's AdminApp, e.g. with
//   createBrowserDraftStore(hostNames(mockNamespace(basePathOf(document.baseURI)))
//     .storageKey('admin-draft'))
// as its draft store. It is inside a SessionStoreProvider for the admin's session, so
// @wrx/hooks work. The page, its bar and the backend badge (PLY-1) are the admin app's to draw.
import { AppBarCore } from '@wrx/player-ui'
import { Button, ThemeScope } from '@wrx/ui'
import type { AdminAppProps } from './types.ts'

export function AdminApp({ backend, nav, onLogout }: AdminAppProps) {
  return (
    <ThemeScope className="wrx-placeholder-page">
      <AppBarCore backend={backend}>
        {nav}
        <Button size="small" onClick={onLogout}>
          Log out
        </Button>
      </AppBarCore>
      <main className="wrx-placeholder">
        <h2>Admin backend</h2>
        <p role="status">
          You are logged in as the admin. The admin backend is not in this build yet.
        </p>
      </main>
    </ThemeScope>
  )
}
