// What the map shows, as plain data (PLY-57): the opening view from the room config
// (`mapRoomConfigSchema`) and the assets, the table's rows, and the details' fields. No Leaflet
// here, so it is tested without a map and loads with the panel, not the map chunk.
import type { Force, MapRoomConfig, WorldAsset, WorldState } from '@wrx/schemas'

export interface LatLon {
  readonly lat: number
  readonly lon: number
}

export interface Bounds {
  readonly south: number
  readonly west: number
  readonly north: number
  readonly east: number
}

/**
 * How the map opens:
 * - `view`: the config's centre and zoom, both set;
 * - `fit`: the assets' bounds, then the config's centre or zoom if it set one of them;
 * - `world`: no assets and no full view in the config.
 */
export type InitialView =
  | { readonly kind: 'view'; readonly centre: LatLon; readonly zoom: number }
  | {
      readonly kind: 'fit'
      readonly bounds: Bounds
      readonly centre: LatLon | undefined
      readonly zoom: number | undefined
    }
  | {
      readonly kind: 'world'
      readonly centre: LatLon | undefined
      readonly zoom: number | undefined
    }

/** The smallest box around the assets, or undefined when there are none. */
export function assetBounds(assets: Iterable<WorldAsset>): Bounds | undefined {
  let bounds: Bounds | undefined
  for (const { lat, lon } of assets) {
    bounds =
      bounds === undefined
        ? { south: lat, west: lon, north: lat, east: lon }
        : {
            south: Math.min(bounds.south, lat),
            west: Math.min(bounds.west, lon),
            north: Math.max(bounds.north, lat),
            east: Math.max(bounds.east, lon),
          }
  }
  return bounds
}

/** The opening view: the config's where it sets both, else the assets' bounds (PLY-57). */
export function initialView(
  config: MapRoomConfig | undefined,
  assets: Iterable<WorldAsset>,
): InitialView {
  const centre = config?.centre === undefined ? undefined : { ...config.centre }
  const zoom = config?.zoom
  if (centre !== undefined && zoom !== undefined) return { kind: 'view', centre, zoom }
  const bounds = assetBounds(assets)
  if (bounds === undefined) return { kind: 'world', centre, zoom }
  return { kind: 'fit', bounds, centre, zoom }
}

export interface AssetRow {
  readonly asset: WorldAsset
  readonly forceName: string
}

/** The assets of each force, in force order, then by title; unknown forces last. */
export function assetsByForce(
  state: WorldState,
  forces: readonly Force[],
): { readonly forceId: string; readonly name: string; readonly assets: WorldAsset[] }[] {
  const groups = new Map<string, WorldAsset[]>()
  for (const asset of Object.values(state.assets)) {
    const group = groups.get(asset.forceId)
    if (group === undefined) groups.set(asset.forceId, [asset])
    else group.push(asset)
  }
  const known = forces.filter((f) => groups.has(f.id)).map((f) => ({ forceId: f.id, name: f.name }))
  const unknown = [...groups.keys()]
    .filter((id) => !forces.some((f) => f.id === id))
    .sort()
    .map((id) => ({ forceId: id, name: 'Unknown force' }))
  return [...known, ...unknown].map((g) => ({
    ...g,
    assets: (groups.get(g.forceId) ?? []).sort(
      (a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1),
    ),
  }))
}

/** The table's rows: every asset, by force then title. */
export function assetRows(state: WorldState, forces: readonly Force[]): AssetRow[] {
  return assetsByForce(state, forces).flatMap((g) =>
    g.assets.map((asset) => ({ asset, forceName: g.name })),
  )
}

/** A position in degrees, to four places (about 10 m), with its hemisphere. */
export function formatPosition({ lat, lon }: LatLon): string {
  const part = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`
  return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'W')}`
}

/** A 0–100 value as a percentage, rounded. */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

/** The details of one asset, as label and value, in display order. */
export function assetFields(asset: WorldAsset, forceName: string): [string, string][] {
  return [
    ['Force', forceName],
    ['Category', asset.category],
    ['State', asset.state],
    ['Health', formatPercent(asset.health)],
    ['Fuel', formatPercent(asset.fuel)],
    ['Position', formatPosition(asset)],
    ['Symbol code', asset.sidc],
  ]
}

/** A force's name, or "Unknown force". */
export function forceNameOf(forceId: string, forces: readonly Force[]): string {
  return forces.find((f) => f.id === forceId)?.name ?? 'Unknown force'
}
