// UI scenarios (DOC-20). Until the mock (WP 1.4) has seeds, the app shell is the only UI.
import { expect, test } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'

test('app shell on the mock backend', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await page.goto('./app/')
  await expect(page.getByLabel('Backend: MOCK')).toBeVisible()
  await shoot(page, 'app-shell')
})
