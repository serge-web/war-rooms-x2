// The map itself (PLY-57): Leaflet 1.9 over the deployment's base tiles (NFR-9), each asset its
// milsymbol symbol. Loaded lazily (`lazy.tsx`), so a client that never opens the map room loads
// neither library. Leaflet needs no eval; its inline styles fit `style-src 'unsafe-inline'` (F7).
//
// Read-only for players: markers cannot be dragged and nothing here writes the world state. The
// admin's editor (WP 5.6, ADM-44) passes `editable`, so symbols can be dragged (`onMove`), and
// `placing`, so a click on the map picks a new asset's position (`onPlace`); the edits themselves
// are the editor's.
import * as L from 'leaflet'
import { useEffect, useRef } from 'react'
import type { MapRoomConfig, WorldAsset } from '@wrx/schemas'
import { sharedSymbols, warmSymbols } from './symbols.ts'
import type { SymbolCache } from './symbols.ts'
import type { MapTiles } from './tiles.tsx'
import { initialView } from './view.ts'
import type { Bounds } from './view.ts'

export interface MapViewProps {
  /** Every asset to draw, keyed by id (§3 rule 16). */
  readonly assets: Readonly<Record<string, WorldAsset>>
  /** The base tiles; undefined draws the assets on a plain background. */
  readonly tiles: MapTiles | undefined
  /** The room's opening view (`mapRoomConfigSchema`); applied once, on the first assets. */
  readonly config: MapRoomConfig | undefined
  /** The selected asset's id, outlined on the map. */
  readonly selected: string | undefined
  /** A symbol was clicked. */
  readonly onSelect: (id: string) => void
  /** The map's accessible name. */
  readonly label: string
  /** Each change fits the map to the assets again ("Show all assets"). */
  readonly fitRequest?: number
  /** Each change pans to the selected asset ("Show on map"). */
  readonly showRequest?: number
  /** The admin's editor (ADM-44): symbols can be dragged; `onMove` gets where each is dropped. */
  readonly editable?: boolean
  readonly onMove?: (id: string, lat: number, lon: number) => void
  /** The next click on the map picks a position (`onPlace`), e.g. for a new asset. */
  readonly placing?: boolean
  readonly onPlace?: (lat: number, lon: number) => void
}

/** The class every symbol's `<img>` carries; tests count them. */
export const SYMBOL_CLASS = 'wrx-map__symbol'
const SELECTED_CLASS = 'wrx-map__symbol--selected'
const WORLD_LAT = 20
const WORLD_LON = 0
const WORLD_ZOOM = 2
const FIT_PADDING = 32
/** Never fit closer than this: one asset alone is not a street plan. */
const FIT_MAX_ZOOM = 14

interface Placed {
  readonly marker: L.Marker
  sidc: string
  title: string
}

function latLngBounds(b: Bounds): L.LatLngBounds {
  return L.latLngBounds([b.south, b.west], [b.north, b.east])
}

function iconFor(symbols: SymbolCache, sidc: string): L.Icon {
  const image = symbols.image(sidc)
  return L.icon({
    iconUrl: image.url,
    iconSize: [image.width, image.height],
    iconAnchor: [image.anchorX, image.anchorY],
    className: SYMBOL_CLASS,
  })
}

/** Fits the assets, or shows the world when there are none. */
function fitAssets(map: L.Map, assets: Iterable<WorldAsset>): void {
  const view = initialView(undefined, assets)
  if (view.kind === 'fit') {
    map.fitBounds(latLngBounds(view.bounds), {
      padding: [FIT_PADDING, FIT_PADDING],
      maxZoom: FIT_MAX_ZOOM,
    })
  } else {
    map.setView([WORLD_LAT, WORLD_LON], WORLD_ZOOM)
  }
}

function openView(map: L.Map, config: MapRoomConfig | undefined, assets: WorldAsset[]): void {
  const view = initialView(config, assets)
  switch (view.kind) {
    case 'view':
      map.setView([view.centre.lat, view.centre.lon], view.zoom)
      return
    case 'world':
      map.setView(
        view.centre === undefined ? [WORLD_LAT, WORLD_LON] : [view.centre.lat, view.centre.lon],
        view.zoom ?? WORLD_ZOOM,
      )
      return
    case 'fit': {
      const bounds = latLngBounds(view.bounds)
      const zoom =
        view.zoom ??
        Math.min(map.getBoundsZoom(bounds, false, L.point(FIT_PADDING, FIT_PADDING)), FIT_MAX_ZOOM)
      const centre =
        view.centre === undefined ? bounds.getCenter() : L.latLng(view.centre.lat, view.centre.lon)
      map.setView(centre, zoom)
    }
  }
}

interface Latest {
  readonly assets: Readonly<Record<string, WorldAsset>>
  readonly config: MapRoomConfig | undefined
  readonly selected: string | undefined
}

/**
 * The opening view, once, when the map has a size: a map first shown in a hidden pane (the
 * table view) would otherwise fit the assets into nothing.
 */
function openWhenShown(
  map: L.Map,
  container: HTMLElement,
  opened: { current: boolean },
  latest: { readonly current: Latest },
): void {
  if (opened.current) return
  if (container.clientWidth === 0 || container.clientHeight === 0) return
  opened.current = true
  map.invalidateSize({ pan: false })
  openView(map, latest.current.config, Object.values(latest.current.assets))
}

/**
 * Leaflet follows a drag on the global `document`, which in a popped-out tab is the opener's
 * (the popout renders from the opener's script, PLY-4). Once a press starts in another document,
 * this passes that document's moves and releases to the opener's, so a drag works there as
 * well. Checked on each press, since the map may move into a popout without remounting. Returns
 * the clean-up.
 */
function forwardPopoutDrags(container: HTMLElement): () => void {
  const mouse = ['mousemove', 'mouseup'] as const
  const pointer = ['pointermove', 'pointerup', 'pointercancel'] as const
  let attached: Document | undefined
  // At an element, as Leaflet marks a drag's target with a class; it bubbles to `document`.
  const forwardMouse = (event: MouseEvent) => {
    document.documentElement.dispatchEvent(new MouseEvent(event.type, event))
  }
  const forwardPointer = (event: PointerEvent) => {
    document.documentElement.dispatchEvent(new PointerEvent(event.type, event))
  }
  const detach = () => {
    if (attached === undefined) return
    for (const type of mouse) attached.removeEventListener(type, forwardMouse)
    for (const type of pointer) attached.removeEventListener(type, forwardPointer)
    attached = undefined
  }
  const onPress = () => {
    const own = container.ownerDocument
    if (own === attached) return
    detach()
    if (own === document) return
    attached = own
    for (const type of mouse) own.addEventListener(type, forwardMouse)
    for (const type of pointer) own.addEventListener(type, forwardPointer)
  }
  container.addEventListener('pointerdown', onPress, true)
  container.addEventListener('mousedown', onPress, true)
  return () => {
    container.removeEventListener('pointerdown', onPress, true)
    container.removeEventListener('mousedown', onPress, true)
    detach()
  }
}

export function MapView({
  assets,
  tiles,
  config,
  selected,
  onSelect,
  label,
  fitRequest = 0,
  showRequest = 0,
  editable = false,
  onMove,
  placing = false,
  onPlace,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | undefined>(undefined)
  const layerRef = useRef<L.LayerGroup | undefined>(undefined)
  const placedRef = useRef(new Map<string, Placed>())
  const symbolsRef = useRef<SymbolCache>(sharedSymbols)
  const openedRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  const onMoveRef = useRef(onMove)
  const onPlaceRef = useRef(placing ? onPlace : undefined)
  const editableRef = useRef(editable)
  const latest = useRef<Latest>({ assets, config, selected })
  latest.current = { assets, config, selected }
  useEffect(() => {
    onSelectRef.current = onSelect
    onMoveRef.current = onMove
    onPlaceRef.current = placing ? onPlace : undefined
    editableRef.current = editable
  }, [onSelect, onMove, onPlace, placing, editable])

  // The map, once per mount.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    // No tile fades or zoom animation for a reader who asked for less motion (WCAG 2.3.3).
    const still =
      container.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')
        .matches === true
    const map = L.map(container, {
      fadeAnimation: !still,
      zoomAnimation: !still,
      markerZoomAnimation: !still,
      attributionControl: false,
      keyboard: true,
      zoomControl: true,
      worldCopyJump: true,
      minZoom: 1,
      maxZoom: tiles?.maxZoom ?? 19,
    })
    // Symbols are decoration for assistive technology: the table is the accessible view.
    for (const pane of ['tilePane', 'markerPane', 'shadowPane'] as const) {
      map.getPane(pane)?.setAttribute('aria-hidden', 'true')
    }
    if (tiles !== undefined) {
      L.tileLayer(tiles.url, {
        maxZoom: tiles.maxZoom,
        // The tile server sees which site asks (OSMF policy), whatever the page's own
        // Referrer-Policy; never the page's path or hash.
        referrerPolicy: 'strict-origin',
        // Never `crossOrigin`: the tiles are only shown, never read back.
      }).addTo(map)
    }
    const layer = L.layerGroup().addTo(map)
    // A click picks a position while the editor is placing (ADM-44); a symbol's click does not
    // reach the map, so selecting stays selecting.
    map.on('click', (event: L.LeafletMouseEvent) => {
      onPlaceRef.current?.(event.latlng.lat, event.latlng.lng)
    })
    mapRef.current = map
    layerRef.current = layer
    const placed = placedRef.current
    const observer = new ResizeObserver(() => {
      // Keep the centre where it was: the details opening below the map must not push the view off.
      map.invalidateSize({ pan: true, animate: false })
      openWhenShown(map, container, openedRef, latest)
    })
    observer.observe(container)
    const stopForwarding = forwardPopoutDrags(container)
    // No view yet: the effect below opens at the assets' view, so no tile is fetched for a view
    // that is replaced at once.
    return () => {
      stopForwarding()
      observer.disconnect()
      map.remove()
      placed.clear()
      mapRef.current = undefined
      layerRef.current = undefined
      openedRef.current = false
    }
  }, [tiles])

  // The symbols: moved, redrawn, added and removed to match the state.
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (map === undefined || layer === undefined) return
    const placed = placedRef.current
    const container = containerRef.current
    // The opening view first; a hidden map (the table view) takes the world until it is shown.
    if (container !== null) openWhenShown(map, container, openedRef, latest)
    if (!openedRef.current && placed.size === 0) map.setView([WORLD_LAT, WORLD_LON], WORLD_ZOOM)
    for (const [id, entry] of placed) {
      if (assets[id] === undefined) {
        layer.removeLayer(entry.marker)
        placed.delete(id)
      }
    }
    for (const asset of Object.values(assets)) {
      const entry = placed.get(asset.id)
      if (entry === undefined) {
        const marker = L.marker([asset.lat, asset.lon], {
          icon: iconFor(symbolsRef.current, asset.sidc),
          // Not a tab stop each: 600 symbols would bury the page (the table is the keyboard way).
          keyboard: false,
          title: asset.title,
          alt: asset.title,
          riseOnHover: true,
        })
        marker.on('click', () => {
          onSelectRef.current(asset.id)
        })
        // The admin's drag (ADM-44): selected while dragged, its drop reported.
        marker.on('dragstart', () => {
          onSelectRef.current(asset.id)
        })
        marker.on('dragend', () => {
          const at = marker.getLatLng()
          onMoveRef.current?.(asset.id, at.lat, at.lng)
        })
        layer.addLayer(marker)
        if (editableRef.current) marker.dragging?.enable()
        const element = marker.getElement()
        element?.setAttribute('data-asset', asset.id)
        if (asset.id === latest.current.selected) element?.classList.add(SELECTED_CLASS)
        placed.set(asset.id, { marker, sidc: asset.sidc, title: asset.title })
        continue
      }
      const at = entry.marker.getLatLng()
      if (at.lat !== asset.lat || at.lng !== asset.lon)
        entry.marker.setLatLng([asset.lat, asset.lon])
      if (entry.sidc !== asset.sidc) {
        entry.marker.setIcon(iconFor(symbolsRef.current, asset.sidc))
        entry.sidc = asset.sidc
        const element = entry.marker.getElement()
        element?.setAttribute('data-asset', asset.id)
        if (asset.id === latest.current.selected) element?.classList.add(SELECTED_CLASS)
      }
      if (entry.title !== asset.title) {
        const element = entry.marker.getElement()
        if (element instanceof HTMLImageElement) {
          element.alt = asset.title
          element.title = asset.title
        }
        entry.title = asset.title
      }
    }
  }, [assets, tiles])

  // Dragging, for the admin's editor only.
  useEffect(() => {
    for (const entry of placedRef.current.values()) {
      if (editable) entry.marker.dragging?.enable()
      else entry.marker.dragging?.disable()
    }
  }, [editable, assets, tiles])

  // The selection's outline.
  useEffect(() => {
    for (const [id, entry] of placedRef.current) {
      entry.marker.getElement()?.classList.toggle(SELECTED_CLASS, id === selected)
      if (id === selected) entry.marker.setZIndexOffset(1000)
      else entry.marker.setZIndexOffset(0)
    }
  }, [selected, assets, tiles])

  useEffect(() => {
    const map = mapRef.current
    if (fitRequest === 0 || map === undefined) return
    fitAssets(map, Object.values(latest.current.assets))
  }, [fitRequest])

  useEffect(() => {
    const map = mapRef.current
    const id = latest.current.selected
    const asset = id === undefined ? undefined : latest.current.assets[id]
    if (showRequest === 0 || map === undefined || asset === undefined) return
    map.setView([asset.lat, asset.lon], Math.max(map.getZoom(), 10))
  }, [showRequest])

  return (
    <div
      ref={containerRef}
      className={placing ? 'wrx-map__canvas wrx-map__canvas--placing' : 'wrx-map__canvas'}
      role="region"
      aria-label={label}
      aria-roledescription="map"
    />
  )
}

/**
 * Runs Leaflet's code paths for a map with a draggable marker, on a map that is never shown, so
 * the first real map does not also pay for compiling them.
 */
function warmLeaflet(): void {
  const container = document.createElement('div')
  const map = L.map(container, { attributionControl: false, zoomControl: false })
  map.setView([WORLD_LAT, WORLD_LON], WORLD_ZOOM)
  const marker = L.marker([WORLD_LAT, WORLD_LON], {
    icon: iconFor(sharedSymbols, 'SFGPUCI----K---'),
    keyboard: false,
    riseOnHover: true,
  })
  L.layerGroup().addTo(map).addLayer(marker)
  marker.dragging?.enable()
  marker.setZIndexOffset(0)
  marker.getElement()?.classList.toggle(SELECTED_CLASS, false)
  map.remove()
}

/**
 * Work the map's first render would otherwise do, done ahead while the browser is idle (WP 5.9,
 * NFR-11): milsymbol's set-up, then Leaflet's, one step per call. Returns false when there is
 * nothing left.
 */
export const warmUp: () => boolean = createWarmUp()

/** The warm-up's steps, each once; holds only whether Leaflet's step has run (no session data). */
function createWarmUp(): () => boolean {
  let leafletDone = false
  return () => {
    if (warmSymbols()) return true
    if (leafletDone) return false
    leafletDone = true
    warmLeaflet()
    return true
  }
}

export default MapView
