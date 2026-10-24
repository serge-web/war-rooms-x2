// Browser smoke app for StanzaJS: proves `stanza` bundles for the browser with Vite and runs there.
// Endpoints come from the form (NFR-9). Uses only the shared helpers the live test uses.

import * as helpers from './stanza-client.ts';
import { connect, disconnect, type Session } from './stanza-client.ts';
import type { Endpoints } from './endpoints.ts';
import { readForm, show } from './page.ts';

let session: Session | undefined;

document.querySelector('form')?.addEventListener('submit', (ev) => {
  ev.preventDefault();
  void (async () => {
    const f = readForm();
    if (session) await disconnect(session.client);
    const ep: Endpoints = { websocketUrl: f.url, domain: f.domain, mucService: `conference.${f.domain}`, pubsubService: `pubsub.${f.domain}` };
    try {
      session = await connect(ep, f.user ? { kind: 'password', user: f.user, password: f.password } : { kind: 'anonymous' });
      show(`stanza: online as ${session.client.jid} via ${session.mechanism ?? '?'}`);
    } catch (e) {
      show(`stanza: ${String(e)}`);
    }
  })();
});

// Keep the helper surface in the bundle, as xmppjs-app.ts does (StanzaJS itself registers every plugin in
// createClient, so it does not tree-shake).
Object.assign(globalThis, { wrxStanza: helpers });
