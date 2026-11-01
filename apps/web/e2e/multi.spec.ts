// The multi-client view and the mock's controls (WP 2.9). The SC-7 demo itself, three panes, a
// message crossing them and a second window on one shared, offline mock, is the scenario
// scenarios/sc-7-offline-demo.spec.ts. Here: a named preset saved and restored (PLY-19); two
// panes of one role kept apart (PLY-17); a 2x2 grid; the admin backend in a pane; reset, export and import of the mock database with its history (PLY-21, PLY-34); and
// the admin's preview as a role (ADM-30, ADM-31).
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { logIn } from './mock.ts'
import {
  editObjectives,
  forcePanel,
  paneForce,
  mockStatus,
  openMulti,
  pane,
  quickLogIn,
  tabsIn,
} from './multi.ts'

test('a named preset saves and restores the pane count and logins (PLY-19)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await openMulti(page)
  await page.getByRole('radio', { name: '2' }).check()
  await expect(page.getByRole('region', { name: /^Pane \d$/ })).toHaveCount(2)
  await quickLogIn(pane(page, 1), 'Red CO (Red)')
  await quickLogIn(pane(page, 2), 'Umpire (White, admin)')
  await expect(pane(page, 2).getByLabel('Logged in as Umpire, White')).toBeVisible()
  await page.getByLabel('Preset name').fill('Red and admin')
  await page.getByRole('button', { name: 'Save preset' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved preset' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('region', { name: /^Pane \d$/ })).toHaveCount(3)
  await page.getByLabel('Saved presets').selectOption('Red and admin')
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByRole('region', { name: /^Pane \d$/ })).toHaveCount(2)
  await expect(pane(page, 1).getByLabel('Logged in as Red CO, Red')).toBeVisible()
  await expect(pane(page, 2).getByLabel('Logged in as Umpire, White')).toBeVisible()

  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByLabel('Saved presets')).toHaveCount(0)
})

test('two panes of one role are independent; four panes make a grid (PLY-16, PLY-17)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openMulti(page)
  await page.getByRole('radio', { name: '4' }).check()
  await expect(page.getByRole('radio', { name: 'Grid' })).toBeChecked()
  const boxes = await Promise.all([1, 2, 3, 4].map((n) => pane(page, n).boundingBox()))
  // Two columns, two rows.
  expect(boxes[0]?.y).toBe(boxes[1]?.y)
  expect(boxes[2]?.y).toBeGreaterThan((boxes[0]?.y ?? 0) + 100)
  expect(boxes[2]?.x).toBe(boxes[0]?.x)

  await quickLogIn(pane(page, 1), 'Blue CO (Blue)')
  await quickLogIn(pane(page, 2), 'Blue CO (Blue)')
  await expect(tabsIn(pane(page, 1))).toHaveCount(3)
  await expect(tabsIn(pane(page, 2))).toHaveCount(3)
  // Logging one out leaves the other signed in (D22: one resource per pane).
  await pane(page, 1).getByRole('button', { name: 'Log out' }).click()
  await expect(pane(page, 1).getByText('Not logged in')).toBeVisible()
  await expect(pane(page, 2).getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  await expect(tabsIn(pane(page, 2))).toHaveCount(3)

  // A pane can show the admin backend instead.
  await pane(page, 4).getByRole('button', { name: 'Show the admin backend in this pane' }).click()
  await expect(pane(page, 4).getByRole('heading', { name: 'Admin login' })).toBeVisible()
  await pane(page, 4).getByRole('button', { name: 'Show a player client' }).click()
  await expect(pane(page, 4).getByText('Not logged in')).toBeVisible()
})

test('export the mock database with its history, and import it back (PLY-21, PLY-34)', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await openMulti(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const file = testInfo.outputPath('mock.json')
  await (await download).saveAs(file)
  const exported = readFileSync(file, 'utf8')
  // The seed's message history is in the export, so it can seed the next demo (PLY-34).
  expect(exported).toContain('Orders for the crossing are out.')
  await expect(mockStatus(page).filter({ hasText: 'Exported as' })).toBeVisible()

  await quickLogIn(pane(page, 1), 'Umpire (White, admin)')
  await editObjectives(page, pane(page, 1), 'Red', '1. Something new.')
  await quickLogIn(pane(page, 2), 'Red CO (Red)')
  await expect(await paneForce(pane(page, 2))).toContainText('Something new.')

  await page.getByLabel('Mock database file to import').setInputFiles(file)
  await page
    .getByRole('dialog', { name: 'Import this database?' })
    .getByRole('button', { name: 'Import' })
    .click()
  await expect(mockStatus(page).filter({ hasText: 'Imported.' })).toBeVisible()
  await expect(await paneForce(pane(page, 2))).toContainText('Delay Blue.')
  await expect(await paneForce(pane(page, 2))).not.toContainText('Something new.')

  // A file that is not a mock database changes nothing and says why.
  await page.getByLabel('Mock database file to import').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"not":"a database"}'),
  })
  await page
    .getByRole('dialog', { name: 'Import this database?' })
    .getByRole('button', { name: 'Import' })
    .click()
  await expect(mockStatus(page).filter({ hasText: 'Not imported' })).toBeVisible()
  await expect(pane(page, 2).getByLabel('Logged in as Red CO, Red')).toBeVisible()
})

test('the admin previews the game as a role, and back (ADM-30, ADM-31)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await logIn(page, 'admin', 'demo-admin')
  const tabs = page.locator('.flexlayout__layout_main').getByRole('tab')
  await expect(tabs).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation', 'Blue Reports'])
  await expect(page.getByRole('textbox', { name: 'New announcement' })).toBeVisible()

  await page.getByLabel('View as').selectOption({ label: 'Red CO (Red)' })
  // Exactly that role's rooms and objectives, in its force's panel.
  await expect(tabs).toHaveText(['Red HQ', 'Blue–Red negotiation'])
  await expect(forcePanel(page).getByRole('heading', { name: 'Red CO' })).toBeVisible()
  await expect(forcePanel(page).getByRole('region', { name: 'Objectives' })).toContainText(
    'Delay Blue.',
  )
  await expect(forcePanel(page).getByRole('button', { name: /Edit/ })).toHaveCount(0)
  // Posting stays the admin's own, and says so.
  const notice = page.getByRole('status').filter({ hasText: 'Viewing as Red CO' })
  await expect(notice).toContainText('sent from your admin login and shown as from the Umpire')
  await expect(page.getByLabel('Logged in as Umpire, White')).toBeVisible()

  await page.getByLabel('View as').selectOption({ label: 'Umpire (you)' })
  await expect(tabs).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation', 'Blue Reports'])
  await expect(notice).toHaveCount(0)
})
