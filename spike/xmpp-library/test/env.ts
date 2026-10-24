// Test endpoints for the WP 0.3 reference ejabberd (docker/compose.yaml). Override with env vars.
import { beforeAll, beforeEach } from 'vitest';
import type { Endpoints } from '../src/endpoints.ts';

export const endpoints: Endpoints = {
  websocketUrl: process.env['XMPP_WS_URL'] ?? 'wss://localhost:25443/ws',
  domain: process.env['XMPP_DOMAIN'] ?? 'localhost',
  mucService: process.env['XMPP_MUC'] ?? 'conference.localhost',
  pubsubService: process.env['XMPP_PUBSUB'] ?? 'pubsub.localhost',
};

/** Set by docker/bootstrap.sh. A test secret for a throwaway local container, not a product secret (NFR-1). */
export const adminPassword = process.env['ADMIN_PASSWORD'] ?? 'spike-password';

/**
 * beforeAll that, if it throws, fails every test in the file instead of letting vitest report them as
 * skipped: the error is rethrown from beforeEach, which fails each test.
 */
export function setupOrFail(setup: () => Promise<void>, timeoutMs: number): void {
  let failure: unknown;
  beforeAll(async () => {
    try {
      await setup();
    } catch (e) {
      failure = e;
    }
  }, timeoutMs);
  beforeEach(() => {
    if (failure !== undefined) throw failure;
  });
}

/** Fail (never skip) with a clear message when the server is not up. */
export async function assertReachable(): Promise<void> {
  const httpsUrl = endpoints.websocketUrl.replace(/^ws/, 'http');
  try {
    await fetch(httpsUrl, { signal: AbortSignal.timeout(5_000) });
  } catch (e) {
    throw new Error(
      `XMPP server unreachable at ${endpoints.websocketUrl}: start it with \`pnpm stack:up\` ` +
        `(and run tests via \`pnpm test\`, which trusts docker/tls-out/ca.crt). Cause: ${String(e)}`,
    );
  }
}
