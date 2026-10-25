// Helpers for scenarios that show the app on the mock (WP 2.4, DOC-20).
import { expect } from '@playwright/test'
import type { FrameLocator, Locator, Page } from '@playwright/test'

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly condition: string } }

declare global {
  interface Window {
    /** The app's mock host (apps/web main.tsx); only what these scenarios use. */
    wrxMock?: {
      connect(options: {
        endpoint: { websocketUrl: string; domain: string }
        credentials: { kind: 'password'; username: string; password: string }
        resource: string
      }): Promise<
        Outcome<{
          pubsub: { publish(node: string, id: string, payload: string): Promise<Outcome<unknown>> }
          disconnect(): Promise<void>
        }>
      >
    }
  }
}

/**
 * Hosts the mock in a leader tab, not a SharedWorker. A SharedWorker's script request never
 * reports as finished to the page, so `shoot()` would wait for network idle forever. The mock
 * host reads this override from localStorage under its deployment's namespace (DOC-10); the
 * init script also runs in iframes, so an embedded app gets it too. Call before navigating.
 */
export async function hostMockInLeaderTab(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const folder = new URL('.', location.href).pathname
    try {
      localStorage.setItem(`wrx1-mock:${folder}:hosting`, 'leader')
    } catch {
      // Storage blocked: the mock falls back by itself.
    }
  })
}

/** Waits until the app's welcome page has loaded the demo game. */
export async function welcomeLoaded(app: Page | FrameLocator): Promise<void> {
  await expect(app.getByLabel('Backend: MOCK')).toBeVisible()
  await expect(app.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
}

/** The room tabs in the player's workspace, docked area only, in DOM order (WP 2.5). */
export function roomTabs(app: Page | FrameLocator | Locator): Locator {
  return app.locator('.flexlayout__layout_main').getByRole('tab')
}

/** Logs in on the app's welcome page with a demo login (NFR-6). */
export async function demoLogIn(app: Page | FrameLocator, roleId: string): Promise<void> {
  await app.getByLabel('Role id').fill(roleId)
  await app.getByLabel('Password', { exact: true }).fill(`demo-${roleId}`)
  await app.getByRole('button', { name: 'Log in', exact: true }).click()
}

/**
 * Publishes PubSub items as the mock's admin, through the page's mock host, with fixed contents
 * so the images repeat (DOC-20). Call once the app has loaded.
 */
export async function publishAsMockAdmin(
  page: Page,
  items: readonly { readonly node: string; readonly id: string; readonly payload: unknown }[],
): Promise<void> {
  await page.waitForFunction(() => window.wrxMock !== undefined)
  const failed = await page.evaluate(async (items) => {
    const host = window.wrxMock
    if (host === undefined) return 'no mock host'
    const login = await host.connect({
      endpoint: { websocketUrl: '', domain: 'wrx.mock' },
      credentials: { kind: 'password', username: 'admin', password: 'demo-admin' },
      resource: 'shots-admin',
    })
    if (!login.ok) return login.error.condition
    for (const item of items) {
      const done = await login.value.pubsub.publish(
        item.node,
        item.id,
        JSON.stringify(item.payload),
      )
      if (!done.ok) return `${item.node}: ${done.error.condition}`
    }
    await login.value.disconnect()
    return undefined
  }, items)
  expect(failed).toBeUndefined()
}
