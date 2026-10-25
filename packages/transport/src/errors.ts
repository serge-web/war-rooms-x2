import type { Result } from '@wrx/schemas'

/**
 * XMPP stanza error conditions the transport reports (RFC 6120 §8.3.3). Implementations map
 * server-specific errors onto these; the mock returns the same ones (ARC-11).
 */
export const XMPP_CONDITIONS = Object.freeze([
  'bad-request',
  'conflict',
  'feature-not-implemented',
  'forbidden',
  'gone',
  'internal-server-error',
  'item-not-found',
  'jid-malformed',
  'not-acceptable',
  'not-allowed',
  'not-authorized',
  'policy-violation',
  'recipient-unavailable',
  'redirect',
  'registration-required',
  'remote-server-not-found',
  'remote-server-timeout',
  'resource-constraint',
  'service-unavailable',
  'subscription-required',
  'undefined-condition',
  'unexpected-request',
] as const)

export type XmppCondition = (typeof XMPP_CONDITIONS)[number]

/** Failures the transport itself detects, with no stanza error behind them. */
export type LocalCondition =
  /** No reply within the operation's timeout. */
  | 'timeout'
  /** The session ended before the reply arrived. */
  | 'disconnected'
  /** A reply arrived but did not have the expected shape. */
  | 'invalid-response'
  /** The client refused to send: the payload is over a size cap (PLY-53, R15). */
  | 'too-large'

export interface TransportError {
  readonly condition: XmppCondition | LocalCondition
  /** The error's `type` attribute, when the server sent one. */
  readonly type?: 'auth' | 'cancel' | 'continue' | 'modify' | 'wait'
  /** Human-readable text from the server or the transport. Never parsed for meaning. */
  readonly text?: string
}

/**
 * Every operation resolves to a Result and never rejects for a server refusal or a timeout
 * (ARC-14). A rejected promise means a bug in the transport, not a condition to handle.
 */
export type Outcome<T> = Promise<Result<T, TransportError>>

export function ok<T>(value: T): Result<T, TransportError> {
  return { ok: true, value }
}

export function err(
  condition: TransportError['condition'],
  text?: string,
  type?: TransportError['type'],
): Result<never, TransportError> {
  const error: TransportError = {
    condition,
    ...(text === undefined ? {} : { text }),
    ...(type === undefined ? {} : { type }),
  }
  return { ok: false, error }
}

export function isXmppCondition(value: string): value is XmppCondition {
  return (XMPP_CONDITIONS as readonly string[]).includes(value)
}
