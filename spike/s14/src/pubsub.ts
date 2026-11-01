// Raw XEP-0060 / XEP-0248 operations for the S14 checks. Every operation is a literal stanza sent
// with RawAccess, so the record shows exactly what was sent and what the server answered, and no
// client library can hide a server behaviour. Nothing here knows which backend is under test.
import type { Session } from '../../../packages/transport/src/index.ts'
import type { RawAccess } from '../../../packages/contract-suite/src/index.ts'

export const NS = {
  pubsub: 'http://jabber.org/protocol/pubsub',
  owner: 'http://jabber.org/protocol/pubsub#owner',
  event: 'http://jabber.org/protocol/pubsub#event',
  info: 'http://jabber.org/protocol/disco#info',
  items: 'http://jabber.org/protocol/disco#items',
  rsm: 'http://jabber.org/protocol/rsm',
  data: 'jabber:x:data',
  stanzas: 'urn:ietf:params:xml:ns:xmpp-stanzas',
  s14: 'urn:wrx:s14',
} as const

export interface IqReply {
  readonly ok: boolean
  /** The error condition, e.g. `not-allowed`, when the reply is an error. */
  readonly condition?: string
  readonly errorType?: string
  readonly text?: string
  /** The XEP-0060 application condition inside <error/>, e.g. `closed-node`. */
  readonly appCondition?: string
  /** The reply as received. */
  readonly xml: string
  readonly sent: string
  readonly ms: number
}

let counter = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;')

/** The value of an attribute on the first element of `xml` (single or double quotes). */
export function attr(xml: string, name: string): string | undefined {
  const m = new RegExp(`^<[^>]*?\\s${name}=(?:'([^']*)'|"([^"]*)")`).exec(xml)
  return m === null ? undefined : (m[1] ?? m[2])
}

function parseError(xml: string): Pick<IqReply, 'condition' | 'errorType' | 'text' | 'appCondition'> {
  const err = /<error\b([^>]*)>([\s\S]*?)<\/error>/.exec(xml)
  if (err === null) return {}
  const body = err[2] ?? ''
  const type = /type=['"]([^'"]+)['"]/.exec(err[1] ?? '')?.[1]
  const conds = [...body.matchAll(/<([a-z-]+)\s+xmlns=['"]([^'"]+)['"][^>]*\/?>/g)]
  const condition = conds.find((c) => c[2] === NS.stanzas && c[1] !== 'text')?.[1]
  const appCondition = conds.find((c) => c[2] !== NS.stanzas)?.[1]
  const text = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(body)?.[1]
  return {
    ...(condition === undefined ? {} : { condition }),
    ...(type === undefined ? {} : { errorType: type }),
    ...(text === undefined ? {} : { text }),
    ...(appCondition === undefined ? {} : { appCondition }),
  }
}

/** A list of exchanges kept for a stanza file (stanzas/*.xml). */
export class Transcript {
  readonly lines: string[] = []
  add(label: string, sent: string, reply: string): void {
    this.lines.push(`<!-- ${label}: out -->\n${sent}`, `<!-- ${label}: in -->\n${reply}`)
  }
  note(text: string): void {
    this.lines.push(`<!-- ${text} -->`)
  }
}

/** Raw PubSub access for one session. */
export class Pubsub {
  constructor(
    readonly raw: RawAccess,
    readonly session: Session,
    readonly service: string,
    private readonly transcript?: Transcript,
    private readonly label = 'session',
  ) {}

  /** A copy that records its exchanges into `t` under `label`. */
  recording(t: Transcript, label: string): Pubsub {
    return new Pubsub(this.raw, this.session, this.service, t, label)
  }

  /** Sends an IQ and resolves with the reply (or rejects after `timeoutMs`). */
  iq(type: 'get' | 'set', inner: string, to = this.service, timeoutMs = 20_000): Promise<IqReply> {
    const id = nextId('s14')
    const sent = `<iq xmlns='jabber:client' type='${type}' to='${to}' id='${id}'>${inner}</iq>`
    const started = performance.now()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`no reply to ${id} after ${timeoutMs} ms: ${sent.slice(0, 300)}`))
      }, timeoutMs)
      const off = this.raw.onIncoming(this.session, (xml) => {
        if (!xml.startsWith('<iq') || attr(xml, 'id') !== id) return
        clearTimeout(timer)
        off()
        const ok = attr(xml, 'type') === 'result'
        this.transcript?.add(this.label, sent, xml)
        resolve({ ok, ...(ok ? {} : parseError(xml)), xml, sent, ms: performance.now() - started })
      })
      this.raw.send(this.session, sent)
    })
  }

  discoInfo(node?: string, to = this.service): Promise<IqReply> {
    return this.iq('get', `<query xmlns='${NS.info}'${node === undefined ? '' : ` node='${esc(node)}'`}/>`, to)
  }

  discoItems(node?: string, to = this.service): Promise<IqReply> {
    return this.iq('get', `<query xmlns='${NS.items}'${node === undefined ? '' : ` node='${esc(node)}'`}/>`, to)
  }

  /** `<create node/>` with an optional node_config form. `type` is ejabberd's plugin attribute. */
  create(node: string, config: Fields = {}, type?: string): Promise<IqReply> {
    const typeAttr = type === undefined ? '' : ` type='${type}'`
    const form = Object.keys(config).length === 0 ? '' : `<configure>${xform('http://jabber.org/protocol/pubsub#node_config', config)}</configure>`
    return this.iq('set', `<pubsub xmlns='${NS.pubsub}'><create node='${esc(node)}'${typeAttr}/>${form}</pubsub>`)
  }

  configure(node: string, config: Fields): Promise<IqReply> {
    return this.iq(
      'set',
      `<pubsub xmlns='${NS.owner}'><configure node='${esc(node)}'>${xform('http://jabber.org/protocol/pubsub#node_config', config)}</configure></pubsub>`,
    )
  }

  getConfig(node: string): Promise<IqReply> {
    return this.iq('get', `<pubsub xmlns='${NS.owner}'><configure node='${esc(node)}'/></pubsub>`)
  }

  setAffiliations(node: string, list: Record<string, string>): Promise<IqReply> {
    const items = Object.entries(list)
      .map(([jid, a]) => `<affiliation jid='${jid}' affiliation='${a}'/>`)
      .join('')
    return this.iq('set', `<pubsub xmlns='${NS.owner}'><affiliations node='${esc(node)}'>${items}</affiliations></pubsub>`)
  }

  /** Owner sets subscriptions on others' behalf (XEP-0060 §8.8.2). */
  setSubscriptions(node: string, list: Record<string, 'subscribed' | 'none'>): Promise<IqReply> {
    const items = Object.entries(list)
      .map(([jid, s]) => `<subscription jid='${jid}' subscription='${s}'/>`)
      .join('')
    return this.iq('set', `<pubsub xmlns='${NS.owner}'><subscriptions node='${esc(node)}'>${items}</subscriptions></pubsub>`)
  }

  getSubscriptions(node: string): Promise<IqReply> {
    return this.iq('get', `<pubsub xmlns='${NS.owner}'><subscriptions node='${esc(node)}'/></pubsub>`)
  }

  publish(node: string, id: string, payload: string): Promise<IqReply> {
    return this.iq('set', `<pubsub xmlns='${NS.pubsub}'><publish node='${esc(node)}'><item id='${esc(id)}'>${payload}</item></publish></pubsub>`)
  }

  items(node: string, opts: { max?: number; rsm?: { max: number; after?: string } } = {}): Promise<IqReply> {
    const max = opts.max === undefined ? '' : ` max_items='${opts.max}'`
    const rsm =
      opts.rsm === undefined
        ? ''
        : `<set xmlns='${NS.rsm}'><max>${opts.rsm.max}</max>${opts.rsm.after === undefined ? '' : `<after>${esc(opts.rsm.after)}</after>`}</set>`
    return this.iq('get', `<pubsub xmlns='${NS.pubsub}'><items node='${esc(node)}'${max}/>${rsm}</pubsub>`)
  }

  /** Subscribe this session's bare JID, with optional subscribe options (e.g. XEP-0248 depth). */
  subscribe(node: string, jid: string, options: Fields = {}): Promise<IqReply> {
    const form = Object.keys(options).length === 0 ? '' : `<options>${xform('http://jabber.org/protocol/pubsub#subscribe_options', options)}</options>`
    return this.iq('set', `<pubsub xmlns='${NS.pubsub}'><subscribe node='${esc(node)}' jid='${jid}'/>${form}</pubsub>`)
  }

  unsubscribe(node: string, jid: string): Promise<IqReply> {
    return this.iq('set', `<pubsub xmlns='${NS.pubsub}'><unsubscribe node='${esc(node)}' jid='${jid}'/></pubsub>`)
  }

  deleteNode(node: string): Promise<IqReply> {
    return this.iq('set', `<pubsub xmlns='${NS.owner}'><delete node='${esc(node)}'/></pubsub>`)
  }
}

export type Fields = Record<string, string | readonly string[]>

/** A submitted data form. */
export function xform(formType: string, fields: Fields): string {
  const f = Object.entries(fields)
    .map(([k, v]) => `<field var='${k}'>${(typeof v === 'string' ? [v] : v).map((x) => `<value>${esc(x)}</value>`).join('')}</field>`)
    .join('')
  return `<x xmlns='${NS.data}' type='submit'><field var='FORM_TYPE' type='hidden'><value>${formType}</value></field>${f}</x>`
}

/** `var` values of disco#info features. */
export function features(xml: string): string[] {
  return [...xml.matchAll(/<feature\s+var=['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')
}

/** `node` attributes of disco#items items. */
export function itemNodes(xml: string): string[] {
  return [...xml.matchAll(/<item\b[^>]*\snode=['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')
}

/** Item ids in an items reply. */
export function itemIds(xml: string): string[] {
  return [...xml.matchAll(/<item\b[^>]*\sid=['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')
}

/** The RSM <last/> and <count/> of a reply. */
export function rsmOf(xml: string): { last?: string; count?: number } {
  const last = /<last>([^<]*)<\/last>/.exec(xml)?.[1]
  const count = /<count>(\d+)<\/count>/.exec(xml)?.[1]
  return { ...(last === undefined ? {} : { last }), ...(count === undefined ? {} : { count: Number(count) }) }
}

/** The value of one field in a node_config form. */
export function fieldValue(xml: string, name: string): string[] | undefined {
  const m = new RegExp(`<field\\b[^>]*var=['"]${name.replace(/[#]/g, '\\$&')}['"][^>]*>([\\s\\S]*?)</field>`).exec(xml)
  if (m === null) return undefined
  return [...(m[1] ?? '').matchAll(/<value>([^<]*)<\/value>/g)].map((v) => v[1] ?? '')
}

/** A PubSub event notification: which node and item, when it arrived, and its publish stamp. */
export interface Notification {
  readonly node: string
  readonly item: string
  readonly receivedAt: number
  readonly sentAt?: number
  readonly kind: 'items' | 'retract' | 'other'
  readonly xml: string
}

/** Records every PubSub event a session receives. */
export function recordNotifications(raw: RawAccess, session: Session): { events: Notification[]; stop: () => void } {
  const events: Notification[] = []
  const stop = raw.onIncoming(session, (xml) => {
    if (!xml.startsWith('<message') || !xml.includes(NS.event)) return
    const receivedAt = Date.now()
    for (const items of xml.matchAll(/<items\b[^>]*\snode=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/items>/g)) {
      const node = items[1] ?? ''
      const body = items[2] ?? ''
      for (const item of body.matchAll(/<(item|retract)\b[^>]*\sid=['"]([^'"]+)['"][^>]*?(?:\/>|>([\s\S]*?)<\/item>)/g)) {
        const t = /\st=['"](\d+)['"]/.exec(item[3] ?? '')?.[1]
        events.push({
          node,
          item: item[2] ?? '',
          receivedAt,
          ...(t === undefined ? {} : { sentAt: Number(t) }),
          kind: item[1] === 'retract' ? 'retract' : 'items',
          xml,
        })
      }
    }
    if (!/<items\b/.test(xml)) events.push({ node: '', item: '', receivedAt, kind: 'other', xml })
  })
  return { events, stop }
}

/** A small asset payload stamped with its publish time, for latency. */
export const assetPayload = (assetId: string, extra = '') =>
  `<asset xmlns='${NS.s14}' id='${esc(assetId)}' t='${Date.now()}'${extra}/>`

export function p95(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.NaN
}
