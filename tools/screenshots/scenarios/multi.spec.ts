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
    // Three panes on this screen are narrow: each pane's out-of-game column is a tab (FT-1).
    await expect(pane.getByRole('tab', { name: 'Out of game', exact: true })).toBeVisible()
  }
  const umpire = page.getByRole('region', { name: 'Pane 3', exact: true })
  await expect(roomTabs(umpire)).toHaveCount(6)
  await page.mouse.move(0, 0)
  await shoot(page, 'multi-client-view')

  // FT-1: Blue's pane with its out-of-game tab open.
  const blue = page.getByRole('region', { name: 'Pane 1', exact: true })
  await blue.getByRole('tab', { name: 'Out of game', exact: true }).click()
  const column = blue.getByRole('region', { name: 'Out of game', exact: true })
  await expect(column.getByRole('region', { name: 'Objectives' })).toContainText('crossing')
  await page.mouse.move(0, 0)
  await shoot(page, 'multi-client-column-tab')
})

test('multi-client view, two panes with the column', { tag: '@screenshot' }, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/#/multi')
  await expect(page.getByRole('heading', { name: 'Multi-client view' })).toBeVisible()
  await page.getByRole('radio', { name: '2' }).check()
  for (const [n, label] of [
    [1, 'Blue CO (Blue)'],
    [2, 'Red CO (Red)'],
  ] as const) {
    const pane = page.getByRole('region', { name: `Pane ${n}`, exact: true })
    await pane.getByRole('button', { name: `Log in as ${label}`, exact: true }).click()
    // Wide enough panes keep the fixed column (FT-1).
    await expect(
      pane
        .getByRole('complementary', { name: 'Out-of-game column' })
        .getByRole('region', { name: 'Force panel' }),
    ).toBeVisible()
  }
  await page.mouse.move(0, 0)
  await shoot(page, 'multi-client-two-panes')
})

test('admin game view, previewing a role', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await demoLogIn(page, 'admin')
  await page.getByLabel('View as').selectOption({ label: 'Blue CO (Blue)' })
  await expect(roomTabs(page)).toHaveText([
    'Blue HQ',
    'Blue–Red negotiation',
    'Blue Reports',
    'Map',
  ])
  await expect(page.getByRole('region', { name: 'Force panel' })).toContainText('crossing')
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-preview-as-role')
})
