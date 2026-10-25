import { X509Certificate, createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Two builds (vite.config.ts): the mock-only one that previews and the site use, and the
// real-server one, which reads config.json. server.spec.ts runs against the second, and so does
// ejabberd.spec.ts when WRX_XMPP_WS names a running reference ejabberd (the contract CI job);
// the rest run against the first. The smoke test runs against both.
const mockPort = 4173
const serverPort = 4175

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
      name: 'ejabberd',
      testMatch: /ejabberd\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${serverPort}/`,
        launchOptions: { args: ejabberdArgs() },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm build && pnpm preview',
      port: mockPort,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm build:server && pnpm preview:server',
      port: serverPort,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
