// The map room's player panel (PLY-57, ARC-5): Leaflet and milsymbol, loaded with the map's
// own chunk; their styles load here, with the panel, so a popout has them.
import 'leaflet/dist/leaflet.css'
import './map.css'

export { MapPanel, MapPanelCore } from './map-panel.tsx'
export type { MapPanelCoreProps } from './map-panel.tsx'
export { LazyMapView, LazySymbolPreview, MapPreload, preloadMapView } from './lazy.tsx'
export { AssetForm, readAssetForm } from './asset-form.tsx'
export type { AssetFormProps } from './asset-form.tsx'
export { WorldStateSummary, describeChange, summaryLine } from './change-summary.tsx'
export type { WorldStateSummaryProps } from './change-summary.tsx'
export { memoryWorldDraftStorage, webWorldDraftStorage } from './draft-storage.ts'
export type {
  DraftSnapshot,
  DraftStorageLike,
  JustPublished,
  WorldDraftStorage,
} from './draft-storage.ts'
export { ConfirmPanel, DraftBanner, PublishPanel, newAsset } from './map-editor.tsx'
export type { MapEditing } from './map-editor.tsx'
export {
  WorldDraftProvider,
  draftForTurn,
  readPublishedWorldState,
  sizeRefusal,
  useAdminWorldDraft,
  useDraftSnapshot,
  useMapRoomId,
  useWorldDraftStorage,
  worldPublishErrorText,
} from './world-draft.tsx'
export type { AdminWorldDraft } from './world-draft.tsx'
export type { MapViewProps } from './leaflet-map.tsx'
export { MapTilesProvider, TILE_MAX_ZOOM, TILE_PLACEHOLDERS, useMapTiles } from './tiles.tsx'
export type { MapTiles } from './tiles.tsx'
export {
  assetBounds,
  assetFields,
  assetRows,
  assetsByForce,
  forceNameOf,
  formatPercent,
  formatPosition,
  initialView,
} from './view.ts'
export type { AssetRow, Bounds, InitialView, LatLon } from './view.ts'
