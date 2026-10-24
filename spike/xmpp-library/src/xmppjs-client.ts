// The fallback: @xmpp/client 0.14.0 with hand-written stanza builders and parsers for everything above
// RFC 6120 (xmpp.js ships no MUC, PubSub, MAM, RSM, data forms or ad-hoc support). Same rules as
// stanza-client.ts: strict TS, no `any`; `CAST:` marks a forced cast. Element.attrs is `any` in @types/ltx,
// so every attribute read goes through attr().

import { client as xmppClient, xml } from '@xmpp/client';
import type { Endpoints } from './endpoints.ts';
import { NS_ADMIN } from './endpoints.ts';

export type XClient = ReturnType<typeof xmppClient>;
export type El = ReturnType<typeof xml>;
export type Login = { kind: 'password'; user: string; password: string } | { kind: 'anonymous' };

export const NS = {
  muc: 'http://jabber.org/protocol/muc',
  mucUser: 'http://jabber.org/protocol/muc#user',
  mucAdmin: 'http://jabber.org/protocol/muc#admin',
  mucOwner: 'http://jabber.org/protocol/muc#owner',
  pubsub: 'http://jabber.org/protocol/pubsub',
  pubsubOwner: 'http://jabber.org/protocol/pubsub#owner',
  pubsubEvent: 'http://jabber.org/protocol/pubsub#event',
  mam: 'urn:xmpp:mam:2',
  rsm: 'http://jabber.org/protocol/rsm',
  forward: 'urn:xmpp:forward:0',
  delay: 'urn:xmpp:delay',
  sid: 'urn:xmpp:sid:0',
  data: 'jabber:x:data',
  commands: 'http://jabber.org/protocol/commands',
  stanzas: 'urn:ietf:params:xml:ns:xmpp-stanzas',
} as const;

// ---- element helpers ---------------------------------------------------------------------------

export function attr(el: El | undefined, name: string): string | undefined {
  const v: unknown = el?.attrs[name];
  return typeof v === 'string' ? v : undefined;
}

export interface XSession {
  client: XClient;
  jid: string;
  mechanism: string | undefined;
}

/** Connect over WebSocket and resolve when online. Rejects if the server is unreachable. */
export async function connect(ep: Endpoints, login: Login, opts: { resource?: string; timeoutMs?: number } = {}): Promise<XSession> {
  const c = xmppClient({
    service: ep.websocketUrl,
    domain: ep.domain,
    ...(opts.resource ? { resource: opts.resource } : {}),
    ...(login.kind === 'password' ? { username: login.user, password: login.password } : {}),
    timeout: opts.timeoutMs ?? 10_000,
  });
  const session: XSession = { client: c, jid: '', mechanism: undefined };
  c.on('send', (el) => {
    // RFC 6120 <auth/> or XEP-0388 SASL2 <authenticate/>.
    if (el.is('auth') || el.is('authenticate')) session.mechanism = attr(el, 'mechanism');
  });
  c.on('error', () => undefined); // surfaced through start()'s rejection
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const jid = await Promise.race([
      c.start(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${ep.websocketUrl}: no session after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    session.jid = jid.toString();
  } catch (e) {
    await c.stop().catch(() => undefined);
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timer);
  }
  return session;
}

export async function disconnect(c: XClient): Promise<void> {
  if (c.status === 'online') await c.stop().catch(() => undefined);
}

/** IQ round trip; resolves with the result <iq/>, rejects with an Error carrying the defined condition. */
export async function iq(c: XClient, type: 'get' | 'set', to: string, payload: El): Promise<El> {
  return c.iqCaller.request(xml('iq', { type, to }, payload));
}

/**
 * The defined condition of a rejected iq(). @xmpp/error's `.condition` is just the name of the first child
 * of <error/>, and ejabberd 26.09 sends <text/> first, so `.condition` reads "text". Parse the element.
 */
export function errorCondition(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('element' in e)) return undefined;
  const el: unknown = e.element;
  if (!(el instanceof xml('x').constructor)) return undefined;
  // CAST: instanceof against ltx's Element constructor doesn't narrow to the Element type.
  const cond = (el as El).getChildElements().find((c) => attr(c, 'xmlns') === NS.stanzas && c.name !== 'text');
  return cond?.name;
}

/** Resolve with the first incoming stanza matching `pred`, or reject after `ms`. */
export function waitForStanza(c: XClient, pred: (el: El) => boolean, ms = 8_000): Promise<El> {
  return new Promise((resolve, reject) => {
    const handler = (el: El): void => {
      if (!pred(el)) return;
      clearTimeout(timer);
      c.off('stanza', handler);
      resolve(el);
    };
    const timer = setTimeout(() => {
      c.off('stanza', handler);
      reject(new Error('timeout waiting for stanza'));
    }, ms);
    c.on('stanza', handler);
  });
}

/** Initial presence, so the server delivers bare-JID messages such as PubSub events. */
export const presence = (): El => xml('presence');

export const groupchat = (room: string, body: string): El => xml('message', { to: room, type: 'groupchat' }, xml('body', {}, body));

// ---- XEP-0004 data forms -------------------------------------------------------------------------

export type FormValues = Record<string, string | boolean | string[]>;

export function submitForm(formType: string, values: FormValues): El {
  const fields = [xml('field', { var: 'FORM_TYPE', type: 'hidden' }, xml('value', {}, formType))];
  for (const [name, v] of Object.entries(values)) {
    const vals = Array.isArray(v) ? v : [typeof v === 'boolean' ? (v ? '1' : '0') : v];
    fields.push(xml('field', { var: name }, ...vals.map((x) => xml('value', {}, x))));
  }
  return xml('x', { xmlns: NS.data, type: 'submit' }, ...fields);
}

/** Field name to values. Types (boolean, jid-multi, …) are left to the caller, unlike StanzaJS. */
export function parseForm(x: El | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of x?.getChildren('field') ?? []) {
    const name = attr(f, 'var');
    if (name) out.set(name, f.getChildren('value').map((v) => v.getText()));
  }
  return out;
}

// ---- XEP-0050 / XEP-0133 -------------------------------------------------------------------------

export async function adhoc(c: XClient, to: string, command: string, values: Record<string, string | string[]>): Promise<Map<string, string[]>> {
  const node = `${NS_ADMIN}#${command}`;
  const first = (await iq(c, 'set', to, xml('command', { xmlns: NS.commands, node, action: 'execute' }))).getChild('command', NS.commands);
  if (!first) throw new Error(`${node}: no command payload`);
  if (attr(first, 'status') === 'completed') return parseForm(first.getChild('x', NS.data));
  const offered = new Set(parseForm(first.getChild('x', NS.data)).keys());
  const fitted: FormValues = {};
  for (const [name, value] of Object.entries(values)) {
    if (offered.has(name)) fitted[name] = value;
    else if (name.endsWith('s') && offered.has(name.slice(0, -1))) fitted[name.slice(0, -1)] = Array.isArray(value) ? (value[0] ?? '') : value;
    else if (offered.has(`${name}s`)) fitted[`${name}s`] = Array.isArray(value) ? value : [value];
    else fitted[name] = value;
  }
  const sid = attr(first, 'sessionid');
  const done = (
    await iq(c, 'set', to, xml('command', { xmlns: NS.commands, node, action: 'complete', ...(sid ? { sessionid: sid } : {}) }, submitForm(NS_ADMIN, fitted)))
  ).getChild('command', NS.commands);
  const note = done?.getChildren('note').find((n) => attr(n, 'type') === 'error');
  if (note) throw new Error(`${node}: ${note.getText()}`);
  return parseForm(done?.getChild('x', NS.data));
}

// ---- XEP-0045 ---------------------------------------------------------------------------------

export interface MucSelf {
  affiliation: string | undefined;
  role: string | undefined;
  statusCodes: string[];
}

function mucItem(pres: El): MucSelf {
  const x = pres.getChild('x', NS.mucUser);
  const item = x?.getChild('item');
  return { affiliation: attr(item, 'affiliation'), role: attr(item, 'role'), statusCodes: (x?.getChildren('status') ?? []).map((s) => attr(s, 'code') ?? '') };
}

export async function joinRoom(c: XClient, room: string, nick: string): Promise<MucSelf> {
  const full = `${room}/${nick}`;
  const self = waitForStanza(c, (el) => el.is('presence') && attr(el, 'from') === full && (attr(el, 'type') === 'error' || mucItem(el).statusCodes.includes('110')));
  await c.send(xml('presence', { to: full }, xml('x', { xmlns: NS.muc }, xml('history', { maxstanzas: '0' }))));
  const pres = await self;
  if (attr(pres, 'type') === 'error') throw new Error(`join ${room}: ${pres.getChild('error')?.children.map(String).join('') ?? 'error'}`);
  return mucItem(pres);
}

export async function getRoomConfig(c: XClient, room: string): Promise<Map<string, string[]>> {
  const res = await iq(c, 'get', room, xml('query', { xmlns: NS.mucOwner }));
  return parseForm(res.getChild('query', NS.mucOwner)?.getChild('x', NS.data));
}

export async function configureRoom(c: XClient, room: string, values: FormValues): Promise<void> {
  await iq(c, 'set', room, xml('query', { xmlns: NS.mucOwner }, submitForm(`${NS.muc}#roomconfig`, values)));
}

export async function destroyRoom(c: XClient, room: string): Promise<void> {
  await iq(c, 'set', room, xml('query', { xmlns: NS.mucOwner }, xml('destroy', {})));
}

export async function setRoomAffiliation(c: XClient, room: string, jid: string, affiliation: string): Promise<void> {
  await iq(c, 'set', room, xml('query', { xmlns: NS.mucAdmin }, xml('item', { jid, affiliation })));
}

export async function setRoomRole(c: XClient, room: string, nick: string, role: string): Promise<void> {
  await iq(c, 'set', room, xml('query', { xmlns: NS.mucAdmin }, xml('item', { nick, role })));
}

export async function getRoomAffiliates(c: XClient, room: string, affiliation: string): Promise<string[]> {
  const res = await iq(c, 'get', room, xml('query', { xmlns: NS.mucAdmin }, xml('item', { affiliation })));
  return (res.getChild('query', NS.mucAdmin)?.getChildren('item') ?? []).map((i) => attr(i, 'jid') ?? '');
}

// ---- XEP-0313 + XEP-0059 -----------------------------------------------------------------------

export interface MamItem {
  archiveId: string;
  from: string | undefined;
  body: string | undefined;
  stamp: string | undefined;
}
export interface MamPage {
  items: MamItem[];
  first: string | undefined;
  last: string | undefined;
  complete: boolean;
  count: number | undefined;
}

/** Query an archive backwards: `before` '' is the last page, else the previous page's `first`. */
export async function mamPage(c: XClient, archive: string, max: number, before: string): Promise<MamPage> {
  const queryid = Math.random().toString(36).slice(2);
  const items: MamItem[] = [];
  const onStanza = (el: El): void => {
    const result = el.is('message') ? el.getChild('result', NS.mam) : undefined;
    if (!result || attr(result, 'queryid') !== queryid) return;
    const fwd = result.getChild('forwarded', NS.forward);
    const msg = fwd?.getChild('message');
    items.push({
      archiveId: attr(result, 'id') ?? '',
      from: attr(msg, 'from'),
      body: msg?.getChildText('body') ?? undefined,
      stamp: attr(fwd?.getChild('delay', NS.delay), 'stamp'),
    });
  };
  c.on('stanza', onStanza);
  try {
    const set = xml('set', { xmlns: NS.rsm }, xml('max', {}, String(max)), xml('before', {}, before));
    const res = await iq(c, 'set', archive, xml('query', { xmlns: NS.mam, queryid }, submitForm(NS.mam, {}), set));
    const fin = res.getChild('fin', NS.mam);
    const rsm = fin?.getChild('set', NS.rsm);
    const count = rsm?.getChildText('count');
    return {
      items,
      first: rsm?.getChildText('first') ?? undefined,
      last: rsm?.getChildText('last') ?? undefined,
      complete: attr(fin, 'complete') === 'true',
      count: count ? Number(count) : undefined,
    };
  } finally {
    c.off('stanza', onStanza);
  }
}

// ---- XEP-0060 ---------------------------------------------------------------------------------

export async function createNode(c: XClient, service: string, node: string, config: FormValues): Promise<void> {
  await iq(c, 'set', service, xml('pubsub', { xmlns: NS.pubsub }, xml('create', { node }), xml('configure', {}, submitForm(`${NS.pubsub}#node_config`, config))));
}

export async function getNodeConfig(c: XClient, service: string, node: string): Promise<Map<string, string[]>> {
  const res = await iq(c, 'get', service, xml('pubsub', { xmlns: NS.pubsubOwner }, xml('configure', { node })));
  return parseForm(res.getChild('pubsub', NS.pubsubOwner)?.getChild('configure')?.getChild('x', NS.data));
}

export async function deleteNode(c: XClient, service: string, node: string): Promise<void> {
  await iq(c, 'set', service, xml('pubsub', { xmlns: NS.pubsubOwner }, xml('delete', { node })));
}

export async function setNodeAffiliations(c: XClient, service: string, node: string, items: Array<{ jid: string; affiliation: string }>): Promise<void> {
  await iq(c, 'set', service, xml('pubsub', { xmlns: NS.pubsubOwner }, xml('affiliations', { node }, ...items.map((i) => xml('affiliation', i)))));
}

export async function getNodeAffiliations(c: XClient, service: string, node: string): Promise<Array<{ jid: string; affiliation: string }>> {
  const res = await iq(c, 'get', service, xml('pubsub', { xmlns: NS.pubsubOwner }, xml('affiliations', { node })));
  return (res.getChild('pubsub', NS.pubsubOwner)?.getChild('affiliations')?.getChildren('affiliation') ?? []).map((a) => ({
    jid: attr(a, 'jid') ?? '',
    affiliation: attr(a, 'affiliation') ?? '',
  }));
}

export async function getNodeSubscriptions(c: XClient, service: string, node: string): Promise<Array<{ jid: string; subscription: string }>> {
  const res = await iq(c, 'get', service, xml('pubsub', { xmlns: NS.pubsubOwner }, xml('subscriptions', { node })));
  return (res.getChild('pubsub', NS.pubsubOwner)?.getChild('subscriptions')?.getChildren('subscription') ?? []).map((s) => ({
    jid: attr(s, 'jid') ?? '',
    subscription: attr(s, 'subscription') ?? '',
  }));
}

export async function subscribe(c: XClient, service: string, node: string, bareJid: string): Promise<string | undefined> {
  const res = await iq(c, 'set', service, xml('pubsub', { xmlns: NS.pubsub }, xml('subscribe', { node, jid: bareJid })));
  return attr(res.getChild('pubsub', NS.pubsub)?.getChild('subscription'), 'subscription');
}

/** Publish a XEP-0335 JSON item. The JSON is serialised here; parsing it back is the caller's job. */
export async function publishJson(c: XClient, service: string, node: string, id: string, json: unknown): Promise<void> {
  const item = xml('item', { id }, xml('json', { xmlns: 'urn:xmpp:json:0' }, JSON.stringify(json)));
  await iq(c, 'set', service, xml('pubsub', { xmlns: NS.pubsub }, xml('publish', { node }, item)));
}

export interface RawItem {
  id: string | undefined;
  json: string | undefined;
}

function rawItems(items: El | undefined): RawItem[] {
  return (items?.getChildren('item') ?? []).map((i) => ({ id: attr(i, 'id'), json: i.getChild('json', 'urn:xmpp:json:0')?.getText() }));
}

export async function getItems(c: XClient, service: string, node: string, max: number): Promise<RawItem[]> {
  const res = await iq(c, 'get', service, xml('pubsub', { xmlns: NS.pubsub }, xml('items', { node, max_items: String(max) })));
  return rawItems(res.getChild('pubsub', NS.pubsub)?.getChild('items'));
}

/** XEP-0060 §7.1.2 item event: resolves with the published items of `node`. */
export async function waitForItems(c: XClient, node: string, ms = 8_000): Promise<RawItem[]> {
  const msg = await waitForStanza(c, (el) => el.is('message') && attr(el.getChild('event', NS.pubsubEvent)?.getChild('items'), 'node') === node, ms);
  return rawItems(msg.getChild('event', NS.pubsubEvent)?.getChild('items'));
}
