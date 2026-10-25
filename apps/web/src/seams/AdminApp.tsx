// The admin backend at `#/admin`, shown only after an `admin` login (AdminRoute.tsx, ADM-1):
// the design editor (WP 2.2) with the theme editor (WP 2.8) in its Themes section. The draft is
// kept in this browser under a key per backend: the mock deployment's own namespace for the
// mock (DOC-10), the server's domain otherwise.
import {
  AdminApp as AdminEditorApp,
  ThemeEditor,
  createBrowserDraftStore,
  createDraft,
  draftFromDesign,
} from '@wrx/admin-ui'
import type { Draft } from '@wrx/admin-ui'
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import type { AdminEditor, PlayerPanel } from '@wrx/hooks'
import { demoSeed } from '@wrx/mock-server'
import { AppBarCore } from '@wrx/player-ui'
import { designFileSchema } from '@wrx/schemas'
import { Button } from '@wrx/ui'
import { useState } from 'react'
import { ROUTE_HREFS } from '../router.ts'
import type { AdminAppProps } from './types.ts'

export function AdminApp({
  backend,
  backendId,
  connection,
  mockHost,
  nav,
  onLogout,
}: AdminAppProps) {
  const [store] = useState(() => {
    const key =
      mockHost?.names.storageKey('admin-draft') ?? `wrx1:admin-draft:${connection.endpoint.domain}`
    // The mock starts provisioned with the demo seed, so its draft starts from the same design.
    const initial = (): Draft =>
      backendId === 'mock'
        ? draftFromDesign(designFileSchema.parse(demoSeed().design))
        : createDraft({ name: 'New exercise' })
    return createBrowserDraftStore(key, { initial })
  })
  const [registry] = useState(() => withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {}))
  return (
    <>
      <AppBarCore backend={backend}>
        {nav}
        <Button size="small" onClick={onLogout}>
          Log out
        </Button>
      </AppBarCore>
      <AdminEditorApp
        store={store}
        registry={registry}
        themes={ThemeEditor}
        onSwitchToGame={() => {
          location.hash = ROUTE_HREFS.player
        }}
      />
    </>
  )
}
