// The player client on the mock (WP 2.4, 2.5, DOC-20): the welcome page with the demo game, the
// shell after logging in as Blue CO with its demo password (NFR-6), and the umpire's workspace.
import { expect, test } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'
import { hostMockInLeaderTab, roomTabs, welcomeLoaded } from './mock-app.ts'

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
  await expect(roomTabs(page)).toHaveText(['Blue HQ', 'Blue–Red negotiation'])
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  await shoot(page, 'player-shell')
})

test('player workspace, umpire', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Role id').fill('umpire-1')
  await page.getByLabel('Password', { exact: true }).fill('demo-umpire-1')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  // PLY-40: one column per room; the game info panel opened from the strip (PLY-8).
  await expect(roomTabs(page)).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation'])
  await page.getByRole('tab', { name: 'Game info', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Game briefing' })).toContainText('09:00')
  await page.mouse.move(0, 0)
  await shoot(page, 'player-workspace')
})
