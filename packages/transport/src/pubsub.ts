// XEP-0060 Publish-Subscribe on the game's PubSub service: entity use (§6–7) and owner use (§8).
// Items carry one JSON payload each (XEP-0335, `urn:xmpp:json:0`), passed here as a string.
// Single-document nodes (`game-setup`, `forces:<id>` and the like) hold one item, id `current`.
import type { Outcome } from './errors.ts'
import type { Unsubscribe } from './session.ts'

export interface Item {
  readonly id: string
  /** The JSON text. The domain layer validates it (NFR-5). */
  readonly payload: string
  /** Bare JID of the publisher, when the server reports it. */
  readonly publisher: string | undefined
}

export interface ItemsEvent {
  readonly node: string
  readonly items: readonly Item[]
  readonly retracted: readonly string[]
  /** The node was deleted or purged; the client drops what it holds for it. */
  readonly deleted: boolean
}

export type AccessModel = 'open' | 'presence' | 'roster' | 'authorize' | 'whitelist'
export type PublishModel = 'publishers' | 'subscribers' | 'open'

/** Node settings (§8.2). Game nodes use whitelist and publishers (NFR-3), except §3 rule 15. */
export interface NodeConfig {
  readonly accessModel: AccessModel
  readonly publishModel: PublishModel
  /** Items kept; 1 for documents, more for announcements. */
  readonly maxItems: number
  readonly notifyRetract: boolean
  readonly title?: string
}

export type PubsubAffiliation =
  'owner' | 'publisher' | 'publish-only' | 'member' | 'none' | 'outcast'

export interface PubsubAffiliationEntry {
  readonly jid: string
  readonly affiliation: PubsubAffiliation
}

export type SubscriptionState = 'subscribed' | 'pending' | 'unconfigured' | 'none'

export interface SubscriptionEntry {
  readonly jid: string
  readonly subscription: SubscriptionState
}

export interface PubsubApi {
  /** Latest items first is not guaranteed; callers order by item id or payload. */
  getItems(node: string, options?: { readonly max?: number }): Outcome<readonly Item[]>
  /** Fails `too-large` before sending if over the item limit (PLY-53). */
  publish(node: string, itemId: string, payload: string): Outcome<void>
  retract(node: string, itemId: string): Outcome<void>
  /**
   * Subscribes this session's full JID, so other sessions of the same account (D22) are not
   * affected by this one subscribing or unsubscribing.
   */
  subscribe(node: string): Outcome<void>
  unsubscribe(node: string): Outcome<void>
  /**
   * Item, retract and delete notifications for a node this session subscribes to. A publisher's
   * own publishes are reported too, so every session sees the same stream (S6).
   */
  onItems(node: string, listener: (event: ItemsEvent) => void): Unsubscribe
  /** Node names on the service (disco#items). Anonymous sessions can list them (R17). */
  listNodes(): Outcome<readonly string[]>

  // Owner operations (admin).
  createNode(node: string, config: NodeConfig): Outcome<void>
  configureNode(node: string, config: NodeConfig): Outcome<void>
  getNodeConfig(node: string): Outcome<NodeConfig>
  deleteNode(node: string): Outcome<void>
  getAffiliations(node: string): Outcome<readonly PubsubAffiliationEntry[]>
  setAffiliations(node: string, entries: readonly PubsubAffiliationEntry[]): Outcome<void>
  getSubscriptions(node: string): Outcome<readonly SubscriptionEntry[]>
  setSubscriptions(node: string, entries: readonly SubscriptionEntry[]): Outcome<void>
}
