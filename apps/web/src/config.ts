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
//     "defaultBackend": "server"                        // optional: "server" (default) or "mock"
//   }
import type { Endpoint } from '@wrx/transport'

export interface ServerConfig {
  readonly endpoint: Endpoint
  /** Shown as the backend address (PLY-1). Default: the XMPP domain. */
  readonly label: string
}

export interface RuntimeConfig {
  readonly server: ServerConfig | undefined
  readonly defaultBackend: 'server' | 'mock'
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

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

/** Checks a parsed `config.json`; nothing in it is trusted until it passes. */
export function parseConfig(json: unknown, baseUri: string): ConfigResult {
  if (!isRecord(json)) return { ok: false, error: 'config.json must hold an object' }
  const defaultBackend = json.defaultBackend ?? 'server'
  if (defaultBackend !== 'server' && defaultBackend !== 'mock') {
    return { ok: false, error: 'defaultBackend must be "server" or "mock"' }
  }
  const server = json.server
  if (server === undefined)
    return { ok: true, config: { server: undefined, defaultBackend: 'mock' } }
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
  return {
    ok: true,
    config: {
      server: { endpoint: { websocketUrl: url, domain }, label: label?.trim() ?? domain },
      defaultBackend,
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
