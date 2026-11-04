// The map, loaded on first use: Leaflet and milsymbol (about 1 MB before gzip) are fetched only
// once a client needs them, so the welcome page and the admin's editor load neither. Every role
// sees the map room (§3 rule 18), so a logged-in workspace fetches the chunk at once and warms it
// up when the browser is idle (`MapPreload`): opening the map tab then costs the render alone
// (NFR-11). Their styles load
// with the panel (map/index.ts), so a popped-out map has them (PLY-4).
import { Spinner } from '@wrx/ui'
import { lazy, useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import type { MapViewProps } from './leaflet-map.tsx'

/**
 * The map's chunk, and its view once loaded; the module loader keeps the chunk, so every load
 * after the first is free. Holds code only, nothing of a session (ARC-2).
 */
function mapChunk() {
  let view: ComponentType<MapViewProps> | undefined
  return {
    load: () =>
      import('./leaflet-map.tsx').then((module) => {
        view = module.default
        return module
      }),
    loaded: (): ComponentType<MapViewProps> | undefined => view,
  }
}
const chunk = mapChunk()
const load = chunk.load

/**
 * The map view, loaded on first use. Not through `lazy` and Suspense: React holds a suspended
 * boundary's content back for up to 300 ms after its fallback shows (its fallback throttle),
 * which was a third of NFR-11's 1 s at 600 assets even with the chunk preloaded (WP 5.9). Here
 * a loaded chunk renders at once, and one still loading shows a spinner until it arrives. A chunk
 * that fails to load is thrown to the nearest error boundary, as `lazy` would.
 */
export function LazyMapView(props: MapViewProps) {
  const [View, setView] = useState<ComponentType<MapViewProps> | undefined>(chunk.loaded)
  const [failed, setFailed] = useState<{ readonly error: unknown } | undefined>(undefined)
  useEffect(() => {
    if (View !== undefined) return
    let live = true
    load().then(
      (module) => {
        if (live) setView(() => module.default)
      },
      (error: unknown) => {
        if (live) setFailed({ error })
      },
    )
    return () => {
      live = false
    }
  }, [View])
  if (failed !== undefined) throw failed.error
  return View === undefined ? <Spinner label="Loading the map" /> : <View {...props} />
}

/** Runs `task` when the browser is idle (or soon, without `requestIdleCallback`). */
function whenIdle(task: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 1000 })
  } else {
    window.setTimeout(task, 200)
  }
}

/**
 * Starts loading the map's chunk now, then warms it up a step per idle period (milsymbol's
 * set-up, WP 5.9); a failure is left to the map's own use to report.
 */
export function preloadMapView(): void {
  load().then(
    (module) => {
      const step = () => {
        if (module.warmUp()) whenIdle(step)
      }
      whenIdle(step)
    },
    () => undefined,
  )
}

/**
 * Renders nothing; starts loading the map's chunk just after it mounts. Not when the browser is
 * first idle (before WP 5.9): a workspace joining its rooms is rarely idle, so the chunk could
 * still be loading when the map tab was opened. Fetching and compiling it happen off the main
 * thread; its warm-up waits for idle periods.
 */
export function MapPreload(): null {
  useEffect(() => {
    const id = window.setTimeout(preloadMapView, 0)
    return () => {
      window.clearTimeout(id)
    }
  }, [])
  return null
}

/** The asset form's symbol preview (WP 5.6), in a chunk with milsymbol. */
export const LazySymbolPreview = lazy(() => import('./symbol-preview.tsx'))
