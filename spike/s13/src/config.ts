// S13 connection settings. Adapted from serge-web/xmpp-spike spike/tests/config.ts (commit 4992530):
// ejabberd only, and one entry per server in docker/compose.yaml.

import { fileURLToPath } from 'node:url'

export type Target = 'reference' | 'wscap' | 'adhocapi'

export interface ServerConfig {
  target: Target
  /** docker compose service name, used to restart it and read its log. */
  service: string
  domain: string
  mucDomain: string
  websocketUrl: string
}

const base = { domain: 'localhost', mucDomain: 'conference.localhost' } as const

export const servers: Record<Target, ServerConfig> = {
  reference: {
    ...base,
    target: 'reference',
    service: 'ejabberd',
    websocketUrl: process.env['S13_WS'] ?? 'ws://localhost:15280/ws',
  },
  wscap: {
    ...base,
    target: 'wscap',
    service: 'ejabberd-wscap',
    websocketUrl: process.env['S13_WS_WSCAP'] ?? 'ws://localhost:15281/ws',
  },
  adhocapi: {
    ...base,
    target: 'adhocapi',
    service: 'ejabberd-adhocapi',
    websocketUrl: process.env['S13_WS_ADHOCAPI'] ?? 'ws://localhost:15282/ws',
  },
}

/** The operator-bootstrap admin password (docker/bootstrap.sh). The admin's own credential. */
export const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? 'spike-password'

/** Same digest as the reference compose file. */
export const IMAGE =
  'ejabberd/ecs:26.09@sha256:8ebff5b218e686d5dbd93850ea17556d5b70d4c15918c3613e9302a357798e0e'

export const S13_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const COMPOSE_DIR = fileURLToPath(new URL('../docker/', import.meta.url))

/**
 * Room configuration of every WRX1 game room on the reference deployment: the spike's ejabberd
 * profile (serge-web/xmpp-spike spike/tests/provision/ejabberd.ts, commit 4992530).
 */
export const GAME_ROOM_CONFIG: Record<string, string | boolean> = {
  'muc#roomconfig_persistentroom': true,
  'muc#roomconfig_membersonly': true,
  'muc#roomconfig_moderatedroom': true,
  'muc#roomconfig_publicroom': false,
  'muc#roomconfig_whois': 'moderators',
  allow_voice_requests: false,
  allow_private_messages_from_visitors: 'nobody',
  allow_visitor_status: false,
  allow_visitor_nickchange: false,
  mam: true,
}
