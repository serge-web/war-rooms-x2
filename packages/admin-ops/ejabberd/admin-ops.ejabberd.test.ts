// The admin-ops integration scenario against the reference ejabberd (deploy/ejabberd), through
// the real transport. Run with `pnpm test:admin-ops:ejabberd` after `pnpm stack:up`. It uses the
// design's own unprefixed names (one wargame per server, D11), and clears them before and after.
import { XmppTransport } from '@wrx/transport-xmpp'
import { defineAdminOpsIntegration } from '../integration/scenario.ts'

defineAdminOpsIntegration({
  name: 'ejabberd',
  transport: new XmppTransport({ timeoutMs: 10_000, backoff: { initialMs: 200, maxMs: 2_000 } }),
  endpoint: {
    websocketUrl: process.env.WRX_XMPP_WS ?? 'wss://localhost:35443/ws',
    domain: process.env.WRX_XMPP_DOMAIN ?? 'localhost',
  },
  /** Set by deploy/ejabberd/bootstrap.sh for a throwaway local container; not a product secret. */
  adminPassword: process.env.WRX_ADMIN_PASSWORD ?? 'spike-password',
})
