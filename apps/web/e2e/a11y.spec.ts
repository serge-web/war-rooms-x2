// Accessibility (WP 3.2, NFR-14, WCAG 2.2 AA). axe-core on every main screen in the default
// theme: welcome and login, the workspace with the chat panel and the out-of-game column (as a
// player and as the umpire), the objectives dialog, every admin section, the publish plan and its
// confirmation, the audit, and the multi-client view. Then a keyboard-only pass through the main
// tasks, the alternatives to drag and drop included, checking that focus is always visible; and
// the unread count on a room tab as screen readers get it. Findings that stay are recorded in
// plan/reviews/phase-3-accessibility.md.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoViolations } from './a11y.ts'
import { logIn, roomTabs } from './mock.ts'

const column = (page: Page) => page.getByRole('complementary', { name: 'Out-of-game column' })
const forcePanel = (page: Page) => column(page).getByRole('region', { name: 'Force panel' })
const adminNav = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' })

async function openSection(page: Page, section: string): Promise<void> {
  await adminNav(page).getByRole('button', { name: section, exact: false }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
}

/** Let the page settle: fonts, the first history page, the rows measured. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect(page.locator('[role="feed"][aria-busy="true"]')).toHaveCount(0)
}

test.describe('axe: no WCAG 2.2 A or AA violation', () => {
  test('welcome page and login, player and admin', async ({ page }, testInfo) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await settled(page)
    await expectNoViolations(page, testInfo, 'welcome and login')
    // A refused login shows its message.
    await logIn(page, 'blue-co', 'wrong')
    await expect(page.getByRole('alert')).toBeVisible()
    await expectNoViolations(page, testInfo, 'login refused')
    await page.goto('./#/admin')
    await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible()
    await expectNoViolations(page, testInfo, 'admin login')
  })

  test('the workspace, chat panel and column, as a player and as the umpire', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('./')
    await logIn(page, 'blue-co', 'demo-blue-co')
    await expect(roomTabs(page)).toHaveCount(2)
    await settled(page)
    await expectNoViolations(page, testInfo, 'workspace as Blue CO')

    await page.getByRole('button', { name: 'Log out' }).click()
    await logIn(page, 'admin', 'demo-admin')
    await expect(roomTabs(page)).toHaveCount(3)
    await settled(page)
    await expectNoViolations(page, testInfo, 'workspace as the umpire')

    await forcePanel(page).getByLabel('Show objectives for').selectOption({ label: 'Red' })
    await forcePanel(page).getByRole('button', { name: 'Edit Red objectives' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Red objectives' })
    await expect(dialog).toBeVisible()
    await expectNoViolations(page, testInfo, 'objectives dialog', { include: '[role="dialog"]' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // A read-only role: the composer is disabled with its reason.
    await page.getByRole('button', { name: 'Log out' }).click()
    await logIn(page, 'white-observer', 'demo-white-observer')
    await expect(roomTabs(page)).toHaveCount(3)
    await settled(page)
    await expectNoViolations(page, testInfo, 'workspace as the White observer')
  })

  test('every admin section, the publish plan and its confirmation, and the audit', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('./#/admin')
    await logIn(page, 'admin', 'demo-admin')
    await expect(adminNav(page)).toBeVisible()
    for (const section of ['Game', 'Forces', 'Roles', 'Rooms', 'Themes', 'Access matrix']) {
      await openSection(page, section)
      await settled(page)
      await expectNoViolations(page, testInfo, `admin: ${section}`)
    }

    // A change, so the plan has steps and the confirmation opens.
    await openSection(page, 'Game')
    const name = page.getByLabel('Name', { exact: true }).first()
    await name.fill('Exercise Northern Gate II')
    await openSection(page, 'Publish')
    await expectNoViolations(page, testInfo, 'admin: Publish')
    await page.getByRole('button', { name: 'Check the server and plan' }).click()
    const plan = page.getByRole('region', { name: 'Publish plan' })
    await expect(plan).toBeVisible({ timeout: 20_000 })
    await expectNoViolations(page, testInfo, 'publish plan')
    await plan.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Publish these changes?' })
    await expect(confirm).toBeVisible()
    await expectNoViolations(page, testInfo, 'publish confirmation', {
      include: '[role="alertdialog"]',
    })
    await confirm.getByRole('button', { name: 'Cancel' }).click()

    await openSection(page, 'Audit')
    await page.getByRole('button', { name: 'Run the audit' }).click()
    await expect(page.getByText('Unlock the vault to check observer voice.')).toBeVisible({
      timeout: 20_000,
    })
    await expectNoViolations(page, testInfo, 'audit')
  })

  test('the multi-client view with four panes', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto('./#/multi')
    await page.getByRole('radio', { name: '4' }).check()
    await expectNoViolations(page, testInfo, 'multi-client, logged out')
    const pane = (n: number) => page.getByRole('region', { name: `Pane ${n}`, exact: true })
    const logins = ['Blue CO (Blue)', 'Red CO (Red)', 'Umpire (White, admin)']
    for (const [i, label] of logins.entries()) {
      await pane(i + 1)
        .getByRole('button', { name: `Log in as ${label}`, exact: true })
        .click()
      await expect(pane(i + 1).getByRole('button', { name: 'Log out' })).toBeVisible()
    }
    await pane(4).getByRole('button', { name: 'Show the admin backend in this pane' }).click()
    await expect(pane(4).getByRole('heading', { name: 'Admin login' })).toBeVisible()
    await settled(page)
    await expectNoViolations(page, testInfo, 'multi-client, four panes')
  })
})

/** The focused element shows a focus indicator: an outline or a box shadow (WCAG 2.4.7). */
async function focusIsVisible(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const el = document.activeElement
    // Past the last stop focus leaves the page for the browser's own controls.
    if (el === document.body) return undefined
    if (!(el instanceof HTMLElement)) return 'nothing is focused'
    const style = getComputedStyle(el)
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
    const shadow = style.boxShadow !== 'none' && style.boxShadow !== ''
    if (outline || shadow) return undefined
    const label = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40)
    return `<${el.tagName.toLowerCase()}> "${label}" has no visible focus indicator`
  })
}

/**
 * Presses Tab (or Shift+Tab, `backward`) until `target` is focused, checking the focus indicator
 * at every stop. Past the page's last stop Chromium wraps to its first, but Firefox leaves focus
 * in its own controls; so a control earlier on the page is reached backward, not by wrapping.
 */
async function tabTo(page: Page, target: Locator, max = 60, backward = false): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(backward ? 'Shift+Tab' : 'Tab')
    expect(await focusIsVisible(page)).toBeUndefined()
    if (await target.evaluate((el) => el === document.activeElement)) return
  }
  throw new Error(`Tab never reached ${target.toString()}`)
}

test.describe('keyboard only', () => {
  // WebKit moves Tab between form fields only, as Safari does until the user turns on "Press Tab
  // to highlight each item"; the keyboard pass is for the browsers that move to every control.
  test.skip(({ browserName }) => browserName === 'webkit', 'Tab skips buttons and links in WebKit')

  test('focus moves through the page in reading order, always visible (WCAG 2.4.3, 2.4.7)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('./')
    await logIn(page, 'admin', 'demo-admin')
    await expect(roomTabs(page)).toHaveCount(3)
    await settled(page)
    // From the first control on the page, in the header.
    await page.getByRole('banner').first().locator('a, button, input, select').first().focus()
    // Each stop's landmark: the header, the workspace or the column, until focus leaves the page.
    const stops: string[] = ['header']
    for (let i = 0; i < 150; i++) {
      await page.keyboard.press('Tab')
      expect(await focusIsVisible(page)).toBeUndefined()
      const where = await page.evaluate(() => {
        const el = document.activeElement
        if (el === null || el === document.body) return 'end'
        const mark = el.closest('header, main, aside')
        return mark?.tagName.toLowerCase() ?? 'other'
      })
      if (where === 'end') break
      if (stops.at(-1) !== where) stops.push(where)
    }
    // The app bar and shell header first, then the workspace, then the column: no jumping back.
    expect(stops).toEqual(['header', 'main', 'aside'])
  })

  test('log in, switch rooms, send a message, move a tab and log out without a pointer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('./')
    await tabTo(page, page.getByLabel('Login name'))
    await page.keyboard.type('blue-co')
    await page.keyboard.press('Tab')
    expect(await focusIsVisible(page)).toBeUndefined()
    await page.keyboard.type('demo-blue-co')
    await page.keyboard.press('Enter')
    await expect(roomTabs(page)).toHaveCount(2)

    // Room tabs: reachable by Tab, switched with the arrow keys and Enter (the tablist pattern).
    const blue = page.getByRole('tab', { name: 'Blue HQ', exact: true })
    await tabTo(page, blue)
    const talks = 'Blue–Red negotiation'
    // Move negotiation into Blue HQ's tabset with the keyboard alternative to dragging (NFR-14).
    await tabTo(page, page.getByRole('tab', { name: talks, exact: true }))
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await expect(
      page.getByRole('main', { name: 'Workspace' }).getByRole('status').first(),
    ).toContainText(`${talks} moved to column 1`)
    await expect(page.getByRole('tab', { name: talks, exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name: talks, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // The composer, by Tab from the tab: type and send with Enter.
    const box = page.getByRole('textbox', { name: `Message ${talks}`, exact: true })
    await tabTo(page, box)
    await page.keyboard.type('Sent from the keyboard.')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: `Messages in ${talks}` })).toContainText(
      'Sent from the keyboard.',
    )

    // Back from the composer to the header's Log out.
    await tabTo(page, page.getByRole('button', { name: 'Log out' }), 120, true)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  })

  test('the admin reorders roles with the keyboard and the Move buttons, not by dragging (ADM-8)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('./#/admin')
    await logIn(page, 'admin', 'demo-admin')
    await openSection(page, 'Roles')
    const list = page.getByRole('list', { name: /roles/i }).first()
    const names = () =>
      list
        .getByRole('button', { name: /^Reorder / })
        .evaluateAll((all) =>
          all.map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Reorder /, '')),
        )
    const before = await names()
    expect(before.length).toBeGreaterThan(1)
    const [first, second] = before
    // dnd-kit's keyboard sensor: Space picks up, ArrowDown moves, Space drops.
    await tabTo(page, list.getByRole('button', { name: `Reorder ${first ?? ''}` }), 120)
    // Each step waits for dnd-kit's live announcement, which is also what a screen reader hears.
    const live = page.getByRole('status').filter({ hasText: first ?? '' })
    const handle = list.getByRole('button', { name: `Reorder ${first ?? ''}` })
    await page.keyboard.press('Space')
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(live.filter({ hasText: 'moved to position 2' })).toHaveCount(1)
    await page.keyboard.press('Space')
    await expect(live.filter({ hasText: 'dropped in position 2' })).toHaveCount(1)
    await expect.poll(names).toEqual([second, first, ...before.slice(2)])
    // The single-pointer and keyboard alternative: the Move up button (WCAG 2.5.7).
    await tabTo(page, list.getByRole('button', { name: `Move ${first ?? ''} up` }))
    await page.keyboard.press('Enter')
    await expect.poll(names).toEqual(before)
  })
})

test('a room tab’s unread count is its description for screen readers (PLY-11, NFR-14)', async ({
  context,
}) => {
  const red = await context.newPage()
  await red.setViewportSize({ width: 1400, height: 900 })
  await red.goto('./')
  await logIn(red, 'red-co', 'demo-red-co')
  const talks = 'Blue–Red negotiation'
  // Red HQ and the negotiation in one tabset, Red HQ on show: the negotiation is hidden.
  await red.getByRole('tab', { name: talks, exact: true }).focus()
  await red.keyboard.press('Alt+Shift+ArrowLeft')
  await red.getByRole('tab', { name: 'Red HQ', exact: true }).click()

  const blue = await context.newPage()
  await blue.goto('./')
  await logIn(blue, 'blue-co', 'demo-blue-co')
  const box = blue.getByRole('textbox', { name: `Message ${talks}`, exact: true })
  for (const text of ['One.', 'Two.']) {
    await box.fill(text)
    await box.press('Enter')
    await expect(blue.getByRole('region', { name: `Messages in ${talks}` })).toContainText(text)
  }
  const tab = red.getByRole('tab', { name: talks, exact: true })
  // The name stays the room's name; the count is read after it.
  await expect(tab).toHaveAccessibleName(talks)
  await expect(tab).toHaveAccessibleDescription('2 unread messages')
  await tab.click()
  await expect(red.getByRole('tab', { name: talks, exact: true })).not.toHaveAttribute(
    'aria-describedby',
    /.+/,
  )
})
