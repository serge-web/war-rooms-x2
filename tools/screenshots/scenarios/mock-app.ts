// Helpers for scenarios that show the app on the mock (WP 2.4, DOC-20).
import { expect } from '@playwright/test'
import type { FrameLocator, Page } from '@playwright/test'

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
