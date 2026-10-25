// Client-side size caps, as the real transport applies them (transport-xmpp size.ts, PLY-53,
// R15), from the shared LIMITS: both backends refuse the same payloads with `too-large` (S03).
import { LIMITS } from '@wrx/schemas'

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * The groupchat stanza the real transport sends for this body, serialised as StanzaJS does, so
 * the cap counts the same bytes: the whole element after XML escaping (S13).
 */
export function messageStanza(id: string, room: string, body: string): string {
  const i = escapeAttribute(id)
  return (
    `<message xmlns="jabber:client" id="${i}" to="${escapeAttribute(room)}" type="groupchat">` +
    `<body>${escapeText(body)}</body><origin-id xmlns="urn:xmpp:sid:0" id="${i}"/></message>`
  )
}

export function messageWithinCap(stanza: string): boolean {
  return utf8Bytes(stanza) <= LIMITS.messageStanzaBytes
}

/** The largest JSON payload one item may carry: the item limit less the XML around it. */
export const PUBSUB_PAYLOAD_CAP_BYTES = LIMITS.pubsubItemBytes - LIMITS.pubsubItemOverheadBytes

export function payloadWithinCap(json: string): boolean {
  return utf8Bytes(json) <= PUBSUB_PAYLOAD_CAP_BYTES
}

/** XEP-0049 keys become part of an XML namespace on the real transport, so the same alphabet. */
export const PRIVATE_KEY_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/
