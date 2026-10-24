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

/** Whether a message body fits in one stanza under the client cap. */
export function fitsInStanza(body: string): { ok: boolean; bytes: number; limitBytes: number } {
  const bytes = escapedByteLength(body) + STANZA_ENVELOPE_BYTES
  return { ok: bytes <= LIMITS.messageStanzaBytes, bytes, limitBytes: LIMITS.messageStanzaBytes }
}
