// The multi-client view and the mock's controls (WP 2.9): the SC-7 demo with three panes, a
// message crossing them, and a second window on one shared, offline mock (PLY-16–18, PLY-22); a named preset saved and
// restored (PLY-19); two panes of one role kept apart (PLY-17); a 2x2 grid; the admin backend in
// a pane; reset, export and import of the mock database with its history (PLY-21, PLY-34); and
// the admin's preview as a role (ADM-30, ADM-31).
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { logIn } from './mock.ts'

const pane = (page: Page, n: number) => page.getByRole('region', { name: `Pane ${n}`, exact: true })
const tabsIn = (scope: Locator) => scope.locator('.flexlayout__layout_main').getByRole('tab')
const forcePanel = (scope: Locator | Page) => scope.getByRole('region', { name: 'Force panel' })
const mockStatus = (page: Page) =>
  page.getByRole('group', { name: 'Mock database' }).getByRole('status')

async function openMulti(page: Page): Promise<void> {
  await page.goto('./#/multi')
  await expect(page.getByRole('heading', { name: 'Multi-client view' })).toBeVisible()
  await expect(pane(page, 1).getByLabel('Backend: MOCK')).toBeVisible()
}

async function quickLogIn(scope: Locator, label: string): Promise<void> {
  await scope.getByRole('button', { name: `Log in as ${label}`, exact: true }).click()
}

async function editObjectives(page: Page, scope: Locator, force: string, text: string) {
  await forcePanel(scope).getByLabel('Show objectives for').selectOption({ label: force })
  await forcePanel(scope)
    .getByRole('button', { name: `Edit ${force} objectives` })
    .click()
  const dialog = page.getByRole('dialog', { name: `Edit ${force} objectives` })
  await dialog.getByRole('textbox', { name: 'Objectives (Markdown)' }).fill(text)
  await dialog.getByRole('button', { name: 'Publish objectives' }).click()
  await expect(dialog).toHaveCount(0)
}

test('SC-7: three panes and a second window share one offline mock (PLY-16–18, PLY-22)', async ({
  context,
  page,
}) => {
  // Three sessions, a second window and a round of chat: longer than the default on a busy runner.
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1800, height: 900 })
  await openMulti(page)
  const second = await context.newPage()
  await second.goto('./')
  await expect(second.getByLabel('Backend: MOCK')).toBeVisible()
  // From here on, no network: the mock runs in this browser (NFR-7, D14).
  await context.setOffline(true)

  // Three panes side by side by default.
  await expect(page.getByRole('radio', { name: '3' })).toBeChecked()
  await expect(page.getByRole('region', { name: /^Pane \d$/ })).toHaveCount(3)
  const boxes = await Promise.all([1, 2, 3].map((n) => pane(page, n).boundingBox()))
  expect(boxes.every((b) => b !== null && Math.abs(b.y - (boxes[0]?.y ?? 0)) < 1)).toBe(true)

  await quickLogIn(pane(page, 1), 'Blue CO (Blue)')
  await quickLogIn(pane(page, 2), 'Red CO (Red)')
  await quickLogIn(pane(page, 3), 'Umpire (White, admin)')
  // Each pane's header: role, force colour and backend (PLY-18).
  await expect(pane(page, 1).getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  await expect(pane(page, 2).getByLabel('Logged in as Red CO, Red')).toBeVisible()
  await expect(pane(page, 3).getByLabel('Logged in as Umpire, White')).toBeVisible()
  await expect(pane(page, 2).locator('.wrx-shell__swatch')).toHaveCSS(
    'background-color',
    'rgb(185, 28, 28)',
  )
  for (const n of [1, 2, 3]) await expect(pane(page, n).getByLabel('Backend: MOCK')).toBeVisible()
  // Each pane its own session, rooms and layout (PLY-17).
  await expect(tabsIn(pane(page, 1))).toHaveText(['Blue HQ', 'Blue–Red negotiation'])
  await expect(tabsIn(pane(page, 2))).toHaveText(['Red HQ', 'Blue–Red negotiation'])
  await expect(tabsIn(pane(page, 3))).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation'])

  // The umpire's change (the admin login, SC-5) reaches Red's pane live.
  await editObjectives(page, pane(page, 3), 'Red', '1. Delay Blue until noon.')
  await expect(forcePanel(pane(page, 2))).toContainText('Delay Blue until noon.')
  await expect(forcePanel(pane(page, 1))).toContainText('Secure the crossing.')

  // A message Blue sends in the shared room arrives in Red's and the umpire's panes (SC-7).
  const talks = 'Blue–Red negotiation'
  for (const n of [1, 2, 3]) {
    await tabsIn(pane(page, n)).filter({ hasText: talks }).click()
  }
  const box = pane(page, 1).getByRole('textbox', { name: `Message ${talks}`, exact: true })
  // In a narrow pane the field keeps a usable width, with Send below it rather than squeezing it.
  expect((await box.boundingBox())?.width ?? 0).toBeGreaterThan(150)
  await box.fill('Blue proposes a ceasefire at 10:00.')
  await box.press('Enter')
  for (const n of [2, 3]) {
    await expect(
      pane(page, n).getByRole('region', { name: `Messages in ${talks}`, exact: true }),
    ).toContainText('Blue proposes a ceasefire at 10:00.')
  }

  // The second window, as a fourth role, shares the game (PLY-22).
  await logIn(second, 'blue-observer', 'demo-blue-observer')
  await expect(second.getByLabel('Logged in as Blue Observer, Blue')).toBeVisible()
  await editObjectives(page, pane(page, 3), 'Blue', '1. Hold the crossing.')
  await expect(forcePanel(second)).toContainText('Hold the crossing.')
  await expect(forcePanel(pane(page, 1))).toContainText('Hold the crossing.')

  // After the demo: reset to the seed. Every pane and tab reconnects to it (PLY-21, PLY-2).
  await page.getByRole('button', { name: 'Reset to seed…' }).click()
  await page
    .getByRole('dialog', { name: 'Reset the mock to its seed?' })
    .getByRole('button', { name: 'Reset' })
    .click()
  await expect(mockStatus(page).filter({ hasText: 'back at its seed' })).toBeVisible()
  await expect(forcePanel(pane(page, 1))).toContainText('Secure the crossing.')
  await expect(forcePanel(pane(page, 2))).toContainText('Delay Blue.')
  await expect(forcePanel(second)).toContainText('Secure the crossing.')
})

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
  await expect(tabsIn(pane(page, 1))).toHaveCount(2)
  await expect(tabsIn(pane(page, 2))).toHaveCount(2)
  // Logging one out leaves the other signed in (D22: one resource per pane).
  await pane(page, 1).getByRole('button', { name: 'Log out' }).click()
  await expect(pane(page, 1).getByText('Not logged in')).toBeVisible()
  await expect(pane(page, 2).getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  await expect(tabsIn(pane(page, 2))).toHaveCount(2)

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
  await expect(forcePanel(pane(page, 2))).toContainText('Something new.')

  await page.getByLabel('Mock database file to import').setInputFiles(file)
  await page
    .getByRole('dialog', { name: 'Import this database?' })
    .getByRole('button', { name: 'Import' })
    .click()
  await expect(mockStatus(page).filter({ hasText: 'Imported.' })).toBeVisible()
  await expect(forcePanel(pane(page, 2))).toContainText('Delay Blue.')
  await expect(forcePanel(pane(page, 2))).not.toContainText('Something new.')

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
  await expect(tabs).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation'])
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
  await expect(tabs).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation'])
  await expect(notice).toHaveCount(0)
})
