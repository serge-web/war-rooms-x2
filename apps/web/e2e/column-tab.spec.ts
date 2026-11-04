// FT-1: in a narrow client the out-of-game column becomes a workspace tab, styled as special,
// that cannot be closed and is never saved with the layout; wider, the fixed column returns. The
// switch keeps the column's state, and announcements that arrive while the tab is hidden show an
// unread badge on it. Width is the client's own, so multi-client panes switch on theirs.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { FORCE } from '@wrx/schemas/fixtures'
import { columnTab, logIn, roomTabs } from './mock.ts'

const WIDE = { width: 1400, height: 900 }
const NARROW = { width: 640, height: 900 }

const column = (scope: Page | Locator) =>
  scope.getByRole('complementary', { name: 'Out-of-game column' })
const columnRegion = (scope: Page | Locator) =>
  scope.getByRole('region', { name: 'Out of game', exact: true })
const pane = (page: Page, n: number) => page.getByRole('region', { name: `Pane ${n}`, exact: true })

async function player(page: Page, roleId: string, size = WIDE): Promise<void> {
  await page.setViewportSize(size)
  await page.goto('./')
  await logIn(page, roleId, `demo-${roleId}`)
  await expect(roomTabs(page).first()).toBeVisible()
}

/** The saved layouts in this page's storage, as text. */
async function savedLayouts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.includes('layout:'))
      .map((key) => localStorage.getItem(key) ?? ''),
  )
}

test('narrow, the column is a special tab that cannot be closed; wide, the column returns (FT-1, PLY-36)', async ({
  page,
}) => {
  await player(page, 'blue-co')
  await expect(column(page)).toBeVisible()
  await expect(columnTab(page)).toHaveCount(0)
  const rooms = ['Blue HQ', 'Blue–Red negotiation', 'Blue Reports', 'Map']
  await expect(roomTabs(page)).toHaveText(rooms)

  await page.setViewportSize(NARROW)
  const tab = columnTab(page)
  await expect(tab).toBeVisible()
  await expect(column(page)).toHaveCount(0)
  // Marked as special (its class carries the accent bar), with an icon, and no close button.
  await expect(tab).toHaveClass(/wrx-tab-special/)
  await expect(tab.locator('.wrx-tab__icon svg')).toBeVisible()
  await expect(tab.getByRole('button', { name: /close/i })).toHaveCount(0)
  await expect(page.locator('.wrx-tab-special .flexlayout__tab_button_trailing')).toHaveCount(0)
  await expect(page.locator('.flexlayout__border_bottom .wrx-tab-special')).toHaveCount(1)
  // Added without selecting it, so the room tabs are as they were.
  await expect(roomTabs(page)).toHaveText(rooms)
  await expect(columnRegion(page)).toBeHidden()
  await tab.click()
  const region = columnRegion(page)
  await expect(region.getByRole('region', { name: 'Force panel' })).toContainText(
    'Secure the crossing.',
  )
  await expect(region.getByRole('region', { name: 'Announcements' })).toContainText('None yet')
  // Not inside the workspace's saved layout.
  const saved = await savedLayouts(page)
  expect(saved.length).toBeGreaterThan(0)
  for (const text of saved) expect(text).not.toContain('special:')

  await page.setViewportSize(WIDE)
  await expect(column(page).getByRole('region', { name: 'Force panel' })).toContainText(
    'Secure the crossing.',
  )
  await expect(columnTab(page)).toHaveCount(0)
  await expect(roomTabs(page)).toHaveText(rooms)
  // Back and forth leaves a usable layout: the rooms' tabs still open their rooms.
  await page.setViewportSize(NARROW)
  await expect(columnTab(page)).toBeVisible()
  await page.reload()
  await logIn(page, 'blue-co', 'demo-blue-co')
  await expect(roomTabs(page)).toHaveText(rooms)
  await expect(columnTab(page)).toBeVisible()
  await roomTabs(page).first().click()
  await expect(page.getByRole('region', { name: 'Messages in Blue HQ', exact: true })).toBeVisible()
})

test('the column keeps its state when it becomes a tab and back (FT-1)', async ({ page }) => {
  await player(page, 'admin')
  const panel = column(page).getByRole('region', { name: 'Force panel' })
  await panel.getByLabel('Show objectives for').selectOption({ label: 'Red' })
  const box = column(page).getByRole('textbox', { name: 'New announcement' })
  await box.fill('Draft: break at 10:30')

  await page.setViewportSize(NARROW)
  await columnTab(page).click()
  const region = columnRegion(page)
  await expect(region.getByRole('textbox', { name: 'New announcement' })).toHaveValue(
    'Draft: break at 10:30',
  )
  await expect(region.getByLabel('Show objectives for')).toHaveValue(FORCE.red)
  await expect(region.getByRole('region', { name: 'Red objectives' })).toContainText('Delay Blue')

  await page.setViewportSize(WIDE)
  await expect(box).toHaveValue('Draft: break at 10:30')
  await expect(panel.getByLabel('Show objectives for')).toHaveValue(FORCE.red)
})

test('an announcement that arrives while the tab is hidden shows an unread badge on it (FT-1, PLY-38)', async ({
  context,
}) => {
  const blue = await context.newPage()
  await player(blue, 'blue-co', NARROW)
  const tab = columnTab(blue)
  await expect(tab).toBeVisible()
  await expect(tab.locator('.wrx-unread')).toHaveCount(0)

  const admin = await context.newPage()
  await player(admin, 'admin')
  const post = column(admin).getByRole('textbox', { name: 'New announcement' })
  await post.fill('Break until 10:30.')
  await post.press('Enter')
  await expect(post).toHaveValue('')
  await expect(tab.getByLabel('1 unread')).toBeVisible()
  await post.fill('Back in your rooms, please.')
  await post.press('Enter')
  await expect(tab.getByLabel('2 unread')).toBeVisible()

  // Opening the tab shows them and clears the badge; hiding it again does not bring it back.
  await tab.click()
  await expect(columnRegion(blue).getByRole('log').getByRole('listitem')).toHaveCount(2)
  await expect(tab.locator('.wrx-unread')).toHaveCount(0)
  // The tab sits in the strip along the bottom: a second click closes its panel.
  await tab.click()
  await expect(columnRegion(blue)).toBeHidden()
  await expect(tab.locator('.wrx-unread')).toHaveCount(0)
})

test('multi-client panes switch on their own width, not the screen’s (FT-1, PLY-16)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('./#/multi')
  await expect(page.getByRole('heading', { name: 'Multi-client view' })).toBeVisible()
  // Two panes on this screen are wide enough for the column...
  await page.getByRole('radio', { name: '2' }).check()
  for (const [n, label] of [
    [1, 'Blue CO (Blue)'],
    [2, 'Red CO (Red)'],
  ] as const) {
    await pane(page, n)
      .getByRole('button', { name: `Log in as ${label}`, exact: true })
      .click()
    await expect(roomTabs(pane(page, n)).first()).toBeVisible()
    await expect(column(pane(page, n))).toBeVisible()
    await expect(columnTab(pane(page, n))).toHaveCount(0)
  }
  // ...three on the same screen are not: each pane's column becomes its own tab.
  await page.getByRole('radio', { name: '3' }).check()
  await pane(page, 3)
    .getByRole('button', { name: 'Log in as Umpire (White, admin)', exact: true })
    .click()
  for (const n of [1, 2, 3]) {
    // Wholly in view, in the strip along the bottom, not scrolled away in a narrow tabset.
    await expect(columnTab(pane(page, n))).toBeInViewport({ ratio: 1 })
    await expect(column(pane(page, n))).toHaveCount(0)
  }
  await expect(roomTabs(pane(page, 1))).toHaveText([
    'Blue HQ',
    'Blue–Red negotiation',
    'Blue Reports',
    'Map',
  ])
  // One pane's tab opens that pane's column only.
  await columnTab(pane(page, 2)).click()
  await expect(
    columnRegion(pane(page, 2)).getByRole('region', { name: 'Force panel' }),
  ).toContainText('Delay Blue.')
  await expect(columnRegion(pane(page, 1))).toBeHidden()
  // Back to two panes: the column returns in each.
  await page.getByRole('radio', { name: '2' }).check()
  for (const n of [1, 2]) {
    await expect(column(pane(page, n))).toBeVisible()
    await expect(columnTab(pane(page, n))).toHaveCount(0)
  }
})
