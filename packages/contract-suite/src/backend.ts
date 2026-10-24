// What a backend hands the contract suite. ejabberd (via @wrx/transport-xmpp) and the mock
// (WP 1.4) each build one of these, and the suite runs unchanged against either (NFR-16).
import type { Outcome, Session } from '@wrx/transport'

export type Login =
  | {
      readonly kind: 'password'
      readonly username: string
      readonly password: string
      readonly resource?: string
    }
  | { readonly kind: 'anonymous'; readonly resource?: string }

/**
 * How a test cuts a session's connection, as a network failure would (PLY-2):
 * - `resumable`: the server still holds the session, so XEP-0198 resumption succeeds;
 * - `lost`: the server's session is gone too, so the client gets a new one.
 */
export type Interruption = 'resumable' | 'lost'

export interface ContractBackend {
  /** Shown in test names, e.g. `ejabberd` or `mock`. */
  readonly name: string
  /** The XMPP domain of accounts, e.g. `localhost`. */
  readonly domain: string
  /** Logs in as a user (the user factory). Refusals resolve as errors, as `Transport.connect` does. */
  connect(login: Login): Outcome<Session>
  /** Logs in as the server administrator (the admin factory). */
  admin(): Outcome<Session>
  /** Cuts the session's connection without a clean close; the session then recovers by itself. */
  interrupt(session: Session, how: Interruption): Promise<void>
}
