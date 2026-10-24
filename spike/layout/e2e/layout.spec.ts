import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Library } from '../src/shared/harness.ts'
import {
  drag,
  duplicateIds,
  harness,
  libraries,
  open,
  panel,
  selectedOf,
  tab,
  tabsOf,
  workspace,
  WORKSPACES,
} from './helpers.ts'

// One test list, run against both libraries. Tests read the DOM; they change layouts only
// through user input or the window.wrx harness, which uses each library's public API.

/**
 * Click a pop-out control and return the window that ends up showing the room. Under
 * StrictMode FlexLayout opens a window, closes it and opens another, so take the survivor.
 */
async function popOut(page: Page, trigger: () => Promise<void>): Promise<Page> {
  const opened: Page[] = []
  const onPopup = (p: Page) => opened.push(p)
  page.on('popup', onPopup)
  await trigger()
  let found: Page | undefined
  await expect
    .poll(async () => {
      for (const p of opened)
        if (!p.isClosed() && (await p.locator('[data-room]').count()) > 0) found = p
      return found !== undefined
    })
    .toBe(true)
  page.off('popup', onPopup)
  test
    .info()
    .annotations.push({ type: 'windows opened by one pop-out', description: String(opened.length) })
  if (found === undefined) throw new Error('no popout')
  await expect(found.locator('[data-room]')).toBeVisible()
  return found
}

function popoutButton(library: Library, ws: Locator, roomName: string): Locator {
  return library === 'flexlayout'
    ? ws
        .locator('.flexlayout__tabset', { has: tab(ws.page(), roomName) })
        .getByRole('button', { name: 'Popout selected tab' })
    : ws.getByRole('button', { name: `Pop out ${roomName}` })
}

for (const library of libraries) {
  test.describe(library, () => {
    test('1. four independent workspaces: dragging in one leaves the other three unchanged (D15)', async ({
      page,
    }) => {
      const { errors } = await open(page, library, { rooms: 4 })
      const ws0 = workspace(page, 'ws0')
      const before = await Promise.all(WORKSPACES.map((id) => harness(page, id).toJson()))
      expect(tabsOf(await harness(page, 'ws0').structure())).toEqual([['r1', 'r2'], ['r3'], ['r4']])

      // A real mouse drag of Room 2's tab onto the middle tabset's content.
      await drag(page, tab(ws0, 'Room 2'), panel(ws0, 'r3'))
      await expect
        .poll(async () => tabsOf(await harness(page, 'ws0').structure()))
        .toEqual([['r1'], ['r3', 'r2'], ['r4']])
      for (const [i, id] of WORKSPACES.entries()) {
        if (i > 0) expect(await harness(page, id).toJson(), `${id} unchanged`).toBe(before[i])
      }

      // A drag from one workspace into another must change neither. (The source may record
      // which of its own groups is active; its structure must not change.)
      const ws1Before = tabsOf(await harness(page, 'ws1').structure())
      const ws2Before = await harness(page, 'ws2').toJson()
      await drag(page, tab(workspace(page, 'ws1'), 'Room 1'), panel(workspace(page, 'ws2'), 'r3'))
      await page.waitForTimeout(300)
      expect(tabsOf(await harness(page, 'ws1').structure())).toEqual(ws1Before)
      expect(await harness(page, 'ws2').toJson()).toBe(ws2Before)

      // Same room ids in all four workspaces must not produce duplicate DOM ids.
      expect(await duplicateIds(page)).toEqual([])
      expect(errors).toEqual([])
    })

    test('2. pop out a tab into a new window and close it cleanly', async ({ page }) => {
      const { errors } = await open(page, library, { rooms: 4 })
      const ws0 = workspace(page, 'ws0')
      const ws1 = workspace(page, 'ws1')
      await ws0.getByLabel('Draft for Room 1').fill('unsent text')

      const win0 = await popOut(page, () => popoutButton(library, ws0, 'Room 1').click())
      await expect.poll(() => harness(page, 'ws0').popouts()).toEqual(['r1'])
      expect(tabsOf(await harness(page, 'ws0').structure())).toEqual([['r2'], ['r3'], ['r4']])

      // Component state, context (unread store) and the per-panel theme all reach the popout.
      await expect(win0.getByLabel('Draft for Room 1')).toHaveValue('unsent text')
      await harness(page, 'ws0').setUnread('r1', 5)
      await expect(win0.locator('[data-unread="r1"]')).toHaveText('5')
      const accent = await panel(win0, 'r1').evaluate((e) =>
        getComputedStyle(e).getPropertyValue('--room-accent'),
      )
      expect(accent).toContain('hsl')

      // A second workspace pops out the same room: its own window, no cross-talk.
      const win1 = await popOut(page, () => popoutButton(library, ws1, 'Room 1').click())
      expect(win1).not.toBe(win0)
      await expect.poll(() => harness(page, 'ws1').popouts()).toEqual(['r1'])
      await expect(win1.locator('[data-unread="r1"]')).toHaveCount(0)

      // The user closes the first window (beforeunload runs, as for a real close): its tab
      // docks back, and the other workspace's popout stays.
      await win0.close({ runBeforeUnload: true })
      await expect.poll(() => harness(page, 'ws0').popouts()).toEqual([])
      await expect
        .poll(async () =>
          tabsOf(await harness(page, 'ws0').structure())
            .flat()
            .sort(),
        )
        .toEqual(['r1', 'r2', 'r3', 'r4'])
      test.info().annotations.push({
        type: 'docked back to',
        description: JSON.stringify(tabsOf(await harness(page, 'ws0').structure())),
      })
      await expect(tab(ws0, 'Room 1')).toBeVisible()
      expect(await harness(page, 'ws1').popouts()).toEqual(['r1'])
      await tab(ws0, 'Room 1').click()
      await expect(ws0.getByLabel('Draft for Room 1')).toHaveValue('unsent text')

      await win1.close({ runBeforeUnload: true })
      await expect.poll(() => harness(page, 'ws1').popouts()).toEqual([])
      expect(errors).toEqual([])
    })

    test('2b. popout closed without beforeunload (crash or forced close)', async ({ page }) => {
      await open(page, library, { rooms: 4 })
      const win = await popOut(page, () =>
        popoutButton(library, workspace(page, 'ws0'), 'Room 1').click(),
      )
      await win.close()
      await page.waitForTimeout(1500)
      const stranded = await harness(page, 'ws0').popouts()
      test
        .info()
        .annotations.push({
          type: 'rooms left in a closed popout',
          description: JSON.stringify(stranded),
        })
      // Recorded rather than required: dockview recovers; FlexLayout listens only for beforeunload.
      expect(stranded).toEqual(library === 'dockview' ? [] : ['r1'])
    })

    for (const [rooms, expected] of [
      [1, [['r1']]],
      [2, [['r1'], ['r2']]],
      [3, [['r1'], ['r2'], ['r3']]],
      [
        7,
        [
          ['r1', 'r2', 'r3'],
          ['r4', 'r5'],
          ['r6', 'r7'],
        ],
      ],
    ] as const) {
      test(`3. PLY-40 default layout with ${rooms} room(s)`, async ({ page }) => {
        const { errors } = await open(page, library, { rooms, ws: 1 })
        const s = await harness(page, 'ws0').structure()
        expect(tabsOf(s)).toEqual(expected)
        expect(selectedOf(s)).toEqual(expected.map((col) => col[0]))
        // Side by side, equal widths, in room order.
        const boxes = await Promise.all(
          expected.map((col) => panel(workspace(page, 'ws0'), col[0]).boundingBox()),
        )
        const xs = boxes.map((b) => b?.x ?? NaN)
        expect([...xs].sort((a, b) => a - b)).toEqual(xs)
        for (const b of boxes) {
          expect(b?.y).toBeCloseTo(boxes[0]?.y ?? NaN, 0)
          expect(Math.abs((b?.width ?? 0) - (boxes[0]?.width ?? 0))).toBeLessThan(3)
        }
        expect(errors).toEqual([])
      })
    }

    test('4. PLY-41: a room added during play goes to the tabset with the fewest tabs', async ({
      page,
    }) => {
      const { errors } = await open(page, library, { rooms: 7 })
      const h0 = harness(page, 'ws0')
      const others = await Promise.all(['ws2', 'ws3'].map((id) => harness(page, id).toJson()))
      const selected = selectedOf(await h0.structure())

      await h0.addRoom('r8')
      expect(tabsOf(await h0.structure())).toEqual([
        ['r1', 'r2', 'r3'],
        ['r4', 'r5', 'r8'],
        ['r6', 'r7'],
      ])
      await h0.addRoom('r9')
      await h0.addRoom('r10')
      expect(tabsOf(await h0.structure())).toEqual([
        ['r1', 'r2', 'r3', 'r10'],
        ['r4', 'r5', 'r8'],
        ['r6', 'r7', 'r9'],
      ])
      // The rest of the layout is not disturbed: the selected tabs are unchanged.
      expect(selectedOf(await h0.structure())).toEqual(selected)
      await expect(tab(workspace(page, 'ws0'), 'Room 10')).toBeVisible()

      // After the user rearranges, the rule follows the actual counts.
      const h1 = harness(page, 'ws1')
      await h1.moveRoom('r4', 2)
      expect(tabsOf(await h1.structure())).toEqual([['r1', 'r2', 'r3'], ['r5'], ['r6', 'r7', 'r4']])
      await h1.addRoom('r8')
      expect(tabsOf(await h1.structure())).toEqual([
        ['r1', 'r2', 'r3'],
        ['r5', 'r8'],
        ['r6', 'r7', 'r4'],
      ])

      expect(await Promise.all(['ws2', 'ws3'].map((id) => harness(page, id).toJson()))).toEqual(
        others,
      )
      expect(errors).toEqual([])
    })

    test('5. save, restore across room changes without a reset (D6, PLY-6), and reset (PLY-42)', async ({
      page,
    }) => {
      const { errors } = await open(page, library, { rooms: 4 })
      const h = harness(page, 'ws0')
      const ws0 = workspace(page, 'ws0')

      // The user customises: Room 2 joins Room 4, and Room 4 stays the visible tab there.
      await h.moveRoom('r2', 2)
      await h.selectRoom('r4')
      const custom = [['r1'], ['r3'], ['r4', 'r2']]
      expect(tabsOf(await h.structure())).toEqual(custom)
      const saved = await h.toJson()

      // Plain round trip.
      await h.reset()
      expect(tabsOf(await h.structure())).toEqual([['r1', 'r2'], ['r3'], ['r4']])
      await h.restore(saved, ['r1', 'r2', 'r3', 'r4'])
      expect(tabsOf(await h.structure())).toEqual(custom)
      expect(selectedOf(await h.structure())).toEqual(['r1', 'r3', 'r4'])

      // Restore after Room 3 was removed and Room 5 added: Room 3's tabset goes, Room 5 goes
      // into the fewest-tab tabset, and the customisation survives. (A reset would give
      // [r1, r2], [r4], [r5].)
      await ws0.getByLabel('Draft for Room 4').fill('kept')
      await h.restore(saved, ['r1', 'r2', 'r4', 'r5'])
      await expect
        .poll(async () => tabsOf(await h.structure()))
        .toEqual([
          ['r1', 'r5'],
          ['r4', 'r2'],
        ])
      expect(selectedOf(await h.structure())).toEqual(['r1', 'r4'])
      await expect(tab(ws0, 'Room 5')).toBeVisible()
      await expect(tab(ws0, 'Room 3')).toHaveCount(0)
      // Restoring onto the live layout keeps unchanged rooms mounted.
      await expect(ws0.getByLabel('Draft for Room 4')).toHaveValue('kept')

      // PLY-42: reset to the default for the current rooms.
      await h.reset()
      await expect
        .poll(async () => tabsOf(await h.structure()))
        .toEqual([['r1', 'r2'], ['r4'], ['r5']])
      await expect(ws0.getByLabel('Draft for Room 4')).toHaveValue('kept')
      expect(errors).toEqual([])
    })

    test('5b. restoring a saved layout never mounts a room the role has lost', async ({ page }) => {
      await open(page, library, { rooms: 4, ws: 1 })
      const h = harness(page, 'ws0')
      const saved = await h.toJson()
      await h.removeRoom('r3')
      await page.evaluate(() => (window.wrx.mounts = []))
      await h.restore(saved, ['r1', 'r2', 'r4'])
      await expect.poll(async () => tabsOf(await h.structure())).toEqual([['r1', 'r2'], ['r4']])
      await page.waitForTimeout(300)
      const mounted = await page.evaluate(() => window.wrx.mounts)
      test
        .info()
        .annotations.push({
          type: 'panels mounted during restore',
          description: JSON.stringify(mounted),
        })
      // FlexLayout reconciles the model before it renders. dockview's fromJSON creates every
      // saved panel, but removePanel runs in the same task, before React commits the portal.
      expect(mounted).not.toContain('r3')
    })

    test('6. PLY-11: the tab renderer shows an unread count, per workspace', async ({ page }) => {
      const { errors } = await open(page, library, { rooms: 4 })
      const ws0 = workspace(page, 'ws0')
      const ws1 = workspace(page, 'ws1')
      const layout = await harness(page, 'ws0').toJson()

      await harness(page, 'ws0').setUnread('r2', 3)
      await expect(tab(ws0, 'Room 2').locator('[data-unread="r2"]')).toHaveText('3')
      await expect(ws1.locator('[data-unread]')).toHaveCount(0)
      await harness(page, 'ws0').setUnread('r2', 12)
      await expect(tab(ws0, 'Room 2').locator('[data-unread="r2"]')).toHaveText('12')
      await harness(page, 'ws0').setUnread('r2', 0)
      await expect(ws0.locator('[data-unread]')).toHaveCount(0)

      // Counts live outside the layout model: it never changes.
      expect(await harness(page, 'ws0').toJson()).toBe(layout)
      expect(errors).toEqual([])
    })

    test('7. NFR-14: keyboard tab focus, selection and moves', async ({ page }) => {
      const { errors } = await open(page, library, { rooms: 4 })
      const ws1 = workspace(page, 'ws1')
      const h = harness(page, 'ws1')

      // Built in: arrow keys move focus along the tab strip, Enter selects.
      await tab(ws1, 'Room 1').focus()
      await page.keyboard.press('ArrowRight')
      await expect(tab(ws1, 'Room 2')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect.poll(async () => selectedOf(await h.structure())).toEqual(['r2', 'r3', 'r4'])

      // Enter on a selected tab moves focus into its panel, in the same workspace.
      await page.keyboard.press('Enter')
      await expect.poll(() => ws1.evaluate((e) => e.contains(document.activeElement))).toBe(true)

      // Not built in (workaround, public API): Alt+Shift+Arrow moves the selected tab.
      await tab(ws1, 'Room 2').focus()
      await page.keyboard.press('Alt+Shift+ArrowRight')
      await expect
        .poll(async () => tabsOf(await h.structure()))
        .toEqual([['r1'], ['r3', 'r2'], ['r4']])
      const focused = await page.evaluate(() => {
        const e = document.activeElement
        return e === null
          ? 'none'
          : `${e.tagName} ${e.getAttribute('role') ?? ''} ${e.getAttribute('aria-label') ?? ''}`
      })
      test.info().annotations.push({ type: 'focus after keyboard move', description: focused })
      await tab(ws1, 'Room 2').focus()
      await page.keyboard.press('Alt+Shift+ArrowRight')
      await expect
        .poll(async () => tabsOf(await h.structure()))
        .toEqual([['r1'], ['r3'], ['r4', 'r2']])
      await tab(ws1, 'Room 2').focus()
      await page.keyboard.press('Alt+Shift+ArrowLeft')
      await expect
        .poll(async () => tabsOf(await h.structure()))
        .toEqual([['r1'], ['r3', 'r2'], ['r4']])
      expect(errors).toEqual([])
    })

    test('PLY-26: per-panel and per-workspace theming with CSS custom properties', async ({
      page,
    }) => {
      const { errors } = await open(page, library, { rooms: 4 })
      const ws0 = workspace(page, 'ws0')
      const header = (ws: Locator, id: string) =>
        panel(ws, id)
          .locator('.room-header')
          .evaluate((e) => getComputedStyle(e).backgroundColor)
      expect(await header(ws0, 'r1')).not.toBe(await header(ws0, 'r3'))

      // A library token overridden on one workspace changes that workspace's chrome only.
      const stripSelector =
        library === 'flexlayout'
          ? '.flexlayout__tabset_tabbar_outer'
          : '.dv-tabs-and-actions-container'
      const strip = (id: string) =>
        workspace(page, id)
          .locator(stripSelector)
          .first()
          .evaluate((e) => getComputedStyle(e).backgroundColor)
      expect(await strip('ws1')).toBe('rgb(255, 236, 179)')
      expect(await strip('ws0')).not.toBe('rgb(255, 236, 179)')
      expect(errors).toEqual([])
    })
  })
}

test('flexlayout gap: raw room ids as tab ids collide across workspaces and misdirect focus', async ({
  page,
}) => {
  await open(page, 'flexlayout', { rooms: 4, flags: '&rawids' })
  expect(await duplicateIds(page)).toContain('flexlayout-tabbutton-r1')
  const ws1 = workspace(page, 'ws1')
  await tab(ws1, 'Room 1').focus()
  await page.keyboard.press('Enter')
  // document.getElementById finds workspace 1's panel, so focus lands in the wrong workspace.
  await expect
    .poll(() => workspace(page, 'ws0').evaluate((e) => e.contains(document.activeElement)))
    .toBe(true)
})

test('dockview gap: the keyboard docking keymap needs dockview-enterprise', async ({ page }) => {
  const { errors } = await open(page, 'dockview', { rooms: 4, flags: '&kbnav' })
  expect(errors.join('\n')).toContain('ships in dockview-enterprise')
  const h = harness(page, 'ws0')
  await tab(workspace(page, 'ws0'), 'Room 1').focus()
  await page.keyboard.press('Control+m')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  expect(tabsOf(await h.structure())).toEqual([['r1', 'r2'], ['r3'], ['r4']])
})
