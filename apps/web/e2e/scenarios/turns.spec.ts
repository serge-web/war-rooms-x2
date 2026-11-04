// Turns on both backends (WP 5.4; not a user scenario, SC-11 is WP 5.7's): the umpire moves the
// game from turn 1 planning to adjudication from the turn panel, behind a confirmation (ADM-43).
// Blue CO's turn panel follows live (PLY-55), in the column and in the narrow-window tab
// (PLY-36), and its composers are disabled with an explanation, its draft kept (PLY-56); White
// Cell, in the White Force, still posts. Then the admin backend's header control starts turn 2,
// and Blue's draft goes. On ejabberd it crosses the real server; on the mock, the shared
// in-browser one. Accessibility (axe) on the turn panel and the disabled composer.
import type { Page } from '@playwright/test'
import { expectNoViolations } from '../a11y.ts'
import { columnTab } from '../mock.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const WIDE = { width: 1400, height: 900 }
const NARROW = { width: 640, height: 900 }
const BLUE_HQ = 'Blue HQ'

const column = (page: Page) => page.getByRole('complementary', { name: 'Out-of-game column' })
const turnPanel = (page: Page) => column(page).getByRole('region', { name: 'Turn', exact: true })
const turnStatus = (page: Page) => turnPanel(page).getByRole('status')
const box = (page: Page) => page.getByRole('textbox', { name: `Message ${BLUE_HQ}`, exact: true })
const hq = (page: Page) => page.getByRole('region', { name: BLUE_HQ, exact: true })
const messages = (page: Page) =>
  page.getByRole('region', { name: `Messages in ${BLUE_HQ}`, exact: true })

const PAUSED = /The game is in adjudication, so posting is paused for your role/

test('the umpire starts adjudication; Blue’s composer pauses with its draft kept, White Cell posts; turn 2 resumes (ADM-43, PLY-55, PLY-56)', async ({
  context,
  backend,
}, testInfo) => {
  test.setTimeout(120_000)
  const blue = await context.newPage()
  await blue.setViewportSize(WIDE)
  const blueErrors = watchErrors(blue)
  await openApp(blue, backend)
  await logInAs(blue, backend, 'blue-co')
  await expect(turnStatus(blue)).toHaveText('Turn 1, Planning', { timeout: 20_000 })
  // Players are offered no control (ADM-43).
  await expect(turnPanel(blue).getByRole('button')).toHaveCount(0)
  await blue.getByRole('tab', { name: BLUE_HQ, exact: true }).click()
  await box(blue).fill('Cross at dawn.')

  const cell = await context.newPage()
  await cell.setViewportSize(WIDE)
  const cellErrors = watchErrors(cell)
  await openApp(cell, backend)
  await logInAs(cell, backend, 'white-cell')
  await expect(turnStatus(cell)).toHaveText('Turn 1, Planning', { timeout: 20_000 })

  // 1. The umpire starts adjudication, confirming first.
  const umpire = await context.newPage()
  await umpire.setViewportSize(WIDE)
  const umpireErrors = watchErrors(umpire)
  await openApp(umpire, backend)
  await logInAs(umpire, backend, 'admin')
  await expect(turnStatus(umpire)).toHaveText('Turn 1, Planning', { timeout: 20_000 })
  await turnPanel(umpire).getByRole('button', { name: 'Start adjudication…' }).click()
  const confirm = umpire.getByRole('dialog', { name: 'Start adjudication?' })
  await expect(confirm).toContainText('roles outside the White Force can no longer post')
  await confirm.getByRole('button', { name: 'Start adjudication', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(turnStatus(umpire)).toHaveText('Turn 1, Adjudication')
  await expect(turnPanel(umpire).getByRole('button', { name: 'Start turn 2…' })).toBeVisible()

  // 2. Blue's panel follows live; its composer is disabled with why, the draft kept.
  await expect(turnStatus(blue)).toHaveText('Turn 1, Adjudication')
  await expect(turnPanel(blue)).toContainText('The umpires are adjudicating.')
  await expect(hq(blue).getByText(PAUSED)).toBeVisible()
  await expect(box(blue)).toHaveValue('Cross at dawn.')
  await expect(box(blue)).toHaveAttribute('readonly', '')
  await expect(hq(blue).getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expectNoViolations(blue, testInfo, 'turn panel in adjudication', {
    include: '[aria-label="Out-of-game column"] .wrx-turn',
  })
  await expectNoViolations(blue, testInfo, 'composer paused for adjudication', {
    include: '.wrx-chat__entry',
  })
  // Collapsed, the bar says so (PLY-54).
  await hq(blue).getByRole('button', { name: 'Hide message entry' }).click()
  await expect(hq(blue).locator('.wrx-chat__entry-note')).toHaveText(
    'Draft not sent. Posting paused for adjudication',
  )
  await hq(blue).getByRole('button', { name: 'Write a message' }).click()

  // 3. White Cell, in the White Force, keeps posting; Blue reads it.
  await expect(turnStatus(cell)).toHaveText('Turn 1, Adjudication')
  await expect(turnPanel(cell)).toContainText('Roles outside the White Force cannot post')
  await cell.getByRole('tab', { name: BLUE_HQ, exact: true }).click()
  await box(cell).fill('Ruling: the bridge holds.')
  await box(cell).press('Enter')
  await expect(box(cell)).toHaveValue('')
  await expect(messages(blue)).toContainText('Ruling: the bridge holds.')

  // 4. Narrow, the turn panel is in the out-of-game tab (FT-1).
  await blue.setViewportSize(NARROW)
  await columnTab(blue).click()
  const tabPanel = blue.getByRole('region', { name: 'Out of game', exact: true })
  await expect(tabPanel.getByRole('region', { name: 'Turn', exact: true })).toContainText(
    'Turn 1, Adjudication',
  )
  await blue.setViewportSize(WIDE)

  // 5. The admin backend's header control starts turn 2 (ADM-43).
  const backendPage = await context.newPage()
  await backendPage.setViewportSize(WIDE)
  const backendErrors = watchErrors(backendPage)
  await backendPage.goto('./#/admin')
  await expect(backendPage.getByLabel(backend.badge)).toBeVisible()
  await logInAs(backendPage, backend, 'admin')
  const control = backendPage.getByRole('group', { name: 'Turn', exact: true })
  await expect(control.getByRole('status')).toHaveText('Turn 1, Adjudication', {
    timeout: 20_000,
  })
  await control.getByRole('button', { name: 'Start turn 2…' }).click()
  const next = backendPage.getByRole('dialog', { name: 'Start turn 2?' })
  await next.getByRole('button', { name: 'Start turn 2', exact: true }).click()
  await expect(next).toHaveCount(0)
  await expect(control.getByRole('status')).toHaveText('Turn 2, Planning')

  // 6. Every role sees turn 2 planning; Blue's draft is there and goes.
  await expect(turnStatus(umpire)).toHaveText('Turn 2, Planning')
  await expect(turnStatus(blue)).toHaveText('Turn 2, Planning')
  await expect(hq(blue).getByText(PAUSED)).toHaveCount(0)
  await expect(box(blue)).toHaveValue('Cross at dawn.')
  await box(blue).press('Enter')
  await expect(box(blue)).toHaveValue('')
  await expect(messages(cell)).toContainText('Cross at dawn.')

  expect(blueErrors).toEqual([])
  expect(cellErrors).toEqual([])
  expect(umpireErrors).toEqual([])
  expect(backendErrors).toEqual([])
})
