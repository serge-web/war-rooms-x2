// Type-level probes: StanzaJS operations the WRX1 transport needs (WP 1.1 scope) that the live test does
// not run. Compiled by `tsc` (strict, no `any` in our code), never executed. Each probe states what the
// types give us; `CAST:` marks a forced cast; `ANY:` marks where StanzaJS's types hand us `any`.

import type * as XMPP from 'stanza';
import { NS_ROOMCONFIG } from './endpoints.ts';
import { submitForm } from './stanza-client.ts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(_: T): void => undefined;
type Stz = XMPP.Stanzas.ReceivedMessage;

export async function probes(c: XMPP.Agent, room: string, service: string, node: string): Promise<void> {
  // ---- XEP-0045 owner/admin --------------------------------------------------------------------
  const destroyed = await c.destroyRoom(room, { reason: 'game over' });
  assertType<Equal<typeof destroyed.muc.type, 'configure'>>(true);
  await c.kick(room, 'nick', 'reason');
  await c.ban(room, 'user@localhost', 'reason');
  const admins = await c.getRoomMembers(room, { affiliation: 'admin' });
  for (const u of admins.muc.users ?? []) {
    assertType<Equal<typeof u.affiliation, XMPP.Constants.MUCAffiliation | undefined>>(true);
    assertType<Equal<typeof u.role, XMPP.Constants.MUCRole | undefined>>(true);
  }
  // Room config is a generic XEP-0004 form: field names are strings, values a union narrowed by `type`.
  const form = await c.getRoomConfig(room);
  const moderated = form.fields?.find((f) => f.name === 'muc#roomconfig_moderatedroom');
  if (moderated?.type === 'boolean') assertType<Equal<typeof moderated.value, boolean | undefined>>(true);
  await c.configureRoom(room, submitForm(NS_ROOMCONFIG, { 'muc#roomconfig_moderatedroom': true }));
  // Occupant presence events carry a typed muc#user payload, including status codes (110, 321, …).
  c.on('muc:unavailable', (p) => {
    assertType<Equal<typeof p.muc.statusCodes, Array<XMPP.Constants.MUCStatusCode | string> | undefined>>(true);
  });
  // Raw presence: `muc` is a discriminated union (join | info), so narrowing on `type` is needed.
  c.on('presence', (p) => {
    const muc = p.muc;
    if (muc?.type === 'info') assertType<Equal<typeof muc.affiliation, XMPP.Constants.MUCAffiliation | undefined>>(true);
  });
  c.on('groupchat', (m) => assertType<Equal<typeof m, Stz>>(true));

  // ---- XEP-0060 ----------------------------------------------------------------------------------
  await c.retract(service, node, 'id', true);
  await c.unsubscribeFromNode(service, node);
  await c.purgeNode(service, node);
  const mySubs = await c.getSubscriptions(service);
  assertType<Equal<typeof mySubs.items, XMPP.Stanzas.PubsubSubscription[] | undefined>>(true);
  await c.updateNodeSubscriptions(service, node, [{ jid: 'user@localhost', state: 'none' }]);
  // getAffiliations and getNodeSubscribers resolve to a bare IQ: the payload is reachable but optional.
  const own = await c.getAffiliations(service);
  void own.pubsub?.affiliations?.items;
  // BUG: the retract event type intersects PubsubEventItems.retracted (string[]) with PubsubItem[], giving
  // `string[] & PubsubItem[]`, so each element is typed as both. The transport must re-type it.
  c.on('pubsub:retracted', (m) => assertType<Equal<typeof m.pubsub.items.retracted, string[] & XMPP.Stanzas.PubsubItem[]>>(true));
  c.on('pubsub:subscription', (m) => assertType<Equal<typeof m.pubsub.state, 'subscribed' | 'pending' | 'unconfigured' | 'none'>>(true));
  c.on('pubsub:deleted', (m) => void m.pubsub.node);
  // ANY: XEP-0335 JSON item content is `json?: any`; the transport must treat it as `unknown`.
  const items = await c.getItems<XMPP.Stanzas.JSONItem>(service, node);
  const json: unknown = items.items?.[0]?.content?.json;
  void json;

  // ---- XEP-0313 + XEP-0059 -------------------------------------------------------------------------
  const fin = await c.searchHistory(room, { paging: { max: 50, before: '' } });
  assertType<Equal<typeof fin.complete, boolean | undefined>>(true);
  assertType<Equal<typeof fin.paging, XMPP.Stanzas.Paging | undefined>>(true);
  for (const r of fin.results ?? []) {
    assertType<Equal<typeof r.id, string>>(true); // archive id = RSM cursor
    const stamp = r.item.delay?.timestamp; // server timestamp
    assertType<Equal<typeof stamp, Date | undefined>>(true);
  }
  const prefs = await c.getHistoryPreferences();
  void prefs.default;

  // ---- XEP-0050 / XEP-0133 ---------------------------------------------------------------------
  // No helper beyond getCommands(); commands go through sendIQ, whose `command` payload IS typed.
  const list = await c.getCommands('localhost');
  void list.items;
  // GOTCHA: sendIQ<T = IQ, R = T>(iq: T & IQ): Promise<IQ & R> infers R from the REQUEST literal, so the
  // response is typed as an echo of what we sent: `command` becomes required and `action: 'execute'`,
  // though the server's reply may lack the payload entirely. Always pass <IQ>.
  const echo = await c.sendIQ({ to: 'localhost', type: 'set', command: { node: 'n', action: 'execute' } });
  assertType<Equal<typeof echo.command, XMPP.Stanzas.AdHocCommand & { node: string; action: 'execute' }>>(true);
  const res = await c.sendIQ<XMPP.Stanzas.IQ>({ to: 'localhost', type: 'set', command: { node: 'n', action: 'execute' } });
  assertType<Equal<typeof res.command, XMPP.Stanzas.AdHocCommand | undefined>>(true);
  // Errors: rejected promises are untyped (`catch (e)` is unknown). The error IQ shape exists as a type
  // (StanzaError with `condition`, `commandError`, `pubsubError`) but must be narrowed by hand.
  const condition: XMPP.Stanzas.StanzaError['condition'] = 'forbidden';
  void condition;

  // ---- XEP-0198 --------------------------------------------------------------------------------
  c.on('stream:management:resumed', (sm) => void sm.type);
  c.on('stanza:failed', (f) => void f.kind);
  c.on('stanza:acked', (a) => void a.stanza);
  // SM state can be persisted for resumption after a page reload.
  c.sm.cache((state) => void state.id);
  assertType<Equal<typeof c.sm.resumable, boolean>>(true);

  // ---- SASL ----------------------------------------------------------------------------------------
  c.sasl.disable('PLAIN');
  c.on('auth:failed', () => undefined);
  const creds = await c.getCredentials();
  void creds?.password;

  // ---- `any` leaks in the public typings ----------------------------------------------------------
  // ANY: AgentEvents['stream:data'] = (json: any, kind) and '*' = (...args: any[]); Message.json?: any;
  // Agent._keepAliveInterval?: any. None is needed by the transport; a lint rule must keep them out.
}
