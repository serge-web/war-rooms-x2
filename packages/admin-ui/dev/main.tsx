// The admin editor on its own, over the demo seed from @wrx/mock-server, with the draft kept
// under the mock deployment's storage key (mock-host `names.storageKey`), as `apps/web` will.
// `?seed=empty` starts from an empty design instead.
//
// Publishing (WP 2.3) goes to an empty mock server in this page, logged in as its admin with the
// demo password; it starts empty on every load. `?server=none` shows the editor with no server.
import { AdminOps, memoryMarkerStore } from '@wrx/admin-ops'
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import type { AdminEditor, PlayerPanel } from '@wrx/hooks'
import { basePathOf, hostNames, mockNamespace } from '@wrx/mock-host'
import {
  DEFAULT_SEED_DOMAIN,
  MockServer,
  MockTransport,
  demoPassword,
  demoSeed,
} from '@wrx/mock-server'
import { designFileSchema } from '@wrx/schemas'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AdminApp,
  ThemeEditor,
  createBrowserDraftStore,
  createDraft,
  draftFromDesign,
} from '../src/index.ts'
import type { Draft, PublishConnection } from '../src/index.ts'

async function connectToMock(): Promise<PublishConnection> {
  const domain = DEFAULT_SEED_DOMAIN
  const adminPassword = demoPassword('admin')
  const transport = new MockTransport(new MockServer({ domain, adminPassword }))
  const endpoint = { websocketUrl: 'mock://admin-dev', domain }
  const session = await transport.connect({
    endpoint,
    credentials: { kind: 'password', username: 'admin', password: adminPassword },
    resource: 'admin-dev',
  })
  if (!session.ok) throw new Error(`admin login failed: ${session.error.condition}`)
  return {
    ops: new AdminOps({ session: session.value, login: { transport, endpoint } }),
    kind: 'mock',
    marker: memoryMarkerStore(),
  }
}

/** One connection per page, shared by StrictMode's double render. */
let connecting: Promise<PublishConnection> | undefined

function useMockConnection(): PublishConnection | undefined {
  const [connection, setConnection] = useState<PublishConnection | undefined>()
  useEffect(() => {
    if (new URLSearchParams(location.search).get('server') === 'none') return
    connecting ??= connectToMock()
    let live = true
    void connecting.then((c) => {
      if (live) setConnection(c)
    })
    return () => {
      live = false
    }
  }, [])
  return connection
}

function seedDraft(): Draft {
  if (new URLSearchParams(location.search).get('seed') === 'empty') {
    return createDraft({ name: 'New exercise' })
  }
  return draftFromDesign(designFileSchema.parse(demoSeed().design))
}

function Dev() {
  const [store] = useState(() =>
    createBrowserDraftStore(
      hostNames(mockNamespace(basePathOf(location.href))).storageKey('admin-draft'),
      { initial: seedDraft },
    ),
  )
  const [registry] = useState(() => withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {}))
  const [view, setView] = useState<'admin' | 'game'>('admin')
  const connection = useMockConnection()
  if (view === 'game') {
    return (
      <main style={{ padding: '1rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>Game view</h1>
        <p>A placeholder until WP 2.4 and 2.9.</p>
        <button
          type="button"
          onClick={() => {
            setView('admin')
          }}
        >
          Back to admin
        </button>
      </main>
    )
  }
  return (
    <>
      <AdminApp
        store={store}
        registry={registry}
        themes={ThemeEditor}
        {...(connection === undefined ? {} : { publish: connection })}
        onSwitchToGame={() => {
          setView('game')
        }}
      />
      <footer style={{ padding: '0.5rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
        <button
          type="button"
          onClick={() => {
            store.reset()
          }}
        >
          Dev: reset the draft to the seed
        </button>
      </footer>
    </>
  )
}

const root = document.getElementById('root')
if (root === null) throw new Error('#root is missing')
createRoot(root).render(
  <StrictMode>
    <Dev />
  </StrictMode>,
)
