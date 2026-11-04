// The admin's world-state editor on both backends (WP 5.6; not a user scenario, SC-11 is WP 5.7's):
// ADM-44, ADM-45, ADM-46, D25. The umpire edits an asset in the form and drags another on the map,
// into a draft held in this browser, while Red sees the published state unchanged; "Publish world
// state" shows the change summary and sends the draft as one full-state message; Red's map follows
// live. On ejabberd the message crosses the real server, under the 500 KB map-room cap.
import type { Locator, Page } from '@playwright/test'
import { openMap } from '../map.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const WIDE = { width: 1500, height: 950 }

// Leaflet's zoom animations off, so a symbol is where it is drawn when the drag starts.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const status = (panel: Locator) => panel.locator('.wrx-map__turn')
const side = (panel: Locator) => panel.locator('.wrx-map__details')

async function drag(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  const box = await target.boundingBox()
  if (box === null) throw new Error('not drawn')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 8 })
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

test('the umpire edits the world state in a draft and publishes it with a change summary; Red’s map follows (ADM-44–46, D25)', async ({
  context,
  backend,
}) => {
  test.setTimeout(150_000)
  const red = await context.newPage()
  await red.setViewportSize(WIDE)
  const redErrors = watchErrors(red)
  await openApp(red, backend)
  await logInAs(red, backend, 'red-co')
  const redMap = await openMap(red, 6)
  await expect(status(redMap)).toHaveText('World state for turn 1: 6 assets')

  const umpire = await context.newPage()
  await umpire.setViewportSize(WIDE)
  const umpireErrors = watchErrors(umpire)
  await openApp(umpire, backend)
  await logInAs(umpire, backend, 'admin')
  const panel = await openMap(umpire, 6)
  await expect(panel.getByRole('group', { name: 'World-state editor' })).toBeVisible()

  // 1. A field in the form.
  await panel.getByRole('button', { name: 'Table', exact: true }).click()
  await panel.getByRole('button', { name: 'Tank Company', exact: true }).click()
  await side(panel).getByRole('button', { name: 'Edit…' }).click()
  const form = panel.getByRole('form', { name: 'Edit Tank Company' })
  await form.getByLabel('Health (%)', { exact: true }).fill('35')
  await form.getByRole('button', { name: 'Save to the draft' }).click()
  await side(panel).getByRole('button', { name: 'Close' }).click()

  // 2. A drag on the map.
  await panel.getByRole('button', { name: 'Map', exact: true }).click()
  await panel.getByRole('button', { name: 'Show all assets' }).click()
  await drag(umpire, panel.locator('img.wrx-map__symbol[alt="Recce Troop"]'), 70, -50)
  await expect(panel.getByText('Unpublished edits: 2 assets changed')).toBeVisible()
  await expect(panel.getByText(/held only in this browser/)).toBeVisible()
  // Red still sees the published state.
  await expect(status(redMap)).toHaveText('World state for turn 1: 6 assets')

  // 3. The change summary, then one full-state publish.
  await panel.getByRole('button', { name: 'Publish world state…' }).click()
  const confirm = panel.getByRole('region', { name: 'Publish world state?' })
  const summary = confirm.getByRole('group', { name: 'World-state changes' })
  await expect(summary).toContainText('2 assets: 0 added, 0 removed, 2 changed')
  await expect(summary).toContainText('Tank Company: health 100% → 35%')
  await expect(summary).toContainText('Recce Troop: position')
  await confirm.getByRole('button', { name: 'Publish world state', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(panel.getByText(/Unpublished edits/)).toHaveCount(0, { timeout: 20_000 })
  await expect(status(panel)).toHaveText('World state for turn 1: 6 assets')

  // 4. Red's map follows live (PLY-59).
  await redMap.getByRole('button', { name: 'Table', exact: true }).click()
  await redMap.getByRole('button', { name: 'Tank Company', exact: true }).click()
  await expect(redMap.getByRole('region', { name: 'Asset details' })).toContainText('Health35%', {
    timeout: 20_000,
  })
  expect(redErrors).toEqual([])
  expect(umpireErrors).toEqual([])
})
