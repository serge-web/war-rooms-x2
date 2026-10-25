// UI scenarios (DOC-20): the app as first opened, on the mock. player.spec.ts has the player.
import { test } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'
import { hostMockInLeaderTab, welcomeLoaded } from './mock-app.ts'

test('app shell on the mock backend', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await shoot(page, 'app-shell')
})
