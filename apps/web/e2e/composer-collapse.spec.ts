// The collapsible composer against the mock (PLY-54, product owner, Nov 2, 2026): a room's
// message entry collapses to a bar and stays collapsed after a reload, per room; a draft, typed
// text or template values, survives collapsing; Reset layout returns rooms to their defaults
// (expanded for a role that may post, collapsed for an observer); the toggle works from the
// keyboard alone; axe passes collapsed and expanded; and the multi-client view's panes collapse
// on their own.
import { expect, test } from '@playwright/test'
import { isTileNoise } from './map.ts'
import type { Locator, Page } from '@playwright/test'
import { expectNoViolations } from './a11y.ts'
import { logIn, roomTabs } from './mock.ts'
import { isBrowserNotice } from './notices.ts'
import { openMulti, pane, quickLogIn } from './multi.ts'

const BLUE = 'Blue HQ'
const TALKS = 'Blue–Red negotiation'
const REPORTS = 'Blue Reports'

const panel = (scope: Page | Locator, room: string) =>
  scope.getByRole('region', { name: room, exact: true })
const messages = (scope: Page | Locator, room: string) =>
  scope.getByRole('region', { name: `Messages in ${room}`, exact: true })
const composer = (scope: Page | Locator, room: string) =>
  scope.getByRole('textbox', { name: `Message ${room}`, exact: true })
/** The room's collapse toggle, whatever it says now. */
const toggle = (scope: Page | Locator, room: string) =>
  panel(scope, room).locator('button[aria-controls]')

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !isTileNoise(m)) errors.push(m.text())
  })
  page.on('pageerror', (e) => {
    if (!isBrowserNotice(e.message)) errors.push(e.message)
  })
  return errors
}

async function open(page: Page, roleId: string): Promise<string[]> {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await logIn(page, roleId, `demo-${roleId}`)
  await expect(roomTabs(page).first()).toBeVisible()
  return errors
}

/**
 * Blue CO has four rooms, the map room included, in three columns, so the negotiation starts
 * behind Blue HQ: moved to the next column with the keyboard and put on show, so both are open.
 */
async function talksBeside(page: Page, scope: Page | Locator = page): Promise<void> {
  await scope.getByRole('tab', { name: TALKS, exact: true }).focus()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(scope.getByRole('tab', { name: TALKS, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(composer(scope, TALKS)).toBeVisible()
}

/** Let the page settle for axe: fonts, the first history page, the rows measured. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect(page.locator('[role="feed"][aria-busy="true"]')).toHaveCount(0)
}

async function height(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('not visible')
  return box.height
}

test('a collapsed room stays collapsed after a reload; the list takes the space (PLY-54, PLY-5)', async ({
  page,
}) => {
  const errors = await open(page, 'blue-co')
  await talksBeside(page)
  await expect(toggle(page, BLUE)).toHaveText('Hide message entry')
  await expect(toggle(page, BLUE)).toHaveAttribute('aria-expanded', 'true')
  const before = await height(messages(page, BLUE))

  await toggle(page, BLUE).click()
  await expect(toggle(page, BLUE)).toHaveText('Write a message')
  await expect(toggle(page, BLUE)).toHaveAttribute('aria-expanded', 'false')
  await expect(composer(page, BLUE)).toBeHidden()
  await expect.poll(() => height(messages(page, BLUE))).toBeGreaterThan(before + 20)
  // Only this room: the others keep their composer.
  await expect(composer(page, TALKS)).toBeVisible()

  await page.reload()
  await logIn(page, 'blue-co', 'demo-blue-co')
  await expect(toggle(page, BLUE)).toHaveText('Write a message')
  await expect(composer(page, BLUE)).toBeHidden()
  await expect(composer(page, TALKS)).toBeVisible()

  // Reset layout returns every room to its default.
  await page.getByRole('button', { name: 'Reset layout' }).click()
  await expect(composer(page, BLUE)).toBeVisible()
  await page.reload()
  await logIn(page, 'blue-co', 'demo-blue-co')
  await expect(composer(page, BLUE)).toBeVisible()
  expect(errors).toEqual([])
})

test('a draft survives collapsing, typed text and template values alike (PLY-54)', async ({
  page,
}) => {
  const errors = await open(page, 'blue-co')
  await composer(page, BLUE).fill('Half an order')
  await toggle(page, BLUE).click()
  await expect(panel(page, BLUE).getByText('Draft not sent')).toBeVisible()
  await toggle(page, BLUE).click()
  await expect(composer(page, BLUE)).toHaveValue('Half an order')
  await expect(panel(page, BLUE).getByText('Draft not sent')).toHaveCount(0)

  // A templated room: the chosen type and the form's values are kept.
  await page.getByRole('tab', { name: REPORTS, exact: true }).click()
  const reports = panel(page, REPORTS)
  await reports.getByRole('combobox', { name: 'Message type' }).selectOption({
    label: 'Contact report',
  })
  await reports.getByLabel('Grid reference').fill('NV1234')
  await toggle(page, REPORTS).click()
  await expect(reports.getByRole('combobox', { name: 'Message type' })).toBeHidden()
  await expect(reports.getByText('Draft not sent')).toBeVisible()
  await toggle(page, REPORTS).click()
  await expect(reports.getByRole('combobox', { name: 'Message type' })).toHaveValue(/.+/)
  await expect(reports.getByLabel('Grid reference')).toHaveValue('NV1234')
  expect(errors).toEqual([])
})

test.describe('keyboard only', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'Tab skips buttons and links in WebKit')

  test('collapse and expand from the keyboard, then type; focus stays on the toggle (PLY-54, NFR-14)', async ({
    page,
  }) => {
    await open(page, 'blue-co')
    const button = toggle(page, BLUE)
    // From the room's message list, Tab reaches the toggle, which sits between the list and the
    // composer.
    await messages(page, BLUE).focus()
    let reached = false
    for (let i = 0; i < 10 && !reached; i++) {
      await page.keyboard.press('Tab')
      reached = await button.evaluate((el) => el === document.activeElement)
    }
    expect(reached).toBe(true)
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toBeFocused()
    await expect(composer(page, BLUE)).toBeHidden()
    // Collapsed, Tab leaves the room: nothing hidden takes focus.
    await page.keyboard.press('Tab')
    await expect(button).not.toBeFocused()
    expect(await page.evaluate(() => document.activeElement?.closest('[hidden]') === null)).toBe(
      true,
    )
    await page.keyboard.press('Shift+Tab')
    await expect(button).toBeFocused()
    await page.keyboard.press('Space')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(button).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(composer(page, BLUE)).toBeFocused()
    await page.keyboard.type('Typed after expanding.')
    await page.keyboard.press('Enter')
    await expect(messages(page, BLUE)).toContainText('Typed after expanding.')
  })
})

test('axe passes with the composer expanded and collapsed, and an observer starts collapsed (PLY-54, NFR-14)', async ({
  page,
}, testInfo) => {
  const errors = await open(page, 'blue-co')
  await talksBeside(page)
  await settled(page)
  await composer(page, BLUE).fill('A draft')
  await expectNoViolations(page, testInfo, 'composer expanded')
  await toggle(page, BLUE).click()
  await toggle(page, TALKS).click()
  await expect(panel(page, BLUE).getByText('Draft not sent')).toBeVisible()
  await expectNoViolations(page, testInfo, 'composer collapsed, with a draft')

  // An observer: collapsed by default, and expanding it says why it cannot post.
  await page.getByRole('button', { name: 'Log out' }).click()
  await logIn(page, 'blue-observer', 'demo-blue-observer')
  await expect(toggle(page, BLUE)).toHaveText('Show message entry')
  await expect(composer(page, BLUE)).toBeHidden()
  await settled(page)
  await expectNoViolations(page, testInfo, 'observer, collapsed')
  await toggle(page, BLUE).click()
  await expect(panel(page, BLUE)).toContainText(
    'You are observing this game: you can read this room but not post in it.',
  )
  await expect(composer(page, BLUE)).toBeDisabled()
  await expectNoViolations(page, testInfo, 'observer, expanded')
  expect(errors).toEqual([])
})

test('each multi-client pane collapses its own rooms (PLY-54, PLY-17)', async ({ page }) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openMulti(page)
  await page.getByRole('radio', { name: '2' }).check()
  const blue = pane(page, 1)
  const red = pane(page, 2)
  await quickLogIn(blue, 'Blue CO (Blue)')
  await quickLogIn(red, 'Red CO (Red)')
  await talksBeside(page, blue)
  await expect(composer(blue, TALKS)).toBeVisible()
  await expect(composer(red, TALKS)).toBeVisible()
  await composer(blue, TALKS).fill('Pane draft')
  await toggle(blue, TALKS).click()
  await expect(composer(blue, TALKS)).toBeHidden()
  await expect(composer(red, TALKS)).toBeVisible()
  await toggle(blue, TALKS).click()
  await expect(composer(blue, TALKS)).toHaveValue('Pane draft')
  expect(errors).toEqual([])
})

test('a popped-out room collapses in its window, and keeps it after a reload docks it (PLY-54)', async ({
  page,
}) => {
  const errors = await open(page, 'blue-co')
  await talksBeside(page)
  await composer(page, TALKS).fill('Written before the popout')
  const popup = page.waitForEvent('popup')
  await page
    .locator('.flexlayout__tabset', { has: page.getByRole('tab', { name: TALKS, exact: true }) })
    .getByRole('button', { name: 'Popout selected tab' })
    .click()
  const popout = await popup
  popout.on('console', (m) => {
    if (m.type() === 'error' && !isTileNoise(m)) errors.push(`popout: ${m.text()}`)
  })
  // The same panel, moved: its draft came with it.
  await expect(composer(popout, TALKS)).toHaveValue('Written before the popout')
  await toggle(popout, TALKS).click()
  await expect(composer(popout, TALKS)).toBeHidden()
  await expect(panel(popout, TALKS).getByText('Draft not sent')).toBeVisible()
  // A reload while it is popped out docks it again, still collapsed (popouts are not saved).
  await page.reload()
  await logIn(page, 'blue-co', 'demo-blue-co')
  await page.getByRole('tab', { name: TALKS, exact: true }).click()
  await expect(toggle(page, TALKS)).toHaveText('Write a message')
  expect(errors).toEqual([])
})
