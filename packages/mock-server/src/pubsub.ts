// XEP-0060 Publish-Subscribe on the game's service, as ejabberd 26.09's `flat` node plugin runs
// it (node_flat.erl) with the reference config: only the admin creates nodes, item ownership is
// enforced, subscriptions are per JID as given (the transport uses full JIDs), and a subscription
// alone still grants reads on a whitelist node (R-A).
import type { Result } from '@wrx/schemas'
import { err, ok } from '@wrx/transport'
import type {
  Item,
  ItemsEvent,
  NodeConfig,
  PubsubAffiliation,
  PubsubAffiliationEntry,
  SubscriptionEntry,
  TransportError,
} from '@wrx/transport'
import type { ServerNodeConfig } from './protocol.ts'
import { bareOf, normaliseJid } from './world.ts'
import type { Connection, PubsubNode, StoredItem, World } from './world.ts'

type Outcome<T> = Result<T, TransportError>

const ok0: Outcome<undefined> = Object.freeze({ ok: true, value: undefined })

/**
 * The node a publish to a missing node creates for the admin (XEP-0060 §7.1.4): ejabberd's
 * defaults, not the transport's. So it is open, keeps up to 1000 items, does not report
 * publishers and does not announce its deletion.
 */
export const AUTO_CREATE_CONFIG: ServerNodeConfig = Object.freeze({
  accessModel: 'open',
  publishModel: 'publishers',
  maxItems: 1000,
  notifyRetract: true,
  notifyDelete: false,
  itemReply: 'none',
})

const missingNode = (): Outcome<never> => err('item-not-found', 'Node not found', 'cancel')

export class PubsubService {
  constructor(private readonly world: World) {}

  private affiliation(node: PubsubNode, conn: Connection): PubsubAffiliation {
    return node.affiliations.get(conn.bare) ?? 'none'
  }

  private subscribed(node: PubsubNode, conn: Connection): boolean {
    return (
      node.subscriptions.get(conn.jid) === 'subscribed' ||
      node.subscriptions.get(conn.bare) === 'subscribed'
    )
  }

  /**
   * node_flat `get_items`: owners, publishers and members read a whitelist node, and so does
   * anyone holding a subscription, whatever its affiliation now is (R-A). Everyone else gets
   * `not-allowed` (closed-node), type cancel (S02, S10). Access models other than open and
   * whitelist are not used by WRX1 and are treated as whitelist (not covered by contract).
   */
  private mayRead(node: PubsubNode, conn: Connection): Outcome<undefined> {
    const affiliation = this.affiliation(node, conn)
    if (affiliation === 'outcast') return err('forbidden', 'You are banned from this node', 'auth')
    if (node.config.accessModel === 'open') return ok0
    if (affiliation !== 'none' || this.subscribed(node, conn)) return ok0
    return err('not-allowed', 'closed-node', 'cancel')
  }

  private toItem(node: PubsubNode, item: StoredItem): Item {
    return {
      id: item.id,
      payload: item.payload,
      publisher: node.config.itemReply === 'publisher' ? item.publisher : undefined,
    }
  }

  /** Online sessions holding a subscription, each once. */
  private subscribers(node: PubsubNode): Connection[] {
    const out = new Set<Connection>()
    for (const [jid, state] of node.subscriptions) {
      if (state !== 'subscribed') continue
      for (const conn of this.world.connections) {
        if (conn.jid === jid || (!jid.includes('/') && conn.bare === jid)) out.add(conn)
      }
    }
    return [...out]
  }

  private notify(node: PubsubNode, event: ItemsEvent): void {
    for (const conn of this.subscribers(node))
      conn.send({ t: 'event', event: { kind: 'items', event } })
  }

  // ---- entity use (§6, §7) ------------------------------------------------------------------

  /** §6.5; newest first, as ejabberd returns them. `max` keeps the newest. */
  getItems(conn: Connection, name: string, max: number | undefined): Outcome<readonly Item[]> {
    const node = this.world.nodes.get(name)
    if (node === undefined) return missingNode()
    const allowed = this.mayRead(node, conn)
    if (!allowed.ok) return allowed
    const newest = [...node.items].reverse()
    const chosen = max === undefined ? newest : newest.slice(0, Math.max(0, max))
    return ok(chosen.map((item) => this.toItem(node, item)))
  }

  /**
   * §7.1. A missing node is created for the admin with ejabberd's defaults and refused for
   * anyone else (errors check). Publishers publish; a publisher may not overwrite an item
   * someone else published, while the owner may (S02). Subscribers are notified before the
   * publisher's reply, the publisher included (S6).
   */
  publish(conn: Connection, name: string, itemId: string, payload: string): Outcome<undefined> {
    let node = this.world.nodes.get(name)
    if (node === undefined) {
      if (!conn.admin) return missingNode()
      node = this.create(name, AUTO_CREATE_CONFIG, conn.bare)
    }
    const affiliation = this.affiliation(node, conn)
    const publisher =
      affiliation === 'owner' || affiliation === 'publisher' || affiliation === 'publish-only'
    const model = node.config.publishModel
    const allowed =
      affiliation !== 'outcast' &&
      (model === 'open' || publisher || (model === 'subscribers' && this.subscribed(node, conn)))
    if (!allowed) return err('forbidden', 'You are not allowed to publish to this node', 'auth')
    const previous = node.items.find((i) => i.id === itemId)
    if (previous !== undefined && previous.publisher !== conn.bare && affiliation !== 'owner') {
      return err('forbidden', 'The item was published by another entity', 'auth')
    }
    const item: StoredItem = { id: itemId, payload, publisher: conn.bare }
    node.items = [...node.items.filter((i) => i.id !== itemId), item].slice(-node.config.maxItems)
    this.notify(node, {
      node: name,
      items: [this.toItem(node, item)],
      retracted: [],
      deleted: false,
    })
    return ok0
  }

  /** §7.2: the owner retracts any item, a publisher only its own (S02). */
  retract(conn: Connection, name: string, itemId: string): Outcome<undefined> {
    const node = this.world.nodes.get(name)
    if (node === undefined) return missingNode()
    const affiliation = this.affiliation(node, conn)
    const publisher = affiliation === 'publisher' || affiliation === 'publish-only'
    if (affiliation !== 'owner' && !publisher) {
      return err('forbidden', 'You are not allowed to retract from this node', 'auth')
    }
    const item = node.items.find((i) => i.id === itemId)
    if (item === undefined) return err('item-not-found', 'Item not found', 'cancel')
    if (affiliation !== 'owner' && item.publisher !== conn.bare) {
      return err('forbidden', 'The item was published by another entity', 'auth')
    }
    node.items = node.items.filter((i) => i.id !== itemId)
    if (node.config.notifyRetract) {
      this.notify(node, { node: name, items: [], retracted: [itemId], deleted: false })
    }
    return ok0
  }

  /**
   * §6.1 by this session's full JID. A whitelist node needs member, publisher or owner
   * (`not-allowed` otherwise: S02, C01 R-A); a subscription does not count here.
   */
  subscribe(conn: Connection, name: string): Outcome<undefined> {
    const node = this.world.nodes.get(name)
    if (node === undefined) return missingNode()
    const affiliation = this.affiliation(node, conn)
    if (affiliation === 'outcast') return err('forbidden', 'You are banned from this node', 'auth')
    const whitelisted =
      affiliation === 'owner' || affiliation === 'publisher' || affiliation === 'member'
    if (node.config.accessModel !== 'open' && !whitelisted) {
      return err('not-allowed', 'closed-node', 'cancel')
    }
    node.subscriptions.set(conn.jid, 'subscribed')
    return ok0
  }

  /** §6.2 for this session's full JID; not subscribed is `unexpected-request` (not covered). */
  unsubscribe(conn: Connection, name: string): Outcome<undefined> {
    const node = this.world.nodes.get(name)
    if (node === undefined) return missingNode()
    if (!node.subscriptions.delete(conn.jid)) {
      return err('unexpected-request', 'not-subscribed', 'cancel')
    }
    return ok0
  }

  /** disco#items lists every node to anyone, anonymous included (S10, R17). */
  listNodes(): Outcome<readonly string[]> {
    return ok([...this.world.nodes.keys()])
  }

  // ---- owner use (§8) -----------------------------------------------------------------------

  private create(name: string, config: ServerNodeConfig, owner: string): PubsubNode {
    const node: PubsubNode = {
      name,
      config: { ...config },
      affiliations: new Map([[owner, 'owner']]),
      subscriptions: new Map(),
      items: [],
    }
    this.world.nodes.set(name, node)
    return node
  }

  private owned(conn: Connection, name: string): Outcome<PubsubNode> {
    const node = this.world.nodes.get(name)
    if (node === undefined) return missingNode()
    if (this.affiliation(node, conn) !== 'owner') {
      return err('forbidden', 'Owner privileges required', 'auth')
    }
    return ok(node)
  }

  /** §8.1: admin only (`pubsub_createnode`, S02 and S10); an existing node is `conflict` (S04). */
  createNode(conn: Connection, name: string, config: ServerNodeConfig): Outcome<undefined> {
    if (!conn.admin) return err('forbidden', 'Node creation is not allowed', 'auth')
    if (this.world.nodes.has(name)) return err('conflict', 'Node already exists', 'cancel')
    this.create(name, config, conn.bare)
    return ok0
  }

  configureNode(conn: Connection, name: string, config: ServerNodeConfig): Outcome<undefined> {
    const node = this.owned(conn, name)
    if (!node.ok) return node
    node.value.config = { ...config }
    node.value.items = node.value.items.slice(-config.maxItems)
    return ok0
  }

  getNodeConfig(conn: Connection, name: string): Outcome<NodeConfig> {
    const node = this.owned(conn, name)
    if (!node.ok) return node
    const { accessModel, publishModel, maxItems, notifyRetract, title } = node.value.config
    const config: NodeConfig = { accessModel, publishModel, maxItems, notifyRetract }
    return ok(title === undefined || title === '' ? config : { ...config, title })
  }

  /** §8.4; subscribers hear of it only with `notify_delete` (S06), which auto-created nodes lack. */
  deleteNode(conn: Connection, name: string): Outcome<undefined> {
    const node = this.owned(conn, name)
    if (!node.ok) return node
    if (node.value.config.notifyDelete) {
      this.notify(node.value, { node: name, items: [], retracted: [], deleted: true })
    }
    this.world.nodes.delete(name)
    return ok0
  }

  getAffiliations(conn: Connection, name: string): Outcome<readonly PubsubAffiliationEntry[]> {
    const node = this.owned(conn, name)
    if (!node.ok) return node
    return ok([...node.value.affiliations].map(([jid, affiliation]) => ({ jid, affiliation })))
  }

  /** §8.9: takes effect at once for online sessions, with no notification (S02, PLY-52). */
  setAffiliations(
    conn: Connection,
    name: string,
    entries: readonly PubsubAffiliationEntry[],
  ): Outcome<undefined> {
    const node = this.owned(conn, name)
    if (!node.ok) return node
    for (const { jid, affiliation } of entries) {
      const bare = bareOf(jid)
      if (affiliation === 'none') node.value.affiliations.delete(bare)
      else node.value.affiliations.set(bare, affiliation)
    }
    return ok0
  }

  getSubscriptions(conn: Connection, name: string): Outcome<readonly SubscriptionEntry[]> {
    const node = this.owned(conn, name)
    if (!node.ok) return node
    return ok([...node.value.subscriptions].map(([jid, subscription]) => ({ jid, subscription })))
  }

  /** §8.8, by the JID as listed (full JIDs for the transport's subscriptions: R-A). */
  setSubscriptions(
    conn: Connection,
    name: string,
    entries: readonly SubscriptionEntry[],
  ): Outcome<undefined> {
    const node = this.owned(conn, name)
    if (!node.ok) return node
    for (const { jid, subscription } of entries) {
      const key = normaliseJid(jid)
      if (subscription === 'none') node.value.subscriptions.delete(key)
      else node.value.subscriptions.set(key, subscription)
    }
    return ok0
  }

  /** XEP-0133 delete-user: the account's affiliations and subscriptions go (not covered). */
  forget(bare: string): void {
    for (const node of this.world.nodes.values()) {
      node.affiliations.delete(bare)
      for (const jid of [...node.subscriptions.keys()]) {
        if (bareOf(jid) === bare) node.subscriptions.delete(jid)
      }
    }
  }
}
