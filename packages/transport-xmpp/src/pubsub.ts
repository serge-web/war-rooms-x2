// XEP-0060 Publish-Subscribe over StanzaJS: entity use (§6–7) and owner use (§8). Each item holds
// one XEP-0335 JSON container (`urn:xmpp:json:0`); payloads cross the interface as JSON text.
import { err } from '@wrx/transport'
import type {
  AccessModel,
  Item,
  ItemsEvent,
  NodeConfig,
  Outcome,
  PublishModel,
  PubsubAffiliation,
  PubsubAffiliationEntry,
  PubsubApi,
  SubscriptionEntry,
  SubscriptionState,
  Unsubscribe,
} from '@wrx/transport'
import { JID } from 'stanza'
import type * as XMPP from 'stanza'
import { sendIq } from './core.ts'
import type { Core } from './core.ts'
import { booleanField, stringField, submitForm } from './forms.ts'
import { Listeners } from './listeners.ts'
import { invalidResponse } from './refusal.ts'
import { PUBSUB_PAYLOAD_CAP_BYTES, payloadWithinCap } from './size.ts'

const NS_JSON = 'urn:xmpp:json:0'
const NS_NODE_CONFIG = 'http://jabber.org/protocol/pubsub#node_config'

/**
 * A XEP-0335 item as the transport sends and reads it. StanzaJS types `json` as `any`; here it is
 * `unknown`, and the payload leaves the transport only as JSON text (WP 0.3).
 */
interface JsonItem extends XMPP.Stanzas.PubsubItemContent {
  readonly itemType: typeof NS_JSON
  readonly json?: unknown
}

/**
 * The ids in a retract notification. StanzaJS types the event's `retracted` as
 * `string[] & PubsubItem[]`, a contradiction (WP 0.3), so each entry is narrowed here.
 */
type RetractedIds = readonly string[]

const ACCESS_MODELS = Object.freeze([
  'open',
  'presence',
  'roster',
  'authorize',
  'whitelist',
] as const)
const PUBLISH_MODELS = Object.freeze(['publishers', 'subscribers', 'open'] as const)
const AFFILIATIONS = Object.freeze([
  'owner',
  'publisher',
  'publish-only',
  'member',
  'none',
  'outcast',
] as const)
const SUBSCRIPTIONS = Object.freeze(['subscribed', 'pending', 'unconfigured', 'none'] as const)

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return values.find((v) => v === value)
}

function jsonText(content: XMPP.Stanzas.PubsubItemContent | undefined): string | undefined {
  if (content?.itemType !== NS_JSON || !('json' in content)) return undefined
  const json: unknown = content.json
  return json === undefined ? undefined : JSON.stringify(json)
}

function toItem(item: XMPP.Stanzas.PubsubItem): Item | undefined {
  const payload = jsonText(item.content)
  if (item.id === undefined || payload === undefined) return undefined
  return {
    id: item.id,
    payload,
    publisher: item.publisher === undefined ? undefined : JID.toBare(item.publisher),
  }
}

function retractedIds(entries: readonly unknown[] | undefined): RetractedIds {
  const ids: string[] = []
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') ids.push(entry)
    else if (typeof entry === 'object' && entry !== null && 'id' in entry) {
      if (typeof entry.id === 'string') ids.push(entry.id)
    }
  }
  return ids
}

export class XmppPubsub implements PubsubApi {
  private readonly itemListeners = new Listeners<string, ItemsEvent>()

  constructor(private readonly core: Core) {}

  private get service(): string {
    return this.core.services().pubsub
  }

  /** §7.1.2.1, §7.2.2.1, §8.4.2: notifications from the PubSub service. */
  handleMessage(message: XMPP.Stanzas.ReceivedMessage): void {
    const event = message.pubsub
    if (event?.context !== 'event' || message.from !== this.service) return
    if (event.eventType === 'items' && event.items !== undefined) {
      const items: Item[] = []
      for (const published of event.items.published ?? []) {
        const item = toItem(published)
        if (item !== undefined) items.push(item)
      }
      const retracted = retractedIds(event.items.retracted)
      if (items.length === 0 && retracted.length === 0) return
      this.emit({ node: event.items.node, items, retracted, deleted: false })
    } else if (event.eventType === 'delete' && event.delete !== undefined) {
      this.emit({ node: event.delete.node, items: [], retracted: [], deleted: true })
    } else if (event.eventType === 'purge' && event.purge !== undefined) {
      this.emit({ node: event.purge.node, items: [], retracted: [], deleted: true })
    }
  }

  private emit(event: ItemsEvent): void {
    this.itemListeners.emit(event.node, event)
  }

  getItems(node: string, options?: { readonly max?: number }): Outcome<readonly Item[]> {
    return this.core.run(async () => {
      const result = await this.core.client.getItems(
        this.service,
        node,
        options?.max === undefined ? {} : { max: options.max },
      )
      const items: Item[] = []
      for (const raw of result.items ?? []) {
        const item = toItem(raw)
        if (item !== undefined) items.push(item)
      }
      return items
    })
  }

  publish(node: string, itemId: string, payload: string): Outcome<void> {
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      return Promise.resolve(err('bad-request', 'the payload is not JSON (XEP-0335)'))
    }
    // The text StanzaJS will send: JSON.stringify of the parsed value.
    if (!payloadWithinCap(JSON.stringify(json))) {
      return Promise.resolve(
        err('too-large', `the payload is over the ${PUBSUB_PAYLOAD_CAP_BYTES}-byte item cap`),
      )
    }
    return this.core.run(async () => {
      const content: JsonItem = { itemType: NS_JSON, json }
      await this.core.client.publish(this.service, node, content, itemId)
      if (!this.core.adapter.notifiesOwnPublish) {
        // S6: report our own publish, so every session of a role sees the same stream.
        const item: Item = {
          id: itemId,
          payload: JSON.stringify(json),
          publisher: this.core.bareJid(),
        }
        this.emit({ node, items: [item], retracted: [], deleted: false })
      }
    })
  }

  retract(node: string, itemId: string): Outcome<void> {
    return this.core.run(async () => {
      // §7.2.2.1: whether subscribers are told follows the node's notify_retract.
      await sendIq(this.core.client, {
        to: this.service,
        type: 'set',
        pubsub: { context: 'user', retract: { node, id: itemId } },
      })
    })
  }

  subscribe(node: string): Outcome<void> {
    return this.core.run(async () => {
      // §6.1 with this session's full JID: other sessions of the account, possibly other people
      // sharing the role (D22), keep their own subscriptions.
      const result = await this.core.client.subscribeToNode(this.service, {
        node,
        jid: this.core.client.jid,
      })
      if (result.state !== undefined && result.state !== 'subscribed') {
        throw invalidResponse(`subscription is ${result.state}`)
      }
    })
  }

  unsubscribe(node: string): Outcome<void> {
    return this.core.run(async () => {
      // §6.2: the same full JID that subscribed.
      await this.core.client.unsubscribeFromNode(this.service, { node, jid: this.core.client.jid })
    })
  }

  onItems(node: string, listener: (event: ItemsEvent) => void): Unsubscribe {
    return this.itemListeners.add(node, listener)
  }

  listNodes(): Outcome<readonly string[]> {
    return this.core.run(async () => {
      const result = await this.core.client.getDiscoItems(this.service)
      const nodes: string[] = []
      for (const item of result.items) if (item.node !== undefined) nodes.push(item.node)
      return nodes
    })
  }

  // ---- owner use (§8) ------------------------------------------------------------------------

  createNode(node: string, config: NodeConfig): Outcome<void> {
    return this.core.run(async () => {
      const form = submitForm(NS_NODE_CONFIG, this.core.adapter.nodeConfigFields(config))
      await this.core.client.createNode(this.service, node, form)
    })
  }

  configureNode(node: string, config: NodeConfig): Outcome<void> {
    return this.core.run(async () => {
      const form = submitForm(NS_NODE_CONFIG, this.core.adapter.nodeConfigFields(config))
      await this.core.client.configureNode(this.service, node, form)
    })
  }

  getNodeConfig(node: string): Outcome<NodeConfig> {
    return this.core.run(async () => {
      const form = await this.core.client.getNodeConfig(this.service, node)
      const accessModel: AccessModel | undefined = oneOf(
        ACCESS_MODELS,
        stringField(form, 'pubsub#access_model'),
      )
      const publishModel: PublishModel | undefined = oneOf(
        PUBLISH_MODELS,
        stringField(form, 'pubsub#publish_model'),
      )
      const maxItems = Number(stringField(form, 'pubsub#max_items'))
      const notifyRetract = booleanField(form, 'pubsub#notify_retract')
      if (accessModel === undefined || publishModel === undefined) {
        throw invalidResponse('node config lacks access or publish model')
      }
      if (!Number.isInteger(maxItems) || notifyRetract === undefined) {
        throw invalidResponse('node config lacks max_items or notify_retract')
      }
      const title = stringField(form, 'pubsub#title')
      return {
        accessModel,
        publishModel,
        maxItems,
        notifyRetract,
        ...(title === undefined || title === '' ? {} : { title }),
      }
    })
  }

  deleteNode(node: string): Outcome<void> {
    return this.core.run(async () => {
      await this.core.client.deleteNode(this.service, node)
    })
  }

  getAffiliations(node: string): Outcome<readonly PubsubAffiliationEntry[]> {
    return this.core.run(async () => {
      const result = await this.core.client.getNodeAffiliations(this.service, node)
      const entries: PubsubAffiliationEntry[] = []
      for (const item of result.items ?? []) {
        const affiliation: PubsubAffiliation | undefined = oneOf(AFFILIATIONS, item.affiliation)
        if (item.jid === undefined || affiliation === undefined) continue
        entries.push({ jid: JID.toBare(item.jid), affiliation })
      }
      return entries
    })
  }

  setAffiliations(node: string, entries: readonly PubsubAffiliationEntry[]): Outcome<void> {
    return this.core.run(async () => {
      if (entries.length === 0) return
      await this.core.client.updateNodeAffiliations(
        this.service,
        node,
        entries.map((e) => ({ jid: e.jid, affiliation: e.affiliation })),
      )
    })
  }

  getSubscriptions(node: string): Outcome<readonly SubscriptionEntry[]> {
    return this.core.run(async () => {
      // getNodeSubscribers resolves to a bare IQ; the payload is optional (WP 0.3).
      const result = await this.core.client.getNodeSubscribers(this.service, node)
      const entries: SubscriptionEntry[] = []
      for (const item of result.pubsub?.subscriptions?.items ?? []) {
        const subscription: SubscriptionState = oneOf(SUBSCRIPTIONS, item.state) ?? 'none'
        if (item.jid === undefined) continue
        entries.push({ jid: item.jid, subscription })
      }
      return entries
    })
  }

  setSubscriptions(node: string, entries: readonly SubscriptionEntry[]): Outcome<void> {
    return this.core.run(async () => {
      if (entries.length === 0) return
      await this.core.client.updateNodeSubscriptions(
        this.service,
        node,
        entries.map((e) => ({ jid: e.jid, state: e.subscription })),
      )
    })
  }
}
