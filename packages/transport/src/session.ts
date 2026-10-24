// The XMPP-level transport interface (ARC-1, ARC-12). The real transport (WP 1.3) and the mock
// (WP 1.4) both implement it; the domain layer (WP 1.6) is written against it only.
//
// Rules for both implementations:
// - Operations return Outcome<T> and never reject for a server refusal (ARC-14).
// - Live events are callbacks that return an Unsubscribe (ARC-13).
// - Payloads cross as strings. Validation belongs to the domain layer (NFR-5).
// - Times come from the server (MAM, delay stamps), never from the client clock.
// - No type from the XMPP library appears here (WP 0.3 exit plan).
import type { AdminApi } from './admin.ts'
import type { Outcome } from './errors.ts'
import type { MamApi } from './mam.ts'
import type { MucApi } from './muc.ts'
import type { PubsubApi } from './pubsub.ts'

export type Unsubscribe = () => void

/** Where the server is: runtime configuration, never a build constant (NFR-9). */
export interface Endpoint {
  /** `wss://` in production (NFR-2); the mock ignores it. */
  readonly websocketUrl: string
  /** The XMPP domain, e.g. `wrx.example`. */
  readonly domain: string
}

export type Credentials =
  | { readonly kind: 'password'; readonly username: string; readonly password: string }
  /** SASL ANONYMOUS, for the welcome page before login (D20, NFR-21). */
  | { readonly kind: 'anonymous' }

export interface ConnectOptions {
  readonly endpoint: Endpoint
  readonly credentials: Credentials
  /** Resource part of the full JID. Each pane and tab gets its own (D22). */
  readonly resource?: string
}

/** Why a session ended for good. */
export type EndReason =
  /** The client called disconnect(). */
  | 'logout'
  /** The admin ended the session: stream error `policy-violation` (PLY-50). */
  | 'session-ended'
  /** The account was removed: stream error `conflict` (PLY-29, PLY-50). */
  | 'account-removed'
  /** Wrong username or password, or anonymous login refused. */
  | 'auth-failed'
  /** Reconnection gave up. */
  | 'unreachable'

export type ConnectionStatus =
  | { readonly state: 'online' }
  /** The connection dropped and the transport is retrying with back-off (PLY-2). */
  | { readonly state: 'reconnecting'; readonly attempt: number }
  | { readonly state: 'ended'; readonly reason: EndReason; readonly text?: string }

/**
 * How a dropped connection came back.
 * - `resumed`: XEP-0198 resumption; nothing was missed and room membership is intact.
 * - `reconnected`: a new session. Rooms must be rejoined and missed messages fetched from MAM
 *   (PLY-2); the transport does not rejoin by itself.
 */
export type Recovery = 'resumed' | 'reconnected'

/** Addresses found by service discovery; the session is ready once they are known (ARC-2). */
export interface Services {
  /** The MUC service, e.g. `conference.wrx.example`. */
  readonly muc: string
  /** The PubSub service, e.g. `pubsub.wrx.example`. */
  readonly pubsub: string
}

/** A logged-in connection. One per pane; nothing is shared between sessions (D15). */
export interface Session {
  /** Full JID of this session. For an anonymous session, the server-assigned one. */
  readonly jid: string
  readonly anonymous: boolean
  readonly services: Services
  status(): ConnectionStatus
  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe
  onRecovered(listener: (recovery: Recovery) => void): Unsubscribe
  readonly muc: MucApi
  readonly mam: MamApi
  readonly pubsub: PubsubApi
  /** XEP-0133 and service-level administration. Fails `forbidden` unless the account is an admin. */
  readonly admin: AdminApi
  /** Leaves rooms and ends the stream. Resolves once ended; idempotent (PLY-3). */
  disconnect(): Promise<void>
}

/** One backend. `connect` resolves once the session is ready: logged in and services known. */
export interface Transport {
  /** Shown in the UI at all times (PLY-1). */
  readonly kind: 'xmpp' | 'mock'
  connect(options: ConnectOptions): Outcome<Session>
}
