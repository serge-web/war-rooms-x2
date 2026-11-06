// The script panel, loaded on first use (PY-5): its code, the editor and the private-storage
// client are a chunk of their own, fetched only when the panel's tab is first shown; the panel
// then loads the runner (`py/runner.js`) and starts Pyodide. Nothing of either is in the chunks
// the page loads at start-up (`check:bundle`).
import type { ScriptRole } from '@wrx/domain'
import { ChunkBoundary, Spinner, lazyChunk } from '@wrx/ui'
import { Suspense } from 'react'

const Panel = lazyChunk(() => import('./scripts-panel.tsx'))

/** The Scripts panel of the workspace, for a role that runs scripts. */
export function LazyScriptsPanel({ role }: { readonly role: ScriptRole }) {
  return (
    <ChunkBoundary what="the script panel" onRetry={Panel.reset}>
      <Suspense fallback={<Spinner label="Loading the script panel" />}>
        <Panel role={role} />
      </Suspense>
    </ChunkBoundary>
  )
}
