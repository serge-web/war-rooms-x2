// @wrx/transport-xmpp: the only package that imports StanzaJS (WP 0.3). It exports the transport
// and its server adapters; no StanzaJS type leaves it.
export { XmppTransport } from './transport.ts'
export type { XmppTransportOptions } from './transport.ts'
export { XmppSession } from './session.ts'
export type { BackoffOptions } from './backoff.ts'
export { ejabberd } from './ejabberd.ts'
export type { ServerAdapter } from './server-adapter.ts'
