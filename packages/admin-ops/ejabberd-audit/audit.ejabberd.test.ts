// The audit scenario (WP 2.10) against the reference ejabberd (deploy/ejabberd), through the real
// transport. Run with `pnpm test:audit:ejabberd` after `pnpm stack:up`. It uses the design's own
// names (one wargame per server, D11), and resets the server before and after.
import { XmppTransport } from '@wrx/transport-xmpp'
import { defineAuditIntegration } from '../integration/audit-scenario.ts'

defineAuditIntegration({
  name: 'ejabberd',
  transport: new XmppTransport({ timeoutMs: 10_000, backoff: { initialMs: 200, maxMs: 2_000 } }),
  endpoint: {
    websocketUrl: process.env.WRX_XMPP_WS ?? 'wss://localhost:35443/ws',
    domain: process.env.WRX_XMPP_DOMAIN ?? 'localhost',
  },
  /** Set by deploy/ejabberd/bootstrap.sh for a throwaway local container; not a product secret. */
  adminPassword: process.env.WRX_ADMIN_PASSWORD ?? 'spike-password',
})
