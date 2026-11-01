// Performance at the v1 sizes (WP 3.2): NFR-11 on the scale fixture (50 roles, 30 rooms, 10,000
// messages in one room): a room tab renders in under 1 s, scrolling stays smooth, and the access
// matrix and publish plan stay usable; and NFR-12: four panes of the multi-client view, a message
// reaching all four within 1 s, and typing without visible lag. Measured in Chromium only, where
// the timing APIs used are; the numbers are recorded in plan/reviews/phase-3-performance.md. The
// assertions are a regression guard at MARGIN times the target, so a shared CI runner does not
// fail them, and a real regression (a lost virtualisation, an O(n²) render) still does.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { logIn, roomTabs } from './mock.ts'
import { MARGIN, inputStats, record, scrollFrames, timeToFrame, watchInput } from './perf.ts'
import { SCALE_BUSY_ROOM_NAME, busyRoomList, loadScale, storeScaleDraft } from './scale.ts'

test.skip(({ browserName }) => browserName !== 'chromium', 'timing APIs and numbers: Chromium')

const BUSY_TAB = `.flexlayout__layout_main [role="tab"][aria-label="${SCALE_BUSY_ROOM_NAME}"]`
const BUSY_LIST = `[role="region"][aria-label="Messages in ${SCALE_BUSY_ROOM_NAME}"]`
/** The newest message in the busy room. */
const NEWEST = '#10000 '

async function asUmpire(page: Page): Promise<void> {
  await logIn(page, 'admin', 'demo-admin')
  await expect(roomTabs(page)).toHaveCount(30, { timeout: 30_000 })
}

test('NFR-11: a room tab of 10,000 messages renders in under 1 s and scrolls smoothly', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1400, height: 900 })
  await loadScale(page)
  const login = Date.now()
  await asUmpire(page)
  const loginMs = Date.now() - login
  await expect(busyRoomList(page).getByText(NEWEST)).toBeVisible({ timeout: 30_000 })

  // Leave the busy room's tabset on another tab, so after a reload its panel has never rendered
  // (FlexLayout renders a tab on first show) and the next click times a cold render.
  const sibling = await page.evaluate((selector) => {
    const tabset = document.querySelector(selector)?.closest('.flexlayout__tabset')
    const tabs = [...(tabset?.querySelectorAll('[role="tab"]') ?? [])]
    return tabs.find((t) => t.getAttribute('aria-label') !== 'Plenary')?.getAttribute('aria-label')
  }, BUSY_TAB)
  expect(sibling).toBeDefined()
  const siblingTab = `.flexlayout__layout_main [role="tab"][aria-label="${sibling ?? ''}"]`
  await page.locator(siblingTab).click()
  await expect(busyRoomList(page)).toBeHidden()
  await page.reload()
  await asUmpire(page)
  await expect(page.getByRole('region', { name: `Messages in ${sibling ?? ''}` })).toBeVisible()
  await expect(busyRoomList(page)).toHaveCount(0)

  const until = { selector: `${BUSY_LIST} article`, text: NEWEST }
  const cold = await timeToFrame(page, 'room-tab-cold', { click: BUSY_TAB }, until)
  // Away and back: the panel stays mounted, so this is the switch a player makes most often.
  await page.locator(siblingTab).click()
  await expect(busyRoomList(page)).toBeHidden()
  const warm = await timeToFrame(page, 'room-tab-warm', { click: BUSY_TAB }, until)

  // Virtualised: only the rows in view (and the overscan) are in the DOM.
  const rendered = await page.locator(`${BUSY_LIST} .wrx-chat__row`).count()

  // Typing in the busy room's composer: input-to-paint for every keystroke.
  await page.getByRole('textbox', { name: `Message ${SCALE_BUSY_ROOM_NAME}`, exact: true }).click()
  await watchInput(page)
  await page.keyboard.type('Typing in a room of ten thousand messages.', { delay: 25 })
  const typing = await inputStats(page)

  // Scroll up through the history: older pages of 50 load as the reader nears the top (PLY-49).
  const up = await scrollFrames(page, BUSY_LIST, -60, 600)
  // How far back that reached: the message number of the oldest row on screen.
  const reached = Number(
    /#(\d+) /.exec((await page.locator(`${BUSY_LIST} article`).first().textContent()) ?? '')?.[1],
  )

  // Page in the whole history, then scroll down through all 10,000 rows held in memory.
  const all = Date.now()
  await page.evaluate(async (selector) => {
    const el = document.querySelector(selector)
    if (!(el instanceof HTMLElement)) throw new Error('no list')
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    for (let i = 0; i < 20_000; i++) {
      el.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
      await frame()
      if (el.querySelector('.wrx-chat__start') !== null) return
    }
    throw new Error('the start of the history never came')
  }, BUSY_LIST)
  const allMs = Date.now() - all
  await expect(page.locator(BUSY_LIST).getByText('Start of the room’s history.')).toBeVisible()
  const down = await scrollFrames(page, BUSY_LIST, 120, 600)
  const renderedFull = await page.locator(`${BUSY_LIST} .wrx-chat__row`).count()

  await record(testInfo, [
    { name: 'umpire login to 30 room tabs (informational)', value: loginMs, unit: 'ms' },
    { name: 'room tab, cold render (10,000-message room)', value: cold, unit: 'ms', target: 1000 },
    { name: 'room tab, switch back (mounted)', value: warm, unit: 'ms', target: 1000 },
    { name: 'rows in the DOM', value: rendered, unit: 'count' },
    { name: 'typing: longest input-to-paint', value: typing.max, unit: 'ms', target: 100 },
    { name: 'scroll up with paging: frames', value: up.frames, unit: 'count' },
    { name: 'scroll up with paging: p50 frame', value: up.p50, unit: 'ms' },
    { name: 'scroll up with paging: p95 frame', value: up.p95, unit: 'ms' },
    { name: 'scroll up with paging: longest frame', value: up.max, unit: 'ms' },
    { name: 'scroll up with paging: frames over 50 ms', value: up.long, unit: 'count' },
    {
      name: 'scroll up with paging: longest script in a frame',
      value: up.longestScript,
      unit: 'ms',
    },
    { name: 'scroll up with paging: reached message number', value: reached, unit: 'count' },
    { name: 'page in all 10,000 (informational)', value: allMs, unit: 'ms' },
    { name: 'scroll down, 10,000 loaded: p50 frame', value: down.p50, unit: 'ms' },
    { name: 'scroll down, 10,000 loaded: p95 frame', value: down.p95, unit: 'ms' },
    { name: 'scroll down, 10,000 loaded: longest frame', value: down.max, unit: 'ms' },
    { name: 'scroll down, 10,000 loaded: frames over 50 ms', value: down.long, unit: 'count' },
    {
      name: 'scroll down, 10,000 loaded: longest script in a frame',
      value: down.longestScript,
      unit: 'ms',
    },
    { name: 'rows in the DOM, 10,000 loaded', value: renderedFull, unit: 'count' },
  ])

  expect(cold).toBeLessThan(1000 * MARGIN)
  expect(warm).toBeLessThan(1000 * MARGIN)
  expect(rendered).toBeLessThan(100)
  expect(typing.max).toBeLessThan(100 * MARGIN)
  expect(renderedFull).toBeLessThan(100)
  // Smooth: most frames at the display rate; a guard against a render that scales with the room.
  expect(down.p95).toBeLessThan(50 * MARGIN)
  expect(up.p95).toBeLessThan(50 * MARGIN)
})

test('NFR-11: the access matrix and the publish plan stay usable at 50 roles and 30 rooms', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1400, height: 900 })
  await loadScale(page, './#/admin')
  await storeScaleDraft(page)
  await page.reload()
  await logIn(page, 'admin', 'demo-admin')
  const nav = page.getByRole('navigation', { name: 'Admin sections' })
  await expect(nav).toBeVisible()

  const access = await timeToFrame(
    page,
    'access-matrix',
    { click: 'nav[aria-label="Admin sections"] button', text: 'Access' },
    { selector: 'table.wrx-admin-matrix tbody tr', count: 30 },
  )
  await expect(page.locator('table.wrx-admin-matrix tbody tr')).toHaveCount(30)
  await expect(page.locator('table.wrx-admin-matrix thead tr').nth(1).locator('th')).toHaveCount(50)

  // Typing in the editor at this size: each keystroke re-validates the draft and the matrix.
  await nav.getByRole('button', { name: 'Game', exact: false }).first().click()
  const name = page.getByLabel('Name', { exact: true }).first()
  await name.click()
  await name.press('End')
  await watchInput(page)
  await page.keyboard.type(' at scale', { delay: 30 })
  const typing = await inputStats(page)

  await nav.getByRole('button', { name: 'Publish', exact: false }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: 'Publish' })).toBeVisible()
  const plan = await timeToFrame(
    page,
    'publish-plan',
    { click: 'main button', text: 'Check the server and plan' },
    { selector: 'main h3', text: 'Publish plan' },
    60_000,
  )
  // The plan holds the game-setup change typed above, and every document at the new version.
  const region = page.getByRole('region', { name: 'Publish plan' })
  await region.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Publish these changes?' })
  const applied = Date.now()
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText(/Publish complete: \d+ steps applied/)).toBeVisible({
    timeout: 60_000,
  })
  const publishMs = Date.now() - applied

  await record(testInfo, [
    { name: 'access matrix 30 × 50 opens', value: access, unit: 'ms', target: 1000 },
    { name: 'editor typing: longest input-to-paint', value: typing.max, unit: 'ms', target: 100 },
    { name: 'publish plan against the server', value: plan, unit: 'ms' },
    { name: 'publish of that plan (informational)', value: publishMs, unit: 'ms' },
  ])
  expect(access).toBeLessThan(1000 * MARGIN)
  expect(typing.max).toBeLessThan(100 * MARGIN)
  expect(plan).toBeLessThan(10_000 * MARGIN)
})

test('NFR-12: four panes; a message reaches all four within 1 s, and typing does not lag', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('./#/multi')
  await page.getByRole('radio', { name: '4' }).check()
  const pane = (n: number) => page.getByRole('region', { name: `Pane ${n}`, exact: true })
  const talks = 'Blue–Red negotiation'
  const logins = [
    'Blue CO (Blue)',
    'Red CO (Red)',
    'Umpire (White, admin)',
    'White Observer (White)',
  ]
  for (const [i, label] of logins.entries()) {
    await pane(i + 1)
      .getByRole('button', { name: `Log in as ${label}`, exact: true })
      .click()
  }
  for (const n of [1, 2, 3, 4]) {
    const tab = pane(n).locator('.flexlayout__layout_main').getByRole('tab', { name: talks })
    await tab.click()
    await expect(pane(n).getByRole('region', { name: `Messages in ${talks}` })).toBeVisible()
  }
  const box = pane(1).getByRole('textbox', { name: `Message ${talks}`, exact: true })
  const list = `[role="region"][aria-label="Messages in ${talks}"] article`
  const send = `[data-pane="1"] [aria-label="${talks}"] .wrx-composer button`

  // NFR-12: each message, from the click on Send to the frame that shows it in all four panes.
  const deliveries: number[] = []
  for (let i = 1; i <= 10; i++) {
    const text = `Delivery check ${i} of 10.`
    await box.fill(text)
    deliveries.push(
      await timeToFrame(page, `deliver-${i}`, { click: send }, { selector: list, text, count: 4 }),
    )
  }
  deliveries.sort((a, b) => a - b)

  // Typing: input-to-paint for every keystroke, with the other three panes live.
  await box.click()
  await watchInput(page)
  await page.keyboard.type('Blue proposes a ceasefire at the crossing until noon tomorrow.', {
    delay: 25,
  })
  const typing = await inputStats(page)

  await record(testInfo, [
    { name: 'delivery to 4 panes: median', value: deliveries[4] ?? 0, unit: 'ms', target: 1000 },
    {
      name: 'delivery to 4 panes: slowest of 10',
      value: deliveries.at(-1) ?? 0,
      unit: 'ms',
      target: 1000,
    },
    { name: 'typing: longest input-to-paint', value: typing.max, unit: 'ms', target: 100 },
    { name: 'typing: input events reported', value: typing.events, unit: 'count' },
  ])
  expect(deliveries.at(-1)).toBeLessThan(1000 * MARGIN)
  expect(typing.max).toBeLessThan(100 * MARGIN)
})
