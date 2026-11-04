import { X509Certificate, createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import type { Project } from '@playwright/test'

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

/**
 * The browsers to run (NFR-13): `WRX_E2E_BROWSERS=firefox` or `chromium,firefox,webkit`.
 * Default Chromium alone, the only browser installed locally; CI installs Firefox and WebKit for
 * their own jobs. Chromium keeps the plain project names; the others get a suffix, e.g.
 * `mock-build-firefox`. The ejabberd project is Chromium's only: it trusts the test certificate
 * with a Chromium flag.
 */
/**
 * Map tiles never reach the internet from a test (WP 5.5, DOC-20): each test that shows the map
 * serves a local tile by route (e2e/map.ts), and Chromium cannot resolve the demo's tile host, so
 * a test that forgets fails rather than fetching.
 */
const NO_TILE_HOST = '--host-resolver-rules=MAP tile.openstreetmap.org ~NOTFOUND'

type BrowserName = 'chromium' | 'firefox' | 'webkit'
const DEVICES: Record<BrowserName, (typeof devices)[string]> = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
}
function isBrowserName(name: string): name is BrowserName {
  return name in DEVICES
}
const browsers: BrowserName[] = (process.env.WRX_E2E_BROWSERS ?? 'chromium')
  .split(',')
  .map((b) => b.trim())
  .filter((b) => b !== '')
  .map((b) => {
    if (!isBrowserName(b)) throw new Error(`WRX_E2E_BROWSERS: unknown browser "${b}"`)
    return b
  })

function browserProjects(browser: BrowserName): Project[] {
  const suffix = browser === 'chromium' ? '' : `-${browser}`
  const device = DEVICES[browser]
  const args = browser === 'chromium' ? [NO_TILE_HOST] : []
  const projects: Project[] = [
    {
      name: `mock-build${suffix}`,
      testIgnore: /(server|ejabberd)\.spec\.ts/,
      use: { ...device, baseURL: `http://localhost:${mockPort}/`, launchOptions: { args } },
    },
    {
      name: `server-build${suffix}`,
      testMatch: /(server|shell)\.spec\.ts/,
      use: { ...device, baseURL: `http://localhost:${serverPort}/`, launchOptions: { args } },
    },
  ]
  if (browser === 'chromium') {
    projects.push({
      // One game per server (D11): run with --workers=1, as CI does.
      name: 'ejabberd',
      testMatch: /(ejabberd\.spec\.ts|scenarios\/.*\.spec\.ts)$/,
      use: {
        ...device,
        baseURL: `http://localhost:${serverPort}/`,
        launchOptions: { args: [...ejabberdArgs(), NO_TILE_HOST] },
      },
    })
  }
  return projects
}

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: browsers.flatMap(browserProjects),
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
