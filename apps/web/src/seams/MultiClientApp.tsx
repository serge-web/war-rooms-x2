// The multi-client view at `#/multi` (WP 2.9, PLY-16–22): composition only (D24). Each pane is a
// full player client from @wrx/player-ui with its own session, store and layout, or the admin
// backend (AdminRoute), so no in-memory state is shared between panes (D15, PLY-17). On the mock,
// the toolbar has the database controls (PLY-21). Presets are kept per backend under this
// deployment's namespace (DOC-10).
import { basePathOf, hostNames, mockNamespace } from '@wrx/mock-host'
import { AppBarCore, MockControlsCore, MultiClientView, webPresetStorage } from '@wrx/player-ui'
import { useMemo } from 'react'
import { AdminRoute } from '../AdminRoute.tsx'
import type { RouteProps } from './types.ts'

export function MultiClientApp(props: RouteProps) {
  const { connection, backend, backendId, mockHost, nav, workspace, backendChoice, demoLogins } =
    props
  const presets = useMemo(() => {
    const names = mockHost?.names ?? hostNames(mockNamespace(basePathOf(document.baseURI)))
    return webPresetStorage(() => localStorage, names.storageKey(`multi-presets-${backendId}`))
  }, [mockHost, backendId])
  return (
    <MultiClientView
      connection={connection}
      backend={backend}
      // On the mock, the demo logins end with the admin's, which opens its game view as the
      // umpire (ADM-28–31, SC-5); the admin backend is its own pane kind.
      demoLogins={demoLogins}
      workspace={workspace}
      presets={presets}
      initialCount={3}
      header={<AppBarCore backend={backend}>{nav}</AppBarCore>}
      toolbarItems={backendChoice}
      renderAdmin={() => <AdminRoute {...props} nav={null} />}
      mockControls={
        mockHost === undefined ? undefined : (
          <MockControlsCore
            onReset={async () => {
              const result = await mockHost.resetToSeed()
              return result.ok ? undefined : result.error
            }}
            onExport={async () => {
              const result = await mockHost.exportDatabase()
              return result.ok ? { ok: true, json: result.value } : result
            }}
            onImport={async (json) => {
              const result = await mockHost.importDatabase(json)
              return result.ok ? undefined : result.error
            }}
          />
        )
      }
    />
  )
}
