// Endpoints are passed in, never imported as constants by library code (NFR-9). Only the tests and the
// demo page build one of these, from env vars or a form.

export interface Endpoints {
  /** wss:// URL of the XMPP WebSocket (RFC 7395). */
  websocketUrl: string;
  /** XMPP domain of accounts, e.g. "localhost". */
  domain: string;
  /** MUC service, e.g. "conference.localhost". */
  mucService: string;
  /** PubSub service, e.g. "pubsub.localhost". */
  pubsubService: string;
}

export const NS_ADMIN = 'http://jabber.org/protocol/admin';
export const NS_ROOMCONFIG = 'http://jabber.org/protocol/muc#roomconfig';
export const NS_NODECONFIG = 'http://jabber.org/protocol/pubsub#node_config';
export const NS_JSON = 'urn:xmpp:json:0';

/** A unique, lower-case resource name, safe as a room or node localpart. */
export const uniq = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
