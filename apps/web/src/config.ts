// Runtime configuration (NFR-9): the real server's endpoints come from a `config.json` next to
// `index.html`, read when the page loads, never from a build constant. It is optional: with no
// file (or on file hosting, where it cannot be fetched) the client runs on the mock (NFR-8).
//
//   {
//     "server": {
//       "websocketUrl": "wss://xmpp.example.org/ws",   // or a path on this origin: "/ws"
//       "domain": "example.org",
//       "label": "Exercise server"                       // optional; shown in the badge
//     },
//     "defaultBackend": "server",                       // optional: "server" (default) or "mock"
//     "map": {                                          // optional: the map room's base tiles
//       "tiles": {
//         "url": "https://tiles.example.org/{z}/{x}/{y}.png",  // or a path on this origin
//         "attribution": "© OpenStreetMap contributors",       // plain text, shown on the map
//         "attributionUrl": "https://www.openstreetmap.org/copyright",  // optional, https:
//         "maxZoom": 19                                         // optional, default 19
//       }
//     }
//   }
//
// Without `map.tiles` the map shows the assets on a plain background: the server build sends no
// player's view to a third-party tile server unless the operator chooses one (D12, R30). The
// tile host must also be allowed by the page's `img-src` (deploy/README.md).
import { TILE_MAX_ZOOM, TILE_PLACEHOLDERS } from '@wrx/player-ui'
import type { MapTiles } from '@wrx/player-ui'
import type { Endpoint } from '@wrx/transport'

export interface ServerConfig {
  readonly endpoint: Endpoint
  /** Shown as the backend address (PLY-1). Default: the XMPP domain. */
  readonly label: string
}

export interface RuntimeConfig {
  readonly server: ServerConfig | undefined
  readonly defaultBackend: 'server' | 'mock'
  /** The map room's base tiles (NFR-9); undefined: no base map. */
  readonly tiles?: MapTiles | undefined
}

export type ConfigResult =
  | { readonly ok: true; readonly config: RuntimeConfig }
  | { readonly ok: false; readonly error: string }

export const NO_CONFIG: RuntimeConfig = Object.freeze({
  server: undefined,
  defaultBackend: 'mock',
})

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The WebSocket URL as an absolute `ws:` or `wss:` URL. A path or `http(s):` URL is taken
 * relative to the page, for a reverse proxy on the same origin (NFR-8, first mode).
 */
export function websocketUrl(value: string, baseUri: string): string | undefined {
  let url: URL
  try {
    url = new URL(value, baseUri)
  } catch {
    return undefined
  }
  if (url.protocol === 'http:') url.protocol = 'ws:'
  else if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return undefined
  return url.href
}

/**
 * Whether a host is this machine: `localhost` (and `*.localhost`), 127.0.0.0/8 or `[::1]`.
 * Only there is plaintext `ws:` accepted (security review F13): elsewhere messages, objectives
 * and the session would cross the network in clear, though SCRAM protects the password.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(host)
  )
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

const MAX_ATTRIBUTION = 200
const MAX_TILE_URL = 500
const PLACEHOLDER = /\{([a-z])\}/g

/**
 * A tile URL template: absolute `https:`, `http:` to this machine only (as `ws:`, F13), or a path
 * on this origin; `{z}`, `{x}` and `{y}` present, braces only as placeholders Leaflet fills, and
 * no credentials. Returned absolute, with the placeholders as they were.
 */
export function tileUrl(value: string, baseUri: string): string | undefined {
  if (value.length > MAX_TILE_URL) return undefined
  const names = [...value.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '')
  const rest = value.replace(PLACEHOLDER, '')
  if (rest.includes('{') || rest.includes('}')) return undefined
  if (names.some((n) => !TILE_PLACEHOLDERS.includes(n))) return undefined
  if (!['z', 'x', 'y'].every((n) => names.includes(n))) return undefined
  let url: URL
  try {
    url = new URL(value.replace(PLACEHOLDER, '__$1__'), baseUri)
  } catch {
    return undefined
  }
  if (url.username !== '' || url.password !== '') return undefined
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    return undefined
  }
  return url.href.replace(/__([a-z])__/g, '{$1}')
}

type TilesResult =
  | { readonly ok: true; readonly tiles: MapTiles | undefined }
  | { readonly ok: false; readonly error: string }

/** Reads `map.tiles`: undefined (no base map) when it is absent. */
export function parseTiles(map: unknown, baseUri: string): TilesResult {
  if (map === undefined) return { ok: true, tiles: undefined }
  if (!isRecord(map)) return { ok: false, error: 'map must be an object' }
  const tiles = map.tiles
  if (tiles === undefined) return { ok: true, tiles: undefined }
  if (!isRecord(tiles)) return { ok: false, error: 'map.tiles must be an object' }
  const { url: rawUrl, attribution, attributionUrl, maxZoom } = tiles
  const url = typeof rawUrl === 'string' ? tileUrl(rawUrl, baseUri) : undefined
  if (url === undefined) {
    return {
      ok: false,
      error:
        'map.tiles.url must be an https: URL template, or a path on this origin, with {z}, {x} and {y}',
    }
  }
  if (
    typeof attribution !== 'string' ||
    attribution.trim() === '' ||
    attribution.length > MAX_ATTRIBUTION
  ) {
    return {
      ok: false,
      error: `map.tiles.attribution must be text of up to ${MAX_ATTRIBUTION} characters`,
    }
  }
  let link: string | undefined
  if (attributionUrl !== undefined) {
    let parsed: URL | undefined
    try {
      parsed = typeof attributionUrl === 'string' ? new URL(attributionUrl) : undefined
    } catch {
      parsed = undefined
    }
    if (parsed?.protocol !== 'https:') {
      return { ok: false, error: 'map.tiles.attributionUrl must be an https: URL' }
    }
    link = parsed.href
  }
  if (
    maxZoom !== undefined &&
    (typeof maxZoom !== 'number' ||
      !Number.isInteger(maxZoom) ||
      maxZoom < 0 ||
      maxZoom > TILE_MAX_ZOOM)
  ) {
    return {
      ok: false,
      error: `map.tiles.maxZoom must be a whole number from 0 to ${TILE_MAX_ZOOM}`,
    }
  }
  return {
    ok: true,
    tiles: {
      url,
      attribution: attribution.trim(),
      attributionUrl: link,
      maxZoom: typeof maxZoom === 'number' ? maxZoom : 19,
    },
  }
}

/** Checks a parsed `config.json`; nothing in it is trusted until it passes. */
export function parseConfig(json: unknown, baseUri: string): ConfigResult {
  if (!isRecord(json)) return { ok: false, error: 'config.json must hold an object' }
  const defaultBackend = json.defaultBackend ?? 'server'
  if (defaultBackend !== 'server' && defaultBackend !== 'mock') {
    return { ok: false, error: 'defaultBackend must be "server" or "mock"' }
  }
  const map = parseTiles(json.map, baseUri)
  if (!map.ok) return map
  const tiles = map.tiles
  const server = json.server
  if (server === undefined)
    return { ok: true, config: { server: undefined, defaultBackend: 'mock', tiles } }
  if (!isRecord(server)) return { ok: false, error: 'server must be an object' }
  const { websocketUrl: rawUrl, domain, label } = server
  if (typeof rawUrl !== 'string') return { ok: false, error: 'server.websocketUrl is missing' }
  if (typeof domain !== 'string' || !DOMAIN.test(domain)) {
    return { ok: false, error: 'server.domain must be a domain name' }
  }
  if (label !== undefined && (typeof label !== 'string' || label.trim() === '')) {
    return { ok: false, error: 'server.label must be text' }
  }
  const url = websocketUrl(rawUrl, baseUri)
  if (url === undefined) {
    return { ok: false, error: 'server.websocketUrl must be a ws:, wss: or same-origin URL' }
  }
  const { protocol, hostname } = new URL(url)
  if (protocol === 'ws:' && !isLoopbackHost(hostname)) {
    return {
      ok: false,
      error: `server.websocketUrl must use wss: (TLS); plain ws: is allowed only to localhost or 127.0.0.1, not ${hostname}`,
    }
  }
  return {
    ok: true,
    config: {
      server: { endpoint: { websocketUrl: url, domain }, label: label?.trim() ?? domain },
      defaultBackend,
      tiles,
    },
  }
}

/**
 * Reads `config.json` next to the page. Missing or unreachable is not an error: the client
 * runs on the mock. An invalid file is reported, and the mock is used.
 */
export async function loadConfig(
  fetcher: (url: string) => Promise<Response>,
  baseUri: string,
): Promise<ConfigResult> {
  let response: Response
  try {
    response = await fetcher(new URL('config.json', baseUri).href)
  } catch {
    return { ok: true, config: NO_CONFIG }
  }
  if (response.status === 404 || !response.ok) return { ok: true, config: NO_CONFIG }
  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { ok: false, error: 'config.json is not valid JSON' }
  }
  return parseConfig(json, baseUri)
}
