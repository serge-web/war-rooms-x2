// The map room in the built app, under its Content-Security-Policy (WP 5.5, PLY-57, F7): Leaflet
// and milsymbol run with no eval and no refused style or image; one symbol per asset; the tiles
// come from the build's tile host (stubbed: no test reaches the internet) with the site's origin
// as Referer; selecting a symbol or a table row shows the asset's fields; the map works from the
// keyboard and in a popped-out window; axe finds nothing (NFR-14). The world state's arrival,
// a modified client's post and the reload from MAM are in scenarios/map-room.spec.ts, on both
// backends.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoViolations } from './a11y.ts'
import { DEMO_TILE_HOST, mapPanel, openMap, stubTiles, symbols, tilesLoaded } from './map.ts'
import { logIn } from './mock.ts'

/** Errors in the page and every CSP refusal, as template-editor.spec.ts collects them. */
async function watch(page: Page): Promise<string[]> {
  const problems: string[] = []
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy|unsafe-eval/i.test(m.text())) {
      problems.push(m.text())
    }
  })
  page.on('pageerror', (e) => problems.push(e.message))
  return problems
}

test('the map room draws the world state under the CSP, with details, a table and the keyboard (PLY-57, F7, NFR-14)', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000)
  const problems = await watch(page)
  const tiles = await stubTiles(context)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await logIn(page, 'blue-co', 'demo-blue-co')
  const panel = await openMap(page, 6)

  // The turn, and one symbol per asset of the admin's world state (PLY-59).
  await expect(panel.getByText('World state for turn 1: 6 assets')).toBeVisible()
  await expect(symbols(panel)).toHaveCount(6)
  await expect(symbols(panel).first()).toHaveAttribute('src', /^data:image\/svg\+xml/)
  // Read-only: no composer in the map room.
  await expect(panel.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('.flexlayout__layout_main .wrx-composer')).toHaveCount(0)

  // Tiles from the build's tile host, sending the site's origin only (the OSMF policy).
  await tilesLoaded(panel)
  expect(tiles.length).toBeGreaterThan(0)
  expect(tiles.every((t) => t.url.startsWith(`${DEMO_TILE_HOST}/`))).toBe(true)
  const origin = new URL(page.url()).origin
  expect(tiles.every((t) => t.referer === `${origin}/`)).toBe(true)
  await expect(panel.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright',
  )

  // A symbol, clicked: its fields, and the symbol outlined.
  await panel.locator('img.wrx-map__symbol[alt="Tank Company"]').click()
  const details = panel.getByRole('region', { name: 'Asset details' })
  await expect(details.getByRole('heading', { name: 'Tank Company' })).toBeVisible()
  await expect(details).toContainText('ForceRed')
  await expect(details).toContainText('Categoryarmour')
  await expect(details).toContainText('Symbol codeSHGPUCA----K---')
  await expect(panel.locator('img.wrx-map__symbol--selected')).toHaveAttribute(
    'alt',
    'Tank Company',
  )
  await page.mouse.move(0, 0)
  await expectNoViolations(page, testInfo, 'map room with an asset selected', {
    include: '.flexlayout__layout_main',
  })

  // The map pans from the keyboard (Leaflet's keyboard handler).
  const pane = panel.locator('.leaflet-map-pane')
  const before = await pane.getAttribute('style')
  await panel.getByRole('region', { name: /^Map: map of 6 assets/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => pane.getAttribute('style')).not.toBe(before)

  // The table: the same assets, reached and used from the keyboard alone.
  await panel.getByRole('button', { name: 'Table' }).click()
  const table = panel.getByRole('table')
  await expect(table.getByRole('row')).toHaveCount(7)
  await expect(table.getByRole('row').nth(1)).toContainText('1st Rifles')
  const recce = table.getByRole('button', { name: 'Recce Troop' })
  await recce.focus()
  await page.keyboard.press('Enter')
  await expect(details.getByRole('heading', { name: 'Recce Troop' })).toBeVisible()
  await expect(recce).toHaveAttribute('aria-pressed', 'true')
  await expectNoViolations(page, testInfo, 'map room table with details', {
    include: '.flexlayout__layout_main',
  })
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)

  // "Show on map" goes back to the map with the asset selected.
  await recce.click()
  await details.getByRole('button', { name: 'Show on map' }).click()
  await expect(table).toHaveCount(0)
  await expect(panel.locator('img.wrx-map__symbol--selected')).toHaveAttribute('alt', 'Recce Troop')
  expect(problems).toEqual([])
})

test('a popped-out map loads its tiles under popout.html’s policy, and drags (PLY-4, F7)', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000)
  const problems = await watch(page)
  await stubTiles(context)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await logIn(page, 'blue-co', 'demo-blue-co')
  await openMap(page, 6)
  const popup = page.waitForEvent('popup')
  await page
    .locator('.flexlayout__tabset', { has: page.getByRole('tab', { name: 'Map', exact: true }) })
    .getByRole('button', { name: 'Popout selected tab' })
    .click()
  const popout = await popup
  popout.on('console', (m) => {
    if (m.type() === 'error') problems.push(`popout: ${m.text()}`)
  })
  expect(
    await popout.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),
  ).toContain(`img-src 'self' data: blob: ${DEMO_TILE_HOST};`)
  const panel = mapPanel(popout)
  await expect(symbols(panel)).toHaveCount(6, { timeout: 20_000 })
  await tilesLoaded(panel)

  // Leaflet follows a drag on the opener's document; the map forwards the popout's moves.
  const canvas = panel.locator('.wrx-map__canvas')
  const box = await canvas.boundingBox()
  if (box === null) throw new Error('no map in the popout')
  const pane = panel.locator('.leaflet-map-pane')
  const before = await pane.getAttribute('style')
  await popout.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await popout.mouse.down()
  await popout.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 40, { steps: 8 })
  await popout.mouse.up()
  await expect.poll(() => pane.getAttribute('style')).not.toBe(before)
  await popout.close({ runBeforeUnload: true })
  expect(problems).toEqual([])
})
