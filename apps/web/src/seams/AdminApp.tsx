// The admin backend at `#/admin`, shown only after an `admin` login (AdminRoute.tsx, ADM-1):
// the design editor (WP 2.2) with the theme editor (WP 2.8) and publishing (WP 2.3). Publishing
// goes through admin operations over the admin's own session (ADM-12, ADM-35). The draft is kept
// in this browser under a key per backend: the mock deployment's own namespace for the mock
// (DOC-10), the server's domain otherwise. The publish marker is kept on the server.
import { AdminOps, privateMarkerStore, storageMarkerStore } from '@wrx/admin-ops'
import {
  AdminApp as AdminEditorApp,
  ThemeEditor,
  createBrowserDraftStore,
  createDraft,
  draftFromDesign,
  markPublished,
} from '@wrx/admin-ui'
import type { Draft, PublishConnection } from '@wrx/admin-ui'
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import type { AdminEditor, PlayerPanel } from '@wrx/hooks'
import { DEMO_VAULT_PASSPHRASE, demoSeed } from '@wrx/mock-server'
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
  session,
}: AdminAppProps) {
  const keyFor = (name: string) =>
    mockHost?.names.storageKey(name) ?? `wrx1:${name}:${connection.endpoint.domain}`
  const [store] = useState(() => {
    // The mock starts provisioned and published with the demo seed, so its draft starts from
    // the same design, its roles already published.
    const initial = (): Draft =>
      backendId === 'mock'
        ? markPublished(draftFromDesign(designFileSchema.parse(demoSeed().design)))
        : createDraft({ name: 'New exercise' })
    return createBrowserDraftStore(keyFor('admin-draft'), { initial })
  })
  const [registry] = useState(() => withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {}))
  const [publish] = useState((): PublishConnection => ({
    ops: new AdminOps({
      session: session.session,
      login: { transport: connection.transport, endpoint: connection.endpoint },
    }),
    // `mock` only for the mock backend: it decides whether demo passwords are issued (NFR-6).
    kind: backendId === 'mock' ? 'mock' : 'xmpp',
    // In the admin's private storage, so every admin browser sees an unfinished publish; a
    // marker an earlier version left in this browser is moved there once.
    marker: privateMarkerStore(session.session.admin, {
      legacy: storageMarkerStore(localStorage, keyFor('publish-marker')),
    }),
    // The demo seed's vault passphrase, a DEMO secret (NFR-6): in the mock-only build only, so
    // the real-server build, where a real vault may be unlocked, never carries it.
    ...(backendId === 'mock' && !__WRX_REAL_SERVER__
      ? { demoVaultPassphrase: DEMO_VAULT_PASSPHRASE }
      : {}),
  }))
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
        publish={publish}
        onSwitchToGame={() => {
          location.hash = ROUTE_HREFS.player
        }}
      />
    </>
  )
}
