import { X509Certificate, createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import type { Project } from '@playwright/test'

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

/**
 * The browsers to run (NFR-13): `WRX_E2E_BROWSERS=firefox` or `chromium,firefox,webkit`.
 * Default Chromium alone, the only browser installed locally; CI installs Firefox and WebKit for
 * their own jobs. Chromium keeps the plain project names; the others get a suffix, e.g.
 * `mock-build-firefox`. The ejabberd project is Chromium's only: it trusts the test certificate
 * with a Chromium flag.
 */
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
  const projects: Project[] = [
    {
      name: `mock-build${suffix}`,
      testIgnore: /(server|ejabberd)\.spec\.ts/,
      use: { ...device, baseURL: `http://localhost:${mockPort}/` },
    },
    {
      name: `server-build${suffix}`,
      testMatch: /(server|shell)\.spec\.ts/,
      use: { ...device, baseURL: `http://localhost:${serverPort}/` },
    },
  ]
  if (browser === 'chromium') {
    projects.push({
      name: 'ejabberd',
      testMatch: /ejabberd\.spec\.ts/,
      use: {
        ...device,
        baseURL: `http://localhost:${serverPort}/`,
        launchOptions: { args: ejabberdArgs() },
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
