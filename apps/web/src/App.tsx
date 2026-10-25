// The app: composition only (D24). It picks the backend (PLY-20), shows it at all times
// (PLY-1), routes between the player, admin and multi-client views, and shows the mock's
// notices (DOC-17).
import type { MockHost, MockNotice } from '@wrx/mock-host'
import { AppBarCore, BackendChoiceCore, PlayerClient, Workspace } from '@wrx/player-ui'
import type { Connection, DemoLogin, LayoutStorage } from '@wrx/player-ui'
import type { Transport } from '@wrx/transport'
import { Banner, Spinner, ThemeScope, ToastProvider, useToast } from '@wrx/ui'
import type { Tone } from '@wrx/ui'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { BackendId, Backends } from './backends.ts'
import { ROUTE_HREFS, useRoute } from './router.ts'
import { AdminRoute } from './AdminRoute.tsx'
import { MultiClientApp } from './seams/MultiClientApp.tsx'
import type { RouteProps } from './seams/types.ts'

export interface AppProps {
  readonly backends: Backends
  /** The demo logins for the mock's login form (NFR-6). */
  readonly demoLogins: readonly DemoLogin[]
  /** Why config.json was ignored, if it was. */
  readonly configProblem?: string | undefined
  /** Remembers the chosen backend in this browser. */
  readonly backendPreference?: {
    load(): string | undefined
    save(id: BackendId): void
  }
  /** Where the player's workspace layouts are saved (PLY-5), under this deployment (DOC-10). */
  readonly layoutStorage?: LayoutStorage
}

export function App(props: AppProps) {
  return (
    <ThemeScope root className="wrx-app">
      <ToastProvider>
        <AppRoutes {...props} />
      </ToastProvider>
    </ThemeScope>
  )
}

type Loaded =
  | { readonly id: BackendId; readonly transport: Transport; readonly mock: MockHost | undefined }
  | { readonly id: BackendId; readonly error: string }

function useBackendTransport(backends: Backends, id: BackendId): Loaded | undefined {
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined)
  useEffect(() => {
    let current = true
    const mock = id === 'mock' ? backends.mockHost() : Promise.resolve(undefined)
    Promise.all([backends.transport(id), mock]).then(
      ([transport, host]) => {
        if (current) setLoaded({ id, transport, mock: host })
      },
      (error: unknown) => {
        if (current)
          setLoaded({ id, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      current = false
    }
  }, [backends, id])
  return loaded?.id === id ? loaded : undefined
}

const NOTICE_TONES: Readonly<Record<MockNotice['kind'], Tone>> = Object.freeze({
  migrated: 'info',
  'reset-unreadable': 'warning',
  'storage-unavailable': 'warning',
  'storage-failed': 'warning',
  'not-shared': 'info',
  reset: 'info',
  imported: 'info',
  superseded: 'warning',
})

/** Shows the mock's notices as toasts (DOC-17). */
function useMockNotices(backends: Backends): void {
  const toast = useToast()
  useEffect(
    () =>
      backends.onNotice((notice) => {
        toast.show({
          title: 'Mock backend',
          description: notice.text,
          tone: NOTICE_TONES[notice.kind],
          durationMs: notice.kind === 'superseded' ? Infinity : 8000,
        })
      }),
    [backends, toast],
  )
}

function Nav() {
  return (
    <nav className="wrx-nav" aria-label="Views">
      <a href={ROUTE_HREFS.player}>Player</a>
      <a href={ROUTE_HREFS.admin}>Admin</a>
      <a href={ROUTE_HREFS.multi}>Multi-client</a>
    </nav>
  )
}

function AppRoutes({
  backends,
  demoLogins,
  configProblem,
  backendPreference,
  layoutStorage,
}: AppProps) {
  const route = useRoute()
  const [selected, setSelected] = useState<BackendId>(() => {
    const saved = backendPreference?.load()
    return saved !== undefined && backends.has(saved) ? saved : backends.initial
  })
  const entry = backends.entry(selected)
  const loaded = useBackendTransport(backends, selected)
  useMockNotices(backends)
  const transport = loaded !== undefined && 'transport' in loaded ? loaded.transport : undefined
  const connection = useMemo<Connection | undefined>(
    () => (transport === undefined ? undefined : { transport, endpoint: entry.endpoint }),
    [transport, entry],
  )

  const nav = <Nav />
  const problem =
    configProblem === undefined ? null : (
      <Banner tone="warning" title="config.json was ignored">
        {configProblem}. The client is using the mock backend.
      </Banner>
    )

  if (connection === undefined || loaded === undefined || !('transport' in loaded)) {
    const failed = loaded !== undefined && 'error' in loaded ? loaded.error : undefined
    return (
      <div className="wrx-placeholder-page">
        <AppBarCore backend={entry.info}>{nav}</AppBarCore>
        <main className="wrx-placeholder">
          {problem}
          {failed === undefined ? (
            <Spinner
              label={selected === 'mock' ? 'Starting the mock backend' : 'Loading the client'}
            />
          ) : (
            <Banner tone="danger" title="This backend cannot be used">
              {failed}
            </Banner>
          )}
        </main>
      </div>
    )
  }

  // Shared by the player route and each multi-client pane: one element, one workspace per place
  // it is rendered (D15).
  const workspace = <Workspace storage={layoutStorage} />
  const backendChoice = (
    <BackendChoiceCore
      options={backends.entries.map((e) => ({
        id: e.id,
        backend: e.info,
        description: e.description,
      }))}
      selected={selected}
      onSelect={(id) => {
        if (!backends.has(id)) return
        setSelected(id)
        backendPreference?.save(id)
      }}
    />
  )
  const routeProps: RouteProps = {
    connection,
    backend: entry.info,
    backendId: selected,
    backends,
    mockHost: loaded.mock,
    nav,
    workspace,
    backendChoice,
    demoLogins: selected === 'mock' ? demoLogins : undefined,
  }

  let page: ReactNode
  switch (route.name) {
    case 'admin':
      page = <AdminRoute key={selected} {...routeProps} />
      break
    case 'multi':
      page = <MultiClientApp key={selected} {...routeProps} />
      break
    case 'not-found':
      page = (
        <div className="wrx-placeholder-page">
          <AppBarCore backend={entry.info}>{nav}</AppBarCore>
          <main className="wrx-placeholder">
            <h2>Page not found</h2>
            <p>
              There is nothing at <code>{route.path}</code>.{' '}
              <a href={ROUTE_HREFS.player}>Go to the login page</a>.
            </p>
          </main>
        </div>
      )
      break
    case 'player':
      page = (
        <PlayerClient
          // A new backend is a new client: nothing carries over between them.
          key={selected}
          connection={connection}
          backend={entry.info}
          appBarItems={nav}
          workspace={workspace}
          demoLogins={routeProps.demoLogins}
          backendChoice={backendChoice}
        />
      )
      break
  }
  return (
    <>
      {problem === null ? null : <div className="wrx-app__problem">{problem}</div>}
      {page}
    </>
  )
}
