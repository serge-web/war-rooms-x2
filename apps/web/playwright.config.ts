import { X509Certificate, createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Two builds (vite.config.ts): the mock-only one that previews and the site use, and the
// real-server one, which reads config.json. server.spec.ts runs against the second, and so do
// ejabberd.spec.ts and the user scenarios (e2e/scenarios, WP 3.1) when WRX_XMPP_WS names a
// running reference ejabberd (the contract CI job); the rest, scenarios included, run against
// the first. The smoke test runs against both.
// WRX_E2E_MOCK_PORT and WRX_E2E_SERVER_PORT move them, e.g. for two checkouts on one machine.
const mockPort = Number(process.env.WRX_E2E_MOCK_PORT ?? 4173)
const serverPort = Number(process.env.WRX_E2E_SERVER_PORT ?? 4175)

/**
 * Chromium trusts the reference ejabberd's test certificate by pinning its key, not by ignoring
 * certificate errors (as the transport's bundle test does).
 */
function ejabberdArgs(): string[] {
  if (process.env.WRX_XMPP_WS === undefined) return []
  const cert =
    process.env.WRX_XMPP_CERT ??
    fileURLToPath(new URL('../../deploy/ejabberd/tls-out/server.crt', import.meta.url))
  if (!existsSync(cert)) return []
  const spki = new X509Certificate(readFileSync(cert)).publicKey.export({
    type: 'spki',
    format: 'der',
  })
  return [
    `--ignore-certificate-errors-spki-list=${createHash('sha256').update(spki).digest('base64')}`,
  ]
}

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'mock-build',
      testIgnore: /(server|ejabberd)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${mockPort}/` },
    },
    {
      name: 'server-build',
      testMatch: /(server|shell)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${serverPort}/` },
    },
    {
      // One game per server (D11): run with --workers=1, as CI does.
      name: 'ejabberd',
      testMatch: /(ejabberd\.spec\.ts|scenarios\/.*\.spec\.ts)$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${serverPort}/`,
        launchOptions: { args: ejabberdArgs() },
      },
    },
  ],
  webServer: [
    {
      command: `pnpm build && pnpm exec vite preview --port ${mockPort} --strictPort`,
      port: mockPort,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm build:server && pnpm exec vite preview --mode server --port ${serverPort} --strictPort`,
      port: serverPort,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
