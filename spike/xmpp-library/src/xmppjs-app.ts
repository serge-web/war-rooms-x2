// Browser smoke app for the fallback, @xmpp/client. Bundles the same surface the live test exercises
// (src/xmppjs-client.ts) so the size comparison with stanza-app.ts is like for like.

import type { Endpoints } from './endpoints.ts';
import * as X from './xmppjs-client.ts';
import { readForm, show } from './page.ts';

let session: X.XSession | undefined;

document.querySelector('form')?.addEventListener('submit', (ev) => {
  ev.preventDefault();
  void (async () => {
    const f = readForm();
    if (session) await X.disconnect(session.client);
    const ep: Endpoints = { websocketUrl: f.url, domain: f.domain, mucService: `conference.${f.domain}`, pubsubService: `pubsub.${f.domain}` };
    try {
      session = await X.connect(ep, f.user ? { kind: 'password', user: f.user, password: f.password } : { kind: 'anonymous' });
      const page = await X.mamPage(session.client, `${f.user}@${f.domain}`, 1, '').catch(() => undefined);
      show(`xmpp.js: online as ${session.jid} via ${session.mechanism ?? '?'}; own archive count ${String(page?.count)}`);
    } catch (e) {
      show(`xmpp.js: ${String(e)}`);
    }
  })();
});

// Keep the rest of the fallback surface in the bundle (tree-shaking would otherwise drop it).
Object.assign(globalThis, { wrxXmppjs: X });
