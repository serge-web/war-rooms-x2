// What the MUC, MAM, PubSub and admin modules need from their session.
import type { Outcome, Services } from '@wrx/transport'
import type * as XMPP from 'stanza'
import type { ServerAdapter } from './server-adapter.ts'

export type Agent = XMPP.Agent
/** Always pass this to `sendIQ`: its default reply type echoes the request (WP 0.3). */
export type IQ = XMPP.Stanzas.IQ

/**
 * `sendIQ` typed as the IQ it really returns. StanzaJS's `sendIQ<T = IQ, R = T>` infers the reply
 * type from the request literal, so without an explicit `<IQ>` the reply is typed as an echo of
 * the request (WP 0.3, typing-probes.ts).
 */
export function sendIq(client: Agent, iq: IQ): Promise<IQ> {
  // The explicit argument changes inference, so it is not the redundant default the rule sees.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-arguments
  return client.sendIQ<IQ>(iq)
}

export interface Core {
  readonly client: Agent
  readonly adapter: ServerAdapter
  /** The XMPP domain of accounts; XEP-0133 commands go to it. */
  readonly domain: string
  /** How long to wait for a reply that is not an IQ result (join, reflection), in ms. */
  readonly timeoutMs: number
  services(): Services
  /** This session's bare JID. */
  bareJid(): string
  /**
   * Runs one operation: a server refusal or a timeout resolves as a TransportError, and so does
   * the session ending first (`disconnected`). Anything else is a bug and rejects (ARC-14).
   */
  run<T>(operation: () => Promise<T>): Outcome<T>
}
