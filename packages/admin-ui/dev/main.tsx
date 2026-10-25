// The admin editor on its own, over the demo seed from @wrx/mock-server, with the draft kept
// under the mock deployment's storage key (mock-host `names.storageKey`), as `apps/web` will.
// `?seed=empty` starts from an empty design instead.
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import type { AdminEditor, PlayerPanel } from '@wrx/hooks'
import { basePathOf, hostNames, mockNamespace } from '@wrx/mock-host'
import { demoSeed } from '@wrx/mock-server'
import { designFileSchema } from '@wrx/schemas'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AdminApp,
  ThemeEditor,
  createBrowserDraftStore,
  createDraft,
  draftFromDesign,
} from '../src/index.ts'
import type { Draft } from '../src/index.ts'

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
