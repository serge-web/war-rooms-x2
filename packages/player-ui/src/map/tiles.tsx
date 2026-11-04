// The map's base tiles (NFR-9, D12): the deployment's, from its runtime config, never the room's.
// The app reads them from config.json (the server build) or uses its built-in demo default (the
// mock build) and provides them here; with none, the map draws the assets on a plain background
// and asks nothing of any tile server.
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

export interface MapTiles {
  /**
   * An absolute `https:` (or loopback `http:`) URL template with `{z}`, `{x}` and `{y}`, and
   * optionally `{s}` (subdomain) and `{r}` (retina suffix), as Leaflet's `TileLayer` reads it.
   */
  readonly url: string
  /** Plain text, e.g. "© OpenStreetMap contributors". Shown on the map, never as HTML. */
  readonly attribution: string
  /** Where the attribution links to, if anywhere: an `https:` URL. */
  readonly attributionUrl: string | undefined
  /** The deepest zoom the server has tiles for. */
  readonly maxZoom: number
}

/** The placeholders a tile URL may use; Leaflet throws on any other `{name}`. */
export const TILE_PLACEHOLDERS: readonly string[] = Object.freeze(['z', 'x', 'y', 's', 'r'])

/** The deepest zoom a config may ask for: Leaflet's practical limit for raster tiles. */
export const TILE_MAX_ZOOM = 22

const MapTilesContext = createContext<MapTiles | undefined>(undefined)

export function MapTilesProvider({
  tiles,
  children,
}: {
  readonly tiles: MapTiles | undefined
  readonly children?: ReactNode
}) {
  return <MapTilesContext.Provider value={tiles}>{children}</MapTilesContext.Provider>
}

/** This deployment's base tiles, or undefined when it has none. */
export function useMapTiles(): MapTiles | undefined {
  return useContext(MapTilesContext)
}
