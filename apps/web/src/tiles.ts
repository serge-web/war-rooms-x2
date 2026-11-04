// The mock build's base tiles (NFR-9, D12): the mock build reads no config.json (DOC-12), so the
// demo, previews and the site use this built-in default. OpenStreetMap's standard tiles: the
// OSMF tile usage policy allows normal interactive viewing by a person, with visible attribution
// and a Referer, and forbids bulk, offline and heavy use; there is no SLA
// (operations.osmfoundation.org/policies/tiles, read Nov 4, 2026). The server build has no
// default: an operator names a tile server in config.json (`map.tiles`).
//
// No imports: vite.config.ts reads the origin for the mock build's Content-Security-Policy.

/** Shaped as `MapTiles` (@wrx/player-ui); app.test.ts checks it parses as a config would. */
export const DEMO_TILES = Object.freeze({
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  maxZoom: 19,
})

/** The one image origin the mock build's policy adds (`img-src`). */
export const DEMO_TILE_ORIGIN = 'https://tile.openstreetmap.org'
