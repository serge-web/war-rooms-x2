// The outgoing message cap (PLY-53, R15): the stanza, as UTF-8 after XML escaping.
import { LIMITS } from '@wrx/schemas'

/**
 * Bytes reserved for the `<message>` element around the body: `to`, `id`, `type` and the
 * namespaces. A generous bound, so the body check alone keeps the stanza under the cap.
 */
export const STANZA_ENVELOPE_BYTES = 1_024

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
})

/** UTF-8 length of `text` once escaped as XML character data. */
export function escapedByteLength(text: string): number {
  const escaped = text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
  return new TextEncoder().encode(escaped).length
}

/**
 * Whether a message body fits in one stanza under the client cap: 65,536 bytes, or the
 * world-state cap of 500,000 for a world-state message in the map room (PLY-53).
 */
export function fitsInStanza(
  body: string,
  limitBytes: number = LIMITS.messageStanzaBytes,
): { ok: boolean; bytes: number; limitBytes: number } {
  const bytes = escapedByteLength(body) + STANZA_ENVELOPE_BYTES
  return { ok: bytes <= limitBytes, bytes, limitBytes }
}

/** UTF-8 length of `text` escaped as the transports escape message text: `&`, `<` and `>` only. */
export function textEscapedByteLength(text: string): number {
  const escaped = text.replace(/[&<>]/g, (c) => ESCAPES[c] ?? c)
  return new TextEncoder().encode(escaped).length
}

/**
 * Whether a world-state body fits the map-room cap, 500,000 bytes (PLY-53, D25). Counted as the
 * transports count the stanza (StanzaJS and the mock escape only `&`, `<` and `>` in text), not
 * with `fitsInStanza`'s quote escaping, which would cost a quote-heavy JSON state about a third
 * of its room.
 */
export function fitsWorldStateStanza(body: string): {
  ok: boolean
  bytes: number
  limitBytes: number
} {
  const bytes = textEscapedByteLength(body) + STANZA_ENVELOPE_BYTES
  const limitBytes = LIMITS.worldStateStanzaBytes
  return { ok: bytes <= limitBytes, bytes, limitBytes }
}
