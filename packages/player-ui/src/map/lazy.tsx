// The map, loaded on first use: Leaflet and milsymbol (about 1 MB before gzip) are fetched only
// once a client needs them, so the welcome page and the admin's editor load neither. Every role
// sees the map room (§3 rule 18), so a logged-in workspace fetches the chunk when the browser is
// idle (`MapPreload`): opening the map tab then costs the render alone (NFR-11). Their styles load
// with the panel (map/index.ts), so a popped-out map has them (PLY-4).
import { lazy, useEffect } from 'react'

/** The map's chunk; the module loader keeps it, so every call after the first is free. */
const load = () => import('./leaflet-map.tsx')

export const LazyMapView = lazy(load)

/** Starts loading the map's chunk now; a failure is left to the map's own use to report. */
export function preloadMapView(): void {
  load().catch(() => undefined)
}

/** Renders nothing; loads the map's chunk once the browser is idle after it mounts. */
export function MapPreload(): null {
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preloadMapView, { timeout: 5000 })
      return () => {
        window.cancelIdleCallback(id)
      }
    }
    const id = window.setTimeout(preloadMapView, 1000)
    return () => {
      window.clearTimeout(id)
    }
  }, [])
  return null
}

/** The asset form's symbol preview (WP 5.6), in a chunk with milsymbol. */
export const LazySymbolPreview = lazy(() => import('./symbol-preview.tsx'))
