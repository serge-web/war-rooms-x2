// The dockable workspace against the mock (WP 2.5): the PLY-40 default, a real drag saved and
// restored after a reload (PLY-5), a room added live going to the fewest-tab tabset (PLY-41),
// reset (PLY-42), the keyboard move (NFR-14) and a popout docking back. Tests read the DOM and
// drive the page as a user would; nothing reaches into the layout library.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { asMockAdmin, logIn } from './mock.ts'

const ROOMS = { blue: 'Blue HQ', red: 'Red HQ', talks: 'Blue–Red negotiation' } as const

/** Room tab names per docked tabset, left to right (then top to bottom). */
function columns(page: Page): Promise<string[][]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.flexlayout__layout_main .flexlayout__tabset')]
      .map((ts) => ({ box: ts.getBoundingClientRect(), ts }))
      .sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y)
      .map(({ ts }) =>
        [...ts.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-label') ?? ''),
      ),
  )
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const announcement = (page: Page) =>
  page.getByRole('main', { name: 'Workspace' }).getByRole('status').first()

/** A user-like mouse drag: press, move in steps so dragenter and dragover fire, release. */
async function drag(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (from === null || to === null) throw new Error('drag: element not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
  await page.mouse.up()
}

async function asUmpire(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await logIn(page, 'umpire-1', 'demo-umpire-1')
  await expect(tab(page, ROOMS.blue)).toBeVisible()
  return errors
}

const DEFAULT = [[ROOMS.blue], [ROOMS.red], [ROOMS.talks]]

/** The demo's game-setup at a new design version, as a publish writes it. */
function gameSetup(designVersion: number) {
  return {
    op: 'publish',
    node: 'game-setup',
    payload: JSON.stringify({
      schemaVersion: 1,
      name: 'Exercise Northern Gate',
      description: 'A two-sided negotiation exercise.',
      briefing: '## Briefing\n\nThe exercise starts at 09:00.',
      designVersion,
      theme: { tokens: { primary: '#1d4ed8', fontFamily: 'sans' }, logoAssetId: 'game-logo' },
      roomTypeDefaults: {},
    }),
  } as const
}

test('umpire-1 sees every room in the three-column default, panels in the strip (PLY-4, PLY-8, PLY-40)', async ({
  page,
}) => {
  const errors = await asUmpire(page)
  await expect.poll(() => columns(page)).toEqual(DEFAULT)
  // Equal widths.
  const widths = await page
    .locator('.flexlayout__layout_main .flexlayout__tabset')
    .evaluateAll((all) => all.map((e) => e.getBoundingClientRect().width))
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2)
  // Each room panel is in its room's theme scope (PLY-24), showing the chat panel (WP 2.6).
  await expect(panel(page, ROOMS.blue)).toHaveAttribute('data-wrx-theme', '')
  await expect(
    panel(page, ROOMS.blue).getByRole('region', { name: `Messages in ${ROOMS.blue}` }),
  ).toBeVisible()
  await tab(page, 'Game info').click()
  await expect(page.getByRole('region', { name: 'Game briefing' })).toContainText('09:00')
  await tab(page, 'Online').click()
  await expect(page.getByRole('region', { name: 'Online' })).toContainText('Lead Umpire')
  expect(errors).toEqual([])
})

test('a dragged tab stays where it was put after a reload (PLY-5, D6)', async ({ page }) => {
  const errors = await asUmpire(page)
  await drag(page, tab(page, ROOMS.red), panel(page, ROOMS.blue))
  await expect.poll(() => columns(page)).toEqual([[ROOMS.blue, ROOMS.red], [ROOMS.talks]])
  await page.reload()
  await logIn(page, 'umpire-1', 'demo-umpire-1')
  await expect(tab(page, ROOMS.blue)).toBeVisible()
  await expect.poll(() => columns(page)).toEqual([[ROOMS.blue, ROOMS.red], [ROOMS.talks]])
  // Another role in the same browser has its own layout.
  await page.getByRole('button', { name: 'Log out' }).click()
  await logIn(page, 'red-co', 'demo-red-co')
  await expect.poll(() => columns(page)).toEqual([[ROOMS.red], [ROOMS.talks]])
  expect(errors).toEqual([])
})

test('a room the admin adds during play goes to the tabset with the fewest tabs (PLY-41, PLY-6)', async ({
  page,
}) => {
  const errors = await asUmpire(page)
  await drag(page, tab(page, ROOMS.talks), panel(page, ROOMS.blue))
  await expect.poll(() => columns(page)).toEqual([[ROOMS.blue, ROOMS.talks], [ROOMS.red]])
  // What a publish does: the node, the new room's document, and a new design version (§3
  // rule 8), since PubSub does not announce new nodes.
  await asMockAdmin(page, [
    { op: 'create-node', node: 'rooms:press', members: ['umpire-1', 'blue-co'] },
    {
      op: 'publish',
      node: 'rooms:press',
      payload: JSON.stringify({
        schemaVersion: 1,
        id: 'press',
        name: 'Press room',
        roomType: 'chat',
        participants: [{ kind: 'force', id: 'blue', access: 'write' }],
        config: {},
        order: 3,
      }),
    },
    gameSetup(2),
  ])
  await expect
    .poll(() => columns(page))
    .toEqual([
      [ROOMS.blue, ROOMS.talks],
      [ROOMS.red, 'Press room'],
    ])
  // The visible tabs did not change.
  await expect(tab(page, ROOMS.red)).toHaveAttribute('aria-selected', 'true')
  // The room is withdrawn again: its tab closes, the rest stays. The node's deletion is
  // announced, so no new design version is needed.
  await asMockAdmin(page, [{ op: 'delete-node', node: 'rooms:press' }])
  await expect.poll(() => columns(page)).toEqual([[ROOMS.blue, ROOMS.talks], [ROOMS.red]])
  expect(errors).toEqual([])
})

test('Reset layout restores the three-column default (PLY-42)', async ({ page }) => {
  const errors = await asUmpire(page)
  await drag(page, tab(page, ROOMS.blue), panel(page, ROOMS.talks))
  await expect.poll(() => columns(page)).toEqual([[ROOMS.red], [ROOMS.talks, ROOMS.blue]])
  await page.getByRole('button', { name: 'Reset layout' }).click()
  await expect.poll(() => columns(page)).toEqual(DEFAULT)
  await page.reload()
  await logIn(page, 'umpire-1', 'demo-umpire-1')
  await expect(tab(page, ROOMS.blue)).toBeVisible()
  await expect.poll(() => columns(page)).toEqual(DEFAULT)
  expect(errors).toEqual([])
})

test('Alt+Shift+Arrow moves the focused tab and keeps focus on it (NFR-14)', async ({ page }) => {
  const errors = await asUmpire(page)
  await tab(page, ROOMS.blue).focus()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  // Wait for each step before the next key: CI runners are slower.
  await expect(announcement(page)).toHaveText('Blue HQ moved to column 1 of 2.')
  await expect.poll(() => columns(page)).toEqual([[ROOMS.red, ROOMS.blue], [ROOMS.talks]])
  await expect(tab(page, ROOMS.blue)).toBeFocused()

  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(announcement(page)).toHaveText('Blue HQ moved to column 2 of 2.')
  await expect.poll(() => columns(page)).toEqual([[ROOMS.red], [ROOMS.talks, ROOMS.blue]])
  await expect(tab(page, ROOMS.blue)).toBeFocused()

  // At the right edge, sharing a tabset: it splits off into a new column.
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(announcement(page)).toHaveText('Blue HQ moved to column 3 of 3.')
  await expect.poll(() => columns(page)).toEqual([[ROOMS.red], [ROOMS.talks], [ROOMS.blue]])
  await expect(tab(page, ROOMS.blue)).toBeFocused()

  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(announcement(page)).toHaveText('Blue HQ cannot move further right.')
  await page.keyboard.press('Alt+Shift+ArrowLeft')
  await expect(announcement(page)).toHaveText('Blue HQ moved to column 2 of 2.')
  await expect.poll(() => columns(page)).toEqual([[ROOMS.red], [ROOMS.talks, ROOMS.blue]])
  await expect(tab(page, ROOMS.blue)).toBeFocused()
  expect(errors).toEqual([])
})

test('a popped-out tab docks back when its window closes', async ({ page }) => {
  const errors = await asUmpire(page)
  const popup = page.waitForEvent('popup')
  await page
    .locator('.flexlayout__tabset', { has: tab(page, ROOMS.talks) })
    .getByRole('button', { name: 'Popout selected tab' })
    .click()
  const popout = await popup
  // popout.html has its own Content-Security-Policy (F7): nothing the workspace puts in it may
  // be refused.
  popout.on('console', (m) => {
    if (m.type() === 'error') errors.push(`popout: ${m.text()}`)
  })
  await expect(popout.getByRole('region', { name: ROOMS.talks, exact: true })).toBeVisible()
  expect(
    await popout.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),
  ).toContain("script-src 'none'")
  // The room's chat panel works in the popout window too.
  await expect(popout.getByRole('region', { name: `Messages in ${ROOMS.talks}` })).toContainText(
    'Blue proposes a ceasefire',
  )
  await expect.poll(() => columns(page)).toEqual([[ROOMS.blue], [ROOMS.red]])
  await popout.close({ runBeforeUnload: true })
  await expect.poll(() => columns(page)).toEqual([[ROOMS.blue, ROOMS.talks], [ROOMS.red]])
  await expect(page.locator('.flexlayout__floating_window, .flexlayout__float')).toHaveCount(0)
  expect(errors).toEqual([])
})
