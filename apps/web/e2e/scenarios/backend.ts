// The scenarios' backend (NFR-17, WP 3.1): one test body, two backends. The `mock-build` project
// runs each scenario on the mock build, where every browser context is a fresh mock seeded with
// the demo game (D17, DOC-10). The `ejabberd` project runs the same body on the real-server
// build against the reference ejabberd (deploy/ejabberd), which CI's contract-ejabberd workflow
// starts and names in WRX_XMPP_WS; before each scenario the server is reset and the same demo
// game published on it (ejabberd-game.ts). A step only one backend can do says so where it is.
import { test as base, expect } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { DOMAIN } from '../mock.ts'
import { ejabberdServer, nodeTransport, publishDemoGame, resetServer } from './ejabberd-game.ts'
import type { EjabberdServer } from './ejabberd-game.ts'
import { cuttableLink } from './link.ts'
import type { CuttableLink } from './link.ts'
import { rawRun } from './raw.ts'
import type { RawStep } from './raw.ts'

export type BackendKind = 'mock' | 'ejabberd'

export interface Backend {
  readonly kind: BackendKind
  /** The domain of role JIDs. */
  readonly domain: string
  /** The password of a demo role or of the admin on this backend. */
  password(id: string): string
  /** The badge the app shows for this backend. */
  readonly badge: string
  /**
   * Logs in as `username` with a client other than the app and runs the steps: as the admin,
   * or as a role (a modified client, SC-4). In the page on the mock (it lives there), in Node
   * over the real transport on ejabberd. Each step's outcome: `ok` or the refusal's condition.
   */
  raw(page: Page, username: string, steps: readonly RawStep[]): Promise<string[]>
  /** As `raw`, as the admin, expecting every step to succeed. */
  asAdmin(page: Page, steps: readonly RawStep[]): Promise<void>
  /**
   * Takes a page's network away, or gives it back (PLY-2). On ejabberd the page's context (a
   * `peerContext`) goes offline (`context.setOffline`) and its link to the server is cut, so its
   * WebSocket drops (link.ts says why both). The mock runs inside
   * the browser, so going offline does not reach it (it is meant to work offline, SC-7): there
   * the page's tab drops its mock connections and refuses new ones until the network is back,
   * which is what the server side of a real drop looks like to the client.
   */
  setNetwork(page: Page, online: boolean): Promise<void>
}

export interface ScenarioFixtures {
  /**
   * What the server holds when the scenario starts: the demo game (the default), or nothing
   * (`test.use({ startWith: 'empty' })`, SC-1). The mock always starts from its demo seed.
   */
  readonly startWith: 'demo' | 'empty'
  readonly backend: Backend
  /**
   * A browser context for a second person, whose network can go away on its own (SC-3): a new
   * context on ejabberd; on the mock, the test's own context, since the mock is shared only
   * within one (D17) and `setNetwork` drops one tab there.
   */
  readonly peerContext: BrowserContext
}

interface WorkerFixtures {
  readonly server: EjabberdServer | undefined
}

/** Points a context's real-server build at the reference ejabberd (NFR-9: config.json). */
export async function useEjabberd(
  context: BrowserContext,
  server: EjabberdServer,
  websocketUrl = server.endpoint.websocketUrl,
): Promise<void> {
  await context.route('**/config.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        server: {
          websocketUrl,
          domain: server.endpoint.domain,
          label: 'Reference ejabberd',
        },
      }),
    }),
  )
}

/** The cuttable link of each peer context on ejabberd. */
const links = new WeakMap<BrowserContext, CuttableLink>()

export const test = base.extend<ScenarioFixtures, WorkerFixtures>({
  server: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures it needs from this pattern
    async ({}, use, workerInfo) => {
      const server = workerInfo.project.name === 'ejabberd' ? ejabberdServer() : undefined
      await use(server)
    },
    { scope: 'worker' },
  ],
  context: async ({ context, server }, use) => {
    if (server !== undefined) await useEjabberd(context, server)
    await use(context)
  },
  startWith: ['demo', { option: true }],
  peerContext: async ({ browser, context, server, baseURL }, use) => {
    if (server === undefined) {
      await use(context)
      return
    }
    const peer = await browser.newContext(baseURL === undefined ? {} : { baseURL })
    const link = await cuttableLink(server.endpoint.websocketUrl)
    links.set(peer, link)
    await useEjabberd(peer, server, link.websocketUrl)
    await use(peer)
    await peer.close()
    await link.close()
  },
  backend: [
    async ({ server, startWith }, use, testInfo) => {
      if (testInfo.project.name === 'ejabberd' && server === undefined) {
        test.skip(true, 'needs WRX_XMPP_WS: start the stack with pnpm stack:up')
      }
      if (server === undefined) {
        const mock: Backend = {
          kind: 'mock',
          domain: DOMAIN,
          badge: 'Backend: MOCK',
          password: (id) => `demo-${id}`,
          raw: async (page, username, steps) => {
            await page.waitForFunction(() => window.wrxMock !== undefined)
            return page.evaluate(rawRun, {
              endpoint: { websocketUrl: '', domain: DOMAIN },
              username,
              password: `demo-${username}`,
              steps,
            })
          },
          asAdmin: async (page, steps) => {
            const results = await mock.raw(page, 'admin', steps)
            expect(results.filter((r) => r !== 'ok')).toEqual([])
          },
          setNetwork: async (page, online) => {
            await page.evaluate((on) => {
              window.wrxMock?.setNetworkOnline(on)
            }, online)
          },
        }
        await use(mock)
        return
      }
      // A fresh demo game for every scenario; one game per server (D11), so the ejabberd
      // project runs one worker.
      testInfo.setTimeout(testInfo.timeout + 120_000)
      if (startWith === 'demo') await publishDemoGame(server)
      else await resetServer(server)
      const password = (id: string) => (id === 'admin' ? server.adminPassword : `demo-${id}`)
      const real: Backend = {
        kind: 'ejabberd',
        domain: server.endpoint.domain,
        badge: 'Backend: Reference ejabberd',
        password,
        raw: (_page, username, steps) =>
          rawRun(
            { endpoint: server.endpoint, username, password: password(username), steps },
            nodeTransport(),
          ),
        asAdmin: async (page, steps) => {
          const results = await real.raw(page, 'admin', steps)
          expect(results.filter((r) => r !== 'ok')).toEqual([])
        },
        setNetwork: async (page, online) => {
          const link = links.get(page.context())
          if (link === undefined) throw new Error('setNetwork: use a page of peerContext')
          await page.context().setOffline(!online)
          link.setUp(online)
        },
      }
      await use(real)
    },
    { auto: true },
  ],
})

export { expect }

/** Opens the app's welcome page on the scenario's backend. */
export async function openApp(page: Page, backend: Backend, path = './'): Promise<void> {
  await page.goto(path)
  await expect(page.getByLabel(backend.badge)).toBeVisible()
}

/** Logs in on the welcome page as a demo role (or the admin) with its password. */
export async function logInAs(page: Page, backend: Backend, id: string): Promise<void> {
  await page.getByLabel('Role id').fill(id)
  await page.getByLabel('Password', { exact: true }).fill(backend.password(id))
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
}

/**
 * What a WebSocket that fails or closes reports outside the app, on ejabberd: Chromium logs the
 * socket ("WebSocket connection to ... failed: ...", e.g. a reconnection attempt while offline,
 * or "Close received after close" as the welcome page's anonymous session ends), and StanzaJS
 * logs the socket's error Event. Not app errors, so not collected.
 */
const SOCKET_REPORT = /^WebSocket connection to .* failed|^Event$/

/** Collects console errors and page errors, to assert none at the end. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !SOCKET_REPORT.test(m.text())) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}
