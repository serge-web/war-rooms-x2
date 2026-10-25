// Client-side size caps (PLY-53, R15). The server sets no WebSocket message limit (WP 0.1), so
// the transport refuses oversized payloads with `too-large` before anything is sent.
import { LIMITS } from '@wrx/schemas'

/** UTF-8 byte length of a string. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Whether a serialised message stanza is within the cap: 65,536 bytes of UTF-8 after XML
 * escaping, the whole `<message/>` element included (S13, PLY-53).
 */
export function messageWithinCap(serialisedStanza: string): boolean {
  return utf8Bytes(serialisedStanza) <= LIMITS.messageStanzaBytes
}

/**
 * The largest JSON payload, in UTF-8 bytes, that the transport publishes as one PubSub item:
 * ejabberd's default `max_payload_size` (250,000) less room for the XML around it. ejabberd
 * measures the payload's character data unescaped (WP 1.3 probe: 360 kB of escaped quotes in a
 * 60 kB payload is accepted), so the JSON text is what is counted.
 */
export const PUBSUB_PAYLOAD_CAP_BYTES = LIMITS.pubsubItemBytes - LIMITS.pubsubItemOverheadBytes

export function payloadWithinCap(json: string): boolean {
  return utf8Bytes(json) <= PUBSUB_PAYLOAD_CAP_BYTES
}
