// The multi-client view on the mock (WP 2.9, DOC-20): the SC-7 demo with Blue, Red and the
// umpire (the admin login) in three panes, and the admin's game view previewing a role (ADM-30). Nothing is posted,
// so every run renders the same.
import { expect, test } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'
import { demoLogIn, hostMockInLeaderTab, roomTabs, welcomeLoaded } from './mock-app.ts'

test('multi-client view, three panes', { tag: '@screenshot' }, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/#/multi')
  await expect(page.getByRole('heading', { name: 'Multi-client view' })).toBeVisible()
  for (const [n, label, header] of [
    [1, 'Blue CO (Blue)', 'Blue CO, Blue'],
    [2, 'Red CO (Red)', 'Red CO, Red'],
    [3, 'Umpire (White, admin)', 'Umpire, White'],
  ] as const) {
    const pane = page.getByRole('region', { name: `Pane ${n}`, exact: true })
    await pane.getByRole('button', { name: `Log in as ${label}`, exact: true }).click()
    await expect(pane.getByLabel(`Logged in as ${header}`)).toBeVisible()
    await expect(pane.getByRole('region', { name: 'Force panel' })).toBeVisible()
  }
  const umpire = page.getByRole('region', { name: 'Pane 3', exact: true })
  await expect(roomTabs(umpire)).toHaveCount(3)
  await page.mouse.move(0, 0)
  await shoot(page, 'multi-client-view')
})

test('admin game view, previewing a role', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await demoLogIn(page, 'admin')
  await page.getByLabel('View as').selectOption({ label: 'Blue CO (Blue)' })
  await expect(roomTabs(page)).toHaveText(['Blue HQ', 'Blue–Red negotiation'])
  await expect(page.getByRole('region', { name: 'Force panel' })).toContainText('crossing')
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-preview-as-role')
})
