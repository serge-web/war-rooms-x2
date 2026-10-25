// The player client on the mock (WP 2.4, DOC-20): the welcome page with the demo game, and the
// shell after logging in as Blue CO with its demo password (NFR-6).
import { expect, test } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'
import { hostMockInLeaderTab, welcomeLoaded } from './mock-app.ts'

test('player welcome page', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await expect(page.getByRole('region', { name: 'Briefing' })).toContainText('09:00')
  await expect(page.getByRole('img', { name: 'Exercise Northern Gate logo' })).toBeVisible()
  await shoot(page, 'player-welcome')
})

test('player shell, logged in', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Role id').fill('blue-co')
  await page.getByLabel('Password', { exact: true }).fill('demo-blue-co')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  const rooms = page.getByRole('region', { name: 'Your rooms' }).getByRole('listitem')
  await expect(rooms).toHaveText(['Blue HQ', 'Blue–Red negotiation'])
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  await shoot(page, 'player-shell')
})
