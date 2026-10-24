import type { Result } from '@wrx/schemas'
import type { TransportError } from '@wrx/transport'

/** Why a domain operation failed. The UI words the message; `code` is what it branches on. */
export type DomainErrorCode =
  /** The server refused with `forbidden`, `not-allowed` or similar: access was withdrawn (PLY-52). */
  | 'access-withdrawn'
  /** This role may not do this, checked locally before sending (e.g. PLY-35, PLY-37, PLY-12). */
  | 'not-permitted'
  /** The node, room or item does not exist, or was deleted. */
  | 'not-found'
  /** The content failed validation. */
  | 'invalid'
  /** The content is over a size cap (PLY-53, R15). */
  | 'too-large'
  /** The room is not joined, or was closed. */
  | 'not-joined'
  /** The session has ended; nothing more can be sent. */
  | 'session-ended'
  /** Any other transport failure: timeout, disconnection, server error. */
  | 'transport'

export interface DomainError {
  readonly code: DomainErrorCode
  /** Developer-facing explanation. Never parsed for meaning. */
  readonly message: string
  /** The transport error behind this one, when there is one. */
  readonly cause?: TransportError
}

export type DomainResult<T> = Result<T, DomainError>

export function domainOk<T>(value: T): DomainResult<T> {
  return { ok: true, value }
}

export function domainErr(
  code: DomainErrorCode,
  message: string,
  cause?: TransportError,
): { readonly ok: false; readonly error: DomainError } {
  return { ok: false, error: cause === undefined ? { code, message } : { code, message, cause } }
}

/** Conditions that mean the server will not let this session in, now or on retry (PLY-52). */
const WITHDRAWN = Object.freeze([
  'forbidden',
  'not-allowed',
  'not-authorized',
  'registration-required',
  'subscription-required',
])

/** Maps a transport refusal onto a domain error code. */
export function fromTransport(error: TransportError, what: string): DomainError {
  const code: DomainErrorCode = WITHDRAWN.includes(error.condition)
    ? 'access-withdrawn'
    : error.condition === 'item-not-found' || error.condition === 'gone'
      ? 'not-found'
      : error.condition === 'too-large'
        ? 'too-large'
        : error.condition === 'disconnected'
          ? 'session-ended'
          : 'transport'
  const text = error.text === undefined ? '' : `: ${error.text}`
  return { code, message: `${what} failed (${error.condition})${text}`, cause: error }
}
