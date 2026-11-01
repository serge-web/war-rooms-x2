// SC-5 Umpire monitors the game (SRD §12). Traces to: PLY-15, PLY-25, PLY-35, D8, D21, §3 rule 14.
//
// The admin logs in to the game view as the umpire (the White Force, WP 2.11) and sees every
// room; places Red HQ and the negotiation side by side; posts a clarification in Red HQ that Red
// sees from the umpire; and amends Red's objectives, which Red's force panel shows live. Moved
// here from column.spec.ts, with step 2 added. Both backends.
import type { Page } from '@playwright/test'
import { columns, drag } from '../layout.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const forcePanel = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Out-of-game column' })
    .getByRole('region', { name: 'Force panel' })
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const RED_HQ = 'Red HQ'
const TALKS = 'Blue–Red negotiation'

test('SC-5: the admin, as umpire, sees every room, watches two side by side, posts as the umpire and amends Red’s objectives live (PLY-15, PLY-25, PLY-35)', async ({
  context,
  backend,
}) => {
  test.setTimeout(90_000)
  const red = await context.newPage()
  const redErrors = watchErrors(red)
  await openApp(red, backend)
  await logInAs(red, backend, 'red-co')
  const redObjectives = forcePanel(red).getByRole('region', { name: 'Objectives' })
  await expect(redObjectives).toContainText('Delay Blue.', { timeout: 20_000 })

  // 1. The admin login is the umpire, in the White Force, and sees every room.
  const umpire = await context.newPage()
  const umpireErrors = watchErrors(umpire)
  await umpire.setViewportSize({ width: 1400, height: 900 })
  await openApp(umpire, backend)
  await logInAs(umpire, backend, 'admin')
  await expect(umpire.getByLabel('Logged in as Umpire, White')).toBeVisible({ timeout: 20_000 })
  await expect(umpire.locator('.flexlayout__layout_main').getByRole('tab')).toHaveText([
    'Blue HQ',
    RED_HQ,
    TALKS,
    'Blue Reports',
  ])
  await expect(forcePanel(umpire).getByRole('heading', { name: 'Umpire' })).toBeVisible()

  // 2. Red HQ and the negotiation side by side: Blue HQ goes behind the negotiation's tab.
  await drag(umpire, tab(umpire, 'Blue HQ'), panel(umpire, TALKS))
  await expect.poll(() => columns(umpire)).toEqual([[RED_HQ], [TALKS, 'Blue HQ'], ['Blue Reports']])
  await tab(umpire, TALKS).click()
  const left = await panel(umpire, RED_HQ).boundingBox()
  const right = await panel(umpire, TALKS).boundingBox()
  expect(left !== null && right !== null).toBe(true)
  expect(Math.abs((left?.y ?? 0) - (right?.y ?? 1))).toBeLessThan(2)
  expect((left?.x ?? 0) + (left?.width ?? 0)).toBeLessThanOrEqual((right?.x ?? 0) + 1)
  for (const name of [RED_HQ, TALKS]) {
    await expect(
      umpire.getByRole('region', { name: `Messages in ${name}`, exact: true }),
    ).toBeVisible()
  }

  // 3. A clarification in Red HQ, which Red sees from the umpire, in White.
  const box = umpire.getByRole('textbox', { name: `Message ${RED_HQ}`, exact: true })
  await box.fill('Clarification: the bridge is passable on foot only.')
  await box.press('Enter')
  await expect(box).toHaveValue('')
  const redHq = red.getByRole('region', { name: `Messages in ${RED_HQ}`, exact: true })
  const card = redHq.getByRole('article').filter({ hasText: 'passable on foot only' })
  await expect(card).toHaveAttribute('aria-label', /(^|, )Umpire, /)
  await expect(card).toHaveAttribute('data-sender', 'admin')
  // Its header (on it, or on the umpire's earlier message it follows) names the White Force.
  await expect(redHq.locator('article[data-sender="admin"] .wrx-chat__force').last()).toHaveText(
    'White',
  )

  // 4. Red's objectives, amended with a preview; Red's force panel updates live.
  await forcePanel(umpire).getByLabel('Show objectives for').selectOption({ label: 'Red' })
  await expect(forcePanel(umpire).getByRole('region', { name: 'Red objectives' })).toContainText(
    'Delay Blue.',
  )
  await forcePanel(umpire).getByRole('button', { name: 'Edit Red objectives' }).click()
  const dialog = umpire.getByRole('dialog', { name: 'Edit Red objectives' })
  await dialog
    .getByRole('textbox', { name: 'Objectives (Markdown)' })
    .fill('1. Delay Blue.\n2. **Hold** the east bank until noon.')
  await expect(
    dialog.getByRole('region', { name: 'Objectives preview' }).locator('strong'),
  ).toHaveText('Hold')
  await dialog.getByRole('button', { name: 'Publish objectives' }).click()
  await expect(dialog).toHaveCount(0)

  // Live on Red's page, with no reload (PLY-28).
  await expect(redObjectives).toContainText('Hold the east bank until noon.')
  await expect(redObjectives.locator('strong')).toHaveText('Hold')
  await expect(forcePanel(umpire).getByRole('region', { name: 'Red objectives' })).toContainText(
    'Hold the east bank until noon.',
  )
  expect(redErrors).toEqual([])
  expect(umpireErrors).toEqual([])
})
