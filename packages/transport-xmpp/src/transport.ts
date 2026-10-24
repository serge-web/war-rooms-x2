// The real transport (ARC-1): @wrx/transport over StanzaJS 12.22.1, against ejabberd by default.
import type { ConnectOptions, Outcome, Session, Transport } from '@wrx/transport'
import { DEFAULT_BACKOFF } from './backoff.ts'
import type { BackoffOptions } from './backoff.ts'
import { ejabberd } from './ejabberd.ts'
import type { ServerAdapter } from './server-adapter.ts'
import { XmppSession } from './session.ts'

export interface XmppTransportOptions {
  /** The server adapter (ARC-8). Defaults to ejabberd, the reference server (NFR-22). */
  readonly adapter?: ServerAdapter
  /** Reconnect back-off (PLY-2). */
  readonly backoff?: Partial<BackoffOptions>
  /** How long to wait for a reply, and for login, in ms. Default 15 s. */
  readonly timeoutMs?: number
  /** XEP-0199 keep-alive interval in seconds; 0 turns it off. Default 60 s. */
  readonly keepAliveSeconds?: number
}

export class XmppTransport implements Transport {
  readonly kind = 'xmpp'

  constructor(private readonly options: XmppTransportOptions = {}) {}

  /** Endpoints come in with each call, never from build-time constants (NFR-9). */
  connect(options: ConnectOptions): Outcome<Session> {
    return XmppSession.open(options, {
      adapter: this.options.adapter ?? ejabberd,
      backoff: { ...DEFAULT_BACKOFF, ...this.options.backoff },
      timeoutMs: this.options.timeoutMs ?? 15_000,
      smWaitMs: 5_000,
      keepAliveSeconds: this.options.keepAliveSeconds ?? 60,
    })
  }
}
