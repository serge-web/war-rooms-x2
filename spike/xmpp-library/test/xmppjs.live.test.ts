// WP 0.3 live script, fallback: the same flow as stanza.live.test.ts over @xmpp/client 0.14.0 with the
// hand-written builders in src/xmppjs-client.ts. Fails (never skips) when the server is unreachable.

import { afterAll, describe, expect, it } from 'vitest';
import { uniq } from '../src/endpoints.ts';
import * as X from '../src/xmppjs-client.ts';
import { adminPassword, assertReachable, endpoints as ep, setupOrFail } from './env.ts';

const run = uniq('x');
const user = `wp03-${run}`;
const userJid = `${user}@${ep.domain}`;
const userPassword = `pw-${run}`;
const roomJid = `${run}@${ep.mucService}`;
const node = `wp03-${run}`;
const POSTS = 7;

let admin: X.XClient;
let player: X.XClient;
const opened: X.XClient[] = [];
const report: Record<string, unknown> = {};

setupOrFail(async () => {
  await assertReachable();
  const a = await X.connect(ep, { kind: 'password', user: 'admin', password: adminPassword }, { resource: `admin-${run}` });
  admin = a.client;
  opened.push(admin);
  report['admin mechanism'] = a.mechanism;
  await admin.send(X.presence());
}, 30_000);

afterAll(async () => {
  if (admin?.status === 'online') {
    await X.destroyRoom(admin, roomJid).catch(() => undefined);
    await X.deleteNode(admin, ep.pubsubService, node).catch(() => undefined);
    await X.adhoc(admin, ep.domain, 'delete-user', { accountjids: [userJid] }).catch(() => undefined);
  }
  await Promise.all(opened.map((c) => X.disconnect(c)));
  console.info('[xmpp.js live]', JSON.stringify(report, null, 1));
});

describe('@xmpp/client 0.14.0 against ejabberd 26.09 over wss://', () => {
  it('XEP-0133: admin creates a user, and reads the online-user count', async () => {
    await X.adhoc(admin, ep.domain, 'add-user', { accountjid: userJid, password: userPassword, 'password-verify': userPassword });
    const p = await X.connect(ep, { kind: 'password', user, password: userPassword }, { resource: 'pane-1' });
    player = p.client;
    opened.push(player);
    await player.send(X.presence());
    report['player mechanism'] = p.mechanism;
    const form = await X.adhoc(admin, ep.domain, 'get-online-users-num', {});
    const count = Number(form.get('onlineusersnum')?.[0]);
    report['online users'] = count;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('SASL ANONYMOUS session', async () => {
    const anon = await X.connect(ep, { kind: 'anonymous' });
    opened.push(anon.client);
    report['anonymous mechanism'] = anon.mechanism;
    expect(anon.mechanism).toBe('ANONYMOUS');
  });

  it('XEP-0198 is enabled', async () => {
    const s = await X.connect(ep, { kind: 'password', user, password: userPassword }, { resource: 'pane-sm' });
    opened.push(s.client);
    const deadline = Date.now() + 3_000;
    while (!s.client.streamManagement.enabled && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    report['SM enabled'] = s.client.streamManagement.enabled;
    report['SM id present (resumable)'] = Boolean(s.client.streamManagement.id);
    expect(s.client.streamManagement.enabled).toBe(true);

    // Resumption is NOT demonstrated for xmpp.js. Dropping the socket with the typed `socket.end()` left the
    // client 'online' for 4 s+ (it waits for the WebSocket close event, which did not arrive from ejabberd),
    // and client.disconnect() sends </stream>, which ends the session. Listening for the runtime 'resumed'
    // event would also need a cast: @types/xmpp__stream-management types the EventEmitter as a data object.
  });

  it('XEP-0045 owner and admin: create, configure, affiliate, list, set role', async () => {
    const self = await X.joinRoom(admin, roomJid, 'admin');
    expect(self.affiliation).toBe('owner');
    const cfg = await X.getRoomConfig(admin, roomJid);
    expect(cfg.has('muc#roomconfig_membersonly')).toBe(true);
    await X.configureRoom(admin, roomJid, {
      'muc#roomconfig_persistentroom': true,
      'muc#roomconfig_membersonly': true,
      'muc#roomconfig_moderatedroom': true,
      'muc#roomconfig_publicroom': false,
      'muc#roomconfig_whois': 'moderators',
      mam: true,
    });
    await X.setRoomAffiliation(admin, roomJid, userJid, 'member');
    expect(await X.getRoomAffiliates(admin, roomJid, 'member')).toContain(userJid);
    const joined = await X.joinRoom(player, roomJid, 'blue-co');
    expect(joined).toMatchObject({ affiliation: 'member', role: 'participant' });
    expect(joined.statusCodes).toContain('110');
    await X.setRoomRole(admin, roomJid, 'blue-co', 'visitor');
    await X.setRoomRole(admin, roomJid, 'blue-co', 'participant');
  });

  it('posts messages and pages MAM backwards with RSM <before/>', async () => {
    const bodies = Array.from({ length: POSTS }, (_, i) => `${run}-m${i}`);
    for (const body of bodies) {
      const echo = X.waitForStanza(player, (el) => el.is('message') && el.getChildText('body') === body);
      await player.send(X.groupchat(roomJid, body));
      await echo;
    }
    const seen: string[] = [];
    const pages: string[][] = [];
    let before = '';
    for (let guard = 0; guard < 10; guard++) {
      const page = await X.mamPage(player, roomJid, 3, before);
      pages.push(page.items.map((i) => i.body ?? ''));
      seen.unshift(...page.items.map((i) => i.body ?? ''));
      for (const i of page.items) {
        expect(i.stamp).toBeTruthy();
        expect(i.from?.startsWith(`${roomJid}/`)).toBe(true);
      }
      if (page.complete) break;
      if (!page.first) throw new Error('RSM <first/> missing');
      before = page.first;
    }
    report['MAM pages'] = pages;
    expect(seen.filter((b) => b.startsWith(run))).toEqual(bodies);
  });

  it('XEP-0060 owner ops, subscription, publish, item event and read', async () => {
    await X.createNode(admin, ep.pubsubService, node, {
      'pubsub#access_model': 'whitelist',
      'pubsub#publish_model': 'publishers',
      'pubsub#persist_items': true,
      'pubsub#max_items': '10',
    });
    expect((await X.getNodeConfig(admin, ep.pubsubService, node)).get('pubsub#access_model')).toEqual(['whitelist']);
    await X.setNodeAffiliations(admin, ep.pubsubService, node, [{ jid: userJid, affiliation: 'member' }]);
    expect(await X.getNodeAffiliations(admin, ep.pubsubService, node)).toContainEqual({ jid: userJid, affiliation: 'member' });
    expect(await X.subscribe(player, ep.pubsubService, node, userJid)).toBe('subscribed');
    expect((await X.getNodeSubscriptions(admin, ep.pubsubService, node)).map((s) => s.jid.split('/')[0])).toContain(userJid);

    const doc = { schemaVersion: 1, text: `objectives ${run}` };
    const event = X.waitForItems(player, node);
    await X.publishJson(admin, ep.pubsubService, node, 'current', doc);
    const evItems = await event;
    expect(evItems[0]?.id).toBe('current');
    expect(JSON.parse(evItems[0]?.json ?? 'null')).toEqual(doc);
    const got = await X.getItems(player, ep.pubsubService, node, 5);
    expect(JSON.parse(got[0]?.json ?? 'null')).toEqual(doc);
  });

  it('server refusals reject with a defined condition', async () => {
    let condition: string | undefined;
    try {
      await X.createNode(player, ep.pubsubService, `${node}-denied`, {});
    } catch (e) {
      condition = X.errorCondition(e);
    }
    report['player createNode refused with'] = condition;
    expect(condition).toBe('forbidden');
  });
});
