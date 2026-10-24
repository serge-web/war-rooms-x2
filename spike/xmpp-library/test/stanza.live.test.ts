// WP 0.3 live script, StanzaJS: wss:// login as admin, test user and anonymous; XEP-0133 provisioning and
// online-user count; MUC owner/admin; MAM paged backwards with RSM; PubSub owner ops, publish, item event
// and read; XEP-0198 resumption. Fails (never skips) when the server is unreachable.
// Casts forced by StanzaJS typings are marked `CAST:`.

import { afterAll, describe, expect, it } from 'vitest';
import type * as XMPP from 'stanza';
import { NS_JSON, NS_NODECONFIG, NS_ROOMCONFIG, uniq } from '../src/endpoints.ts';
import { adhoc, connect, disconnect, errorCondition, fieldValue, submitForm, type Agent } from '../src/stanza-client.ts';
import { adminPassword, assertReachable, endpoints as ep, setupOrFail } from './env.ts';

const run = uniq('s');
const user = `wp03-${run}`;
const userJid = `${user}@${ep.domain}`;
const userPassword = `pw-${run}`;
const roomJid = `${run}@${ep.mucService}`;
const node = `wp03-${run}`;
const POSTS = 7;

let admin: Agent;
let player: Agent;
const opened: Agent[] = [];
const report: Record<string, unknown> = {};

function waitFor<K extends 'groupchat' | 'pubsub:published' | 'stream:management:resumed' | 'session:started'>(
  client: Agent,
  event: K,
  pred: (e: XMPP.AgentEvents[K]) => boolean,
  ms = 8_000,
): Promise<XMPP.AgentEvents[K]> {
  return new Promise((resolve, reject) => {
    const handler = (e: XMPP.AgentEvents[K]): void => {
      if (!pred(e)) return;
      clearTimeout(timer);
      // CAST: StrictEventEmitter's overloads can't be selected from a generic key K.
      client.off(event, handler as never);
      resolve(e);
    };
    const timer = setTimeout(() => {
      client.off(event, handler as never);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    client.on(event, handler as never);
  });
}

async function until(cond: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

setupOrFail(async () => {
  await assertReachable();
  const a = await connect(ep, { kind: 'password', user: 'admin', password: adminPassword }, { resource: `admin-${run}` });
  admin = a.client;
  opened.push(admin);
  report['admin mechanism'] = a.mechanism;
  expect(a.mechanism).toBe('SCRAM-SHA-256');
  admin.sendPresence();
}, 30_000);

afterAll(async () => {
  // Clean up server state, then close every session.
  if (admin?.sessionStarted) {
    await admin.destroyRoom(roomJid).catch(() => undefined);
    await admin.deleteNode(ep.pubsubService, node).catch(() => undefined);
    await adhoc(admin, ep.domain, 'delete-user', { accountjids: [userJid] }).catch(() => undefined);
  }
  await Promise.all(opened.map((c) => disconnect(c)));
  console.info('[stanza live]', JSON.stringify(report, null, 1));
});

describe('StanzaJS 12.22.1 against ejabberd 26.09 over wss://', () => {
  it('XEP-0133: admin creates a user, and reads the online-user count', async () => {
    await adhoc(admin, ep.domain, 'add-user', { accountjid: userJid, password: userPassword, 'password-verify': userPassword });
    const p = await connect(ep, { kind: 'password', user, password: userPassword }, { resource: 'pane-1' });
    player = p.client;
    opened.push(player);
    player.sendPresence();
    report['player mechanism'] = p.mechanism;
    expect(p.mechanism).toBe('SCRAM-SHA-256');

    const num = await adhoc(admin, ep.domain, 'get-online-users-num', {});
    const count = Number(fieldValue(num.form, 'onlineusersnum'));
    report['online users (XEP-0133 get-online-users-num)'] = count;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('SASL ANONYMOUS session', async () => {
    const anon = await connect(ep, { kind: 'anonymous' });
    opened.push(anon.client);
    report['anonymous mechanism'] = anon.mechanism;
    report['anonymous jid'] = anon.client.jid;
    expect(anon.mechanism).toBe('ANONYMOUS');
  });

  it('XEP-0198 is enabled and a dropped socket resumes the same session', async () => {
    const s = await connect(ep, { kind: 'password', user, password: userPassword }, { resource: 'pane-sm', autoReconnect: true });
    opened.push(s.client);
    // 'session:started' fires at resource bind, before the server's <enabled/> arrives: wait for it.
    const smAtSessionStart = s.client.sm.started;
    await until(() => s.client.sm.started, 3_000);
    report['SM already enabled at session:started'] = smAtSessionStart;
    expect(s.client.sm.started).toBe(true);
    expect(s.client.sm.resumable).toBe(true);
    const jid = s.client.jid;
    const resumed = waitFor(s.client, 'stream:management:resumed', () => true, 15_000);
    s.client.transport?.disconnect(false); // drop the socket without </stream>
    await resumed;
    report['SM resumed same full JID'] = s.client.jid === jid;
    expect(s.client.jid).toBe(jid);
  }, 30_000);

  it('XEP-0045 owner and admin: create, configure, affiliate, list, set role', async () => {
    const self = await admin.joinRoom(roomJid, 'admin');
    expect(self.muc.affiliation).toBe('owner');
    const form = await admin.getRoomConfig(roomJid);
    expect(form.fields?.some((f) => f.name === 'muc#roomconfig_membersonly')).toBe(true);
    await admin.configureRoom(
      roomJid,
      submitForm(NS_ROOMCONFIG, {
        'muc#roomconfig_persistentroom': true,
        'muc#roomconfig_membersonly': true,
        'muc#roomconfig_moderatedroom': true,
        'muc#roomconfig_publicroom': false,
        'muc#roomconfig_whois': 'moderators',
        mam: true,
      }),
    );
    await admin.setRoomAffiliation(roomJid, userJid, 'member');
    const members = await admin.getRoomMembers(roomJid, { affiliation: 'member' });
    expect((members.muc.users ?? []).map((u) => u.jid)).toContain(userJid);

    const joined = await player.joinRoom(roomJid, 'blue-co');
    expect(joined.muc.affiliation).toBe('member');
    expect(joined.muc.role).toBe('participant');
    expect(joined.muc.statusCodes).toContain('110');

    await admin.setRoomRole(roomJid, 'blue-co', 'visitor');
    await admin.setRoomRole(roomJid, 'blue-co', 'participant');
  });

  it('posts messages and pages MAM backwards with RSM <before/>', async () => {
    const bodies = Array.from({ length: POSTS }, (_, i) => `${run}-m${i}`);
    for (const body of bodies) {
      const echoed = waitFor(player, 'groupchat', (m) => m.body === body);
      player.sendMessage({ to: roomJid, type: 'groupchat', body });
      const echo = await echoed;
      // The live echo carries the archive id (XEP-0359) that MAM paging uses.
      expect(echo.stanzaIds?.some((s) => s.by === roomJid)).toBe(true);
    }

    const pages: string[][] = [];
    const seen: string[] = [];
    let before = ''; // empty <before/> = the last page
    for (let guard = 0; guard < 10; guard++) {
      const fin = await player.searchHistory(roomJid, { paging: { max: 3, before } });
      const page = (fin.results ?? []).map((r) => r.item.message?.body ?? '');
      pages.push(page);
      seen.unshift(...page);
      for (const r of fin.results ?? []) {
        expect(r.item.delay?.timestamp).toBeInstanceOf(Date); // server timestamp
        expect(r.item.message?.from?.startsWith(`${roomJid}/`)).toBe(true); // occupant JID
      }
      if (fin.complete) break;
      if (!fin.paging?.first) throw new Error('RSM <first/> missing on incomplete page');
      before = fin.paging.first;
    }
    report['MAM pages (max=3, newest first)'] = pages;
    expect(seen.filter((b) => b.startsWith(run))).toEqual(bodies);
  });

  it('XEP-0060 owner ops, subscription, publish, item event and read', async () => {
    await admin.createNode(
      ep.pubsubService,
      node,
      submitForm(NS_NODECONFIG, {
        'pubsub#access_model': 'whitelist',
        'pubsub#publish_model': 'publishers',
        'pubsub#persist_items': true,
        'pubsub#max_items': '10',
        'pubsub#deliver_payloads': true,
      }),
    );
    const cfg = await admin.getNodeConfig(ep.pubsubService, node);
    expect(fieldValue(cfg, 'pubsub#access_model')).toBe('whitelist');

    await admin.updateNodeAffiliations(ep.pubsubService, node, [{ jid: userJid, affiliation: 'member' }]);
    const affs = await admin.getNodeAffiliations(ep.pubsubService, node);
    expect(affs.items?.find((a) => a.jid === userJid)?.affiliation).toBe('member');

    const sub = await player.subscribeToNode(ep.pubsubService, node);
    expect(sub.state).toBe('subscribed');
    // getNodeSubscribers is typed Promise<IQ>: the payload is reachable but not narrowed.
    const subs = await admin.getNodeSubscribers(ep.pubsubService, node);
    expect((subs.pubsub?.subscriptions?.items ?? []).map((s) => s.jid?.split('/')[0])).toContain(userJid);

    const doc = { schemaVersion: 1, text: `objectives ${run}` };
    const event = waitFor(player, 'pubsub:published', (m) => m.pubsub.items.node === node);
    const item: XMPP.Stanzas.JSONItem = { itemType: NS_JSON, json: doc };
    await admin.publish(ep.pubsubService, node, item, 'current');
    const ev = await event;
    const published = ev.pubsub.items.published[0];
    expect(published?.id).toBe('current');
    // Item content is typed PubsubItemContent; reaching `json` needs a narrowing on itemType.
    const content = published?.content;
    expect(content && 'json' in content ? content.json : undefined).toEqual(doc);

    const got = await player.getItems<XMPP.Stanzas.JSONItem>(ep.pubsubService, node, { max: 5 });
    expect(got.items?.[0]?.content?.json).toEqual(doc); // `json` is `any` in StanzaJS's types
    report['pubsub item read back'] = got.items?.[0]?.content?.json;
  });

  it('server refusals reject with a typed-enough error IQ', async () => {
    let condition: string | undefined;
    try {
      await player.createNode(ep.pubsubService, `${node}-denied`);
    } catch (e) {
      condition = errorCondition(e);
    }
    report['player createNode refused with'] = condition;
    expect(condition).toBe('forbidden');
  });
});
