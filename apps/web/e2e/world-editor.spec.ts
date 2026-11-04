// The admin's world-state editor on the mock (WP 5.6): ADM-44, ADM-45, ADM-46, ADM-16, R25, R26.
// In the umpire's game view the admin edits an asset in the form, drags one, adds one with a
// click on the map and deletes one, into a draft held in this browser; Red, in the same browser's
// mock, sees nothing until the admin publishes. The change summary comes first, then Red's map
// follows live. The draft survives a reload and is discarded; a draft goes out with a phase change
// from the turn panel. The design export carries the draft, and an import makes the file's world
// state the draft again. Axe on the editor, the asset form and the summary. Tiles are local.
// (scenarios/world-state.spec.ts publishes once on both backends.)
import { expect, test } from '@playwright/test'
import type { Download, Locator, Page } from '@playwright/test'
import type { DesignFile } from '@wrx/schemas'
import { expectNoViolations } from './a11y.ts'
import { isTileNoise, mapPanel, openMap, stubTiles, symbols } from './map.ts'
import { logIn } from './mock.ts'

const WIDE = { width: 1500, height: 950 }

// Leaflet's zoom animations off, so a symbol is where it is drawn when the drag starts.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !isTileNoise(m)) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

const editor = (panel: Locator) => panel.getByRole('group', { name: 'World-state editor' })
const status = (panel: Locator) => panel.locator('.wrx-map__turn')
const side = (panel: Locator) => panel.locator('.wrx-map__details')
const turnPanel = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Out-of-game column' })
    .getByRole('region', { name: 'Turn', exact: true })

async function pickInTable(panel: Locator, title: string): Promise<void> {
  await panel.getByRole('button', { name: 'Table', exact: true }).click()
  await panel.getByRole('button', { name: title, exact: true }).click()
}

async function editField(panel: Locator, title: string, label: string, value: string) {
  await pickInTable(panel, title)
  await side(panel).getByRole('button', { name: 'Edit…' }).click()
  const form = panel.getByRole('form', { name: `Edit ${title}` })
  await form.getByLabel(label, { exact: true }).fill(value)
  await form.getByRole('button', { name: 'Save to the draft' }).click()
  await expect(form).toHaveCount(0)
}

async function admin(page: Page): Promise<Locator> {
  await page.setViewportSize(WIDE)
  await page.goto('./')
  await logIn(page, 'admin', 'demo-admin')
  return openMap(page, 6)
}

test('the admin edits, drags, adds and deletes into a browser draft, reviews the summary and publishes; Red sees it live (ADM-44–46, R25, R26)', async ({
  context,
}, testInfo) => {
  test.setTimeout(150_000)
  await stubTiles(context)
  const umpire = await context.newPage()
  const umpireErrors = watch(umpire)
  const panel = await admin(umpire)
  await expect(editor(panel)).toBeVisible()
  await expect(panel.getByText('kept as a draft in this browser until you publish')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Publish world state…' })).toBeDisabled()
  await expectNoViolations(umpire, testInfo, 'world-state editor', { include: '.wrx-map__editor' })

  const red = await context.newPage()
  const redErrors = watch(red)
  await red.setViewportSize(WIDE)
  await red.goto('./')
  await logIn(red, 'red-co', 'demo-red-co')
  const redMap = await openMap(red, 6)
  // Players are offered no editing (ADM-44).
  await expect(editor(redMap)).toHaveCount(0)

  // 1. The form: every fixed field, the symbol previewed, a bad code refused at its field.
  await pickInTable(panel, 'Tank Company')
  await side(panel).getByRole('button', { name: 'Edit…' }).click()
  const form = panel.getByRole('form', { name: 'Edit Tank Company' })
  for (const label of [
    'Title',
    'Force',
    'Category',
    'Symbol code (SIDC)',
    'Latitude',
    'Longitude',
    'State',
    'Health (%)',
    'Fuel (%)',
  ]) {
    await expect(form.getByLabel(label, { exact: true })).toBeVisible()
  }
  await expect(form.getByRole('img', { name: /Symbol preview/ })).toBeVisible()
  await form.getByLabel('Symbol code (SIDC)', { exact: true }).fill('nonsense')
  await expect(form.getByText('No symbol: the code is not valid.')).toBeVisible()
  await form.getByRole('button', { name: 'Save to the draft' }).click()
  await expect(form.getByText(/Enter a MIL-STD-2525\/APP-6 code/)).toBeVisible()
  await expectNoViolations(umpire, testInfo, 'asset form with an error', {
    include: '.wrx-asset-form',
  })
  await form.getByLabel('Symbol code (SIDC)', { exact: true }).fill('SHGPUCA----K---')
  await form.getByLabel('Health (%)', { exact: true }).fill('40')
  await form.getByLabel('State', { exact: true }).fill('damaged')
  await form.getByRole('button', { name: 'Save to the draft' }).click()
  await expect(panel.getByText('Unpublished edits: 1 asset changed')).toBeVisible()
  await expect(panel.getByText(/held only in this browser/)).toBeVisible()
  await expect(status(panel)).toHaveText('Your draft for turn 1: 6 assets, not published')

  // 2. A drag on the map moves a symbol in the draft.
  await panel.getByRole('button', { name: 'Map', exact: true }).click()
  await side(panel).getByRole('button', { name: 'Close' }).click()
  await panel.getByRole('button', { name: 'Show all assets' }).click()
  const squadron = panel.locator('img.wrx-map__symbol[alt="A Squadron"]')
  const box = await squadron.boundingBox()
  if (box === null) throw new Error('no symbol')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await umpire.mouse.move(x, y)
  await umpire.mouse.down()
  await umpire.mouse.move(x + 40, y + 30, { steps: 8 })
  await umpire.mouse.move(x + 80, y + 60, { steps: 8 })
  await umpire.mouse.up()
  await expect(panel.getByText('Unpublished edits: 2 assets changed')).toBeVisible()

  // 3. "Place on map", then a click where the new asset goes.
  await panel.getByRole('button', { name: 'Place on map' }).click()
  const canvas = panel.locator('.wrx-map__canvas')
  const area = await canvas.boundingBox()
  if (area === null) throw new Error('no map')
  await umpire.mouse.click(area.x + 60, area.y + area.height - 60)
  const add = panel.getByRole('form', { name: 'Add an asset' })
  await add.getByLabel('Title', { exact: true }).fill('Bridging Troop')
  await add.getByLabel('Category', { exact: true }).fill('engineers')
  await add.getByRole('button', { name: 'Add to the draft' }).click()
  await expect(symbols(panel)).toHaveCount(7)
  await expect(status(panel)).toHaveText('Your draft for turn 1: 7 assets, not published')

  // 4. Delete one, after a confirmation.
  await pickInTable(panel, 'Artillery Battery')
  await side(panel).getByRole('button', { name: 'Delete…' }).click()
  await panel.getByRole('button', { name: 'Delete from the draft' }).click()
  await expect(panel.getByText('Unpublished edits: 4 assets changed')).toBeVisible()

  // Red sees none of it (ADM-45).
  await expect(status(redMap)).toHaveText('World state for turn 1: 6 assets')
  await expect(redMap.locator('img.wrx-map__symbol[alt="Bridging Troop"]')).toHaveCount(0)

  // 5. The change summary, then the publish (ADM-46, R26).
  await panel.getByRole('button', { name: 'Publish world state…' }).click()
  const confirm = panel.getByRole('region', { name: 'Publish world state?' })
  const summary = confirm.getByRole('group', { name: 'World-state changes' })
  await expect(summary).toContainText('4 assets: 1 added, 1 removed, 2 changed')
  await expect(summary).toContainText('Bridging Troop (Blue)')
  await expect(summary).toContainText('Artillery Battery (Red)')
  await expect(summary).toContainText(
    'Tank Company: state operational → damaged; health 100% → 40%',
  )
  await expect(summary).toContainText('A Squadron: position')
  await expect(summary).toContainText('as one message of')
  await expectNoViolations(umpire, testInfo, 'world-state change summary', {
    include: '.wrx-map__confirm',
  })
  await confirm.getByRole('button', { name: 'Publish world state', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(status(panel)).toHaveText('World state for turn 1: 6 assets', { timeout: 20_000 })
  await expect(panel.getByText(/Unpublished edits/)).toHaveCount(0)

  // Red's map follows live (PLY-59).
  await expect(redMap.locator('img.wrx-map__symbol[alt="Bridging Troop"]')).toHaveCount(1, {
    timeout: 20_000,
  })
  await expect(redMap.locator('img.wrx-map__symbol[alt="Artillery Battery"]')).toHaveCount(0)
  await pickInTable(redMap, 'Tank Company')
  await expect(redMap.getByRole('region', { name: 'Asset details' })).toContainText('Health40%')

  expect(umpireErrors).toEqual([])
  expect(redErrors).toEqual([])
})

test('the draft survives a reload, is discarded, and goes out with a phase change from the turn panel (ADM-45, ADM-46)', async ({
  context,
}) => {
  test.setTimeout(150_000)
  await stubTiles(context)
  const umpire = await context.newPage()
  const errors = watch(umpire)
  let panel = await admin(umpire)
  await editField(panel, 'Tank Company', 'Fuel (%)', '15')
  await expect(panel.getByText('Unpublished edits: 1 asset changed')).toBeVisible()

  // Reloaded: the draft is still there (R25: this browser only).
  await umpire.reload()
  await logIn(umpire, 'admin', 'demo-admin')
  panel = await openMap(umpire, 6)
  await expect(panel.getByText('Unpublished edits: 1 asset changed')).toBeVisible()
  await panel.getByRole('button', { name: 'Discard draft…' }).click()
  await panel.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(panel.getByText(/Unpublished edits/)).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Discard draft…' })).toHaveCount(0)

  const blue = await context.newPage()
  await blue.setViewportSize(WIDE)
  await blue.goto('./')
  await logIn(blue, 'blue-co', 'demo-blue-co')
  const blueMap = await openMap(blue, 6)

  // A phase change with no edits publishes no world state.
  await turnPanel(umpire).getByRole('button', { name: 'Start adjudication…' }).click()
  let dialog = umpire.getByRole('dialog', { name: 'Start adjudication?' })
  await expect(dialog.getByText('World state', { exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Start adjudication', exact: true }).click()
  await expect(turnPanel(umpire).getByRole('status')).toHaveText('Turn 1, Adjudication')

  // In adjudication, the admin edits; starting turn 2 shows the summary and publishes the draft.
  await editField(panel, 'A Squadron', 'Health (%)', '55')
  await turnPanel(umpire).getByRole('button', { name: 'Start turn 2…' }).click()
  dialog = umpire.getByRole('dialog', { name: 'Start turn 2?' })
  await expect(dialog).toContainText('published with this change, for turn 2')
  await expect(dialog.getByRole('group', { name: 'World-state changes' })).toContainText(
    'A Squadron: health 100% → 55%',
  )
  await dialog.getByRole('button', { name: 'Start turn 2', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(status(blueMap)).toHaveText('World state for turn 2: 6 assets', { timeout: 20_000 })
  await expect(status(panel)).toHaveText('World state for turn 2: 6 assets')
  await expect(panel.getByText(/Unpublished edits/)).toHaveCount(0)

  // Blue reloads: the latest state from the archive.
  await blue.reload()
  await logIn(blue, 'blue-co', 'demo-blue-co')
  const again = await openMap(blue, 6)
  await expect(status(again)).toHaveText('World state for turn 2: 6 assets')
  expect(errors).toEqual([])
})

async function saved(download: Download): Promise<DesignFile> {
  const path = await download.path()
  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(path, 'utf8')) as DesignFile
}

test('the design export carries the world-state draft, and an import makes the file’s the draft (ADM-16)', async ({
  context,
}, testInfo) => {
  test.setTimeout(150_000)
  await stubTiles(context)
  const umpire = await context.newPage()
  const errors = watch(umpire)
  const panel = await admin(umpire)

  const backend = await context.newPage()
  await backend.setViewportSize(WIDE)
  await backend.goto('./#/admin')
  await logIn(backend, 'admin', 'demo-admin')
  await backend
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('button', { name: 'Publish', exact: false })
    .first()
    .click()

  // No draft: the export carries the published state.
  let download = backend.waitForEvent('download')
  await backend.getByRole('button', { name: 'Export the design' }).click()
  const published = await saved(await download)
  expect(published.schemaVersion).toBe(3)
  expect(Object.keys(published.worldState?.assets ?? {})).toHaveLength(6)

  // With a draft: the export carries the draft.
  await editField(panel, 'Recce Troop', 'Health (%)', '5')
  download = backend.waitForEvent('download')
  await backend.getByRole('button', { name: 'Export the design' }).click()
  const file = await saved(await download)
  const recce = Object.values(file.worldState?.assets ?? {}).find((a) => a.title === 'Recce Troop')
  expect(recce?.health).toBe(5)

  // Discard it; importing the file makes its world state the draft again (another tab sees it).
  await panel.getByRole('button', { name: 'Discard draft…' }).click()
  await panel.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(panel.getByText(/Unpublished edits/)).toHaveCount(0)
  await backend.getByLabel('Import a design…').setInputFiles({
    name: 'moved.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  })
  await backend.getByRole('button', { name: 'Replace the draft' }).click()
  await expect(backend.getByText('Imported moved.json.')).toBeVisible()
  await expect(
    backend.getByText(/is now your world-state draft, held in this browser/),
  ).toBeVisible()
  await expect(panel.getByText('Unpublished edits: 1 asset changed')).toBeVisible()
  // Players see it only once it is published (ADM-45); the import published nothing.
  await expect(status(mapPanel(umpire))).toHaveText(
    'Your draft for turn 1: 6 assets, not published',
  )

  // A version 2 file, from before world states, still imports.
  const { worldState: _world, ...rest } = file
  const v2 = { ...rest, schemaVersion: 2 }
  await backend.getByLabel('Import a design…').setInputFiles({
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(v2)),
  })
  await backend.getByRole('button', { name: 'Replace the draft' }).click()
  await expect(backend.getByText('Imported old.json.')).toBeVisible()
  await expectNoViolations(backend, testInfo, 'design import with a world state', {
    include: '.wrx-publish-panel',
  })
  expect(errors).toEqual([])
})

test('a reset offers to discard the world-state draft held for the game, unticked (ADM-15, WP 5.9 M3)', async ({
  context,
}, testInfo) => {
  test.setTimeout(150_000)
  await stubTiles(context)
  const umpire = await context.newPage()
  const errors = watch(umpire)
  const panel = await admin(umpire)
  await editField(panel, 'Recce Troop', 'Health (%)', '5')
  await expect(panel.getByText('Unpublished edits: 1 asset changed')).toBeVisible()

  const backend = await context.newPage()
  await backend.setViewportSize(WIDE)
  await backend.goto('./#/admin')
  await logIn(backend, 'admin', 'demo-admin')
  await backend
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('button', { name: 'Publish', exact: false })
    .first()
    .click()
  await backend.getByRole('button', { name: 'Plan a reset' }).click()
  const plan = backend.getByRole('region', { name: 'Reset plan' })
  await expect(plan).toBeVisible({ timeout: 30_000 })
  if (await backend.getByRole('button', { name: 'Unlock the vault' }).isVisible()) {
    await backend.getByRole('button', { name: 'Unlock the vault' }).click()
    const vault = backend.getByRole('alertdialog', { name: 'Unlock the vault' })
    await vault.getByLabel('Passphrase', { exact: true }).fill('demo-observer-vault')
    await vault.getByRole('button', { name: 'Unlock' }).click()
    await expect(backend.getByText('Vault unlocked.')).toBeVisible({ timeout: 30_000 })
  }
  await plan.getByRole('button', { name: 'Reset the game…' }).click()
  const confirm = backend.getByRole('alertdialog', { name: 'Reset the game?' })
  const offer = confirm.getByRole('checkbox', {
    name: /^Also discard the world-state draft held in this browser for this game \(6 assets, saved /,
  })
  await expect(offer).not.toBeChecked()
  await expectNoViolations(backend, testInfo, 'reset confirmation with the draft offer', {
    include: '.wrx-admin-dialog',
  })
  for (const box of await confirm.getByRole('checkbox').all()) await box.check()
  await confirm.getByLabel(/to confirm/).fill('Exercise Northern Gate')
  await confirm.getByRole('button', { name: 'Reset the game' }).click()
  await expect(backend.getByText(/Reset complete/)).toBeVisible({ timeout: 30_000 })
  // The draft is gone from this browser, in every tab.
  const drafts = await backend.evaluate(
    () => Object.keys(localStorage).filter((key) => key.includes('world-draft')).length,
  )
  expect(drafts).toBe(0)
  expect(errors).toEqual([])
})

test('the keyboard alone adds an asset and moves one, then publishes (ADM-44, NFR-14)', async ({
  context,
}, testInfo) => {
  test.setTimeout(120_000)
  await stubTiles(context)
  const umpire = await context.newPage()
  const errors = watch(umpire)
  const panel = await admin(umpire)
  const key = umpire.keyboard

  // Add: "Add asset…" opens the form with focus on it, at the assets' centre.
  await panel.getByRole('button', { name: 'Add asset…' }).focus()
  await key.press('Enter')
  const add = panel.getByRole('form', { name: 'Add an asset' })
  await expect(add.getByRole('heading', { name: 'Add an asset' })).toBeFocused()
  await key.press('Tab')
  await expect(add.getByLabel('Title', { exact: true })).toBeFocused()
  await key.type('Bridging Troop')
  await key.press('Tab')
  await expect(add.getByLabel('Force', { exact: true })).toBeFocused()
  await key.press('Tab')
  await key.type('engineers')
  await add.getByLabel('Latitude', { exact: true }).focus()
  await key.press('ControlOrMeta+A')
  await key.type('51.99')
  await key.press('Tab')
  await expect(add.getByLabel('Longitude', { exact: true })).toBeFocused()
  await key.press('ControlOrMeta+A')
  await key.type('5.9')
  // Enter in a field submits the form.
  await key.press('Enter')
  await expect(add).toHaveCount(0)
  // Focus goes back to the button that opened the form.
  await expect(panel.getByRole('button', { name: 'Add asset…' })).toBeFocused()
  await expect(panel.getByText('Unpublished edits: 1 asset changed')).toBeVisible()
  await expect(symbols(panel)).toHaveCount(7)

  // Move: the table's row, then "Edit…", then the latitude and longitude, in place of a drag.
  await panel.getByRole('button', { name: 'Table', exact: true }).focus()
  await key.press('Enter')
  const row = panel.getByRole('button', { name: 'A Squadron', exact: true })
  await row.focus()
  await key.press('Enter')
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await side(panel).getByRole('button', { name: 'Edit…' }).focus()
  await key.press('Enter')
  const form = panel.getByRole('form', { name: 'Edit A Squadron' })
  await expect(form.getByRole('heading', { name: 'Edit A Squadron' })).toBeFocused()
  await form.getByLabel('Latitude', { exact: true }).focus()
  await key.press('ControlOrMeta+A')
  await key.type('51.96')
  await key.press('Tab')
  await key.press('ControlOrMeta+A')
  await key.type('5.86')
  await key.press('Enter')
  await expect(form).toHaveCount(0)
  await expect(side(panel).getByRole('button', { name: 'Edit…' })).toBeFocused()
  await expect(panel.getByText('Unpublished edits: 2 assets changed')).toBeVisible()
  await expect(panel.getByRole('region', { name: 'Asset details' })).toContainText(
    '51.9600° N, 5.8600° E',
  )
  await expectNoViolations(umpire, testInfo, 'world-state editor in the table, with a draft', {
    include: '.wrx-map',
  })

  // Publish: the summary takes focus; its button publishes.
  await panel.getByRole('button', { name: 'Publish world state…' }).focus()
  await key.press('Enter')
  const confirm = panel.getByRole('region', { name: 'Publish world state?' })
  await expect(confirm.getByRole('heading', { name: 'Publish world state?' })).toBeFocused()
  await confirm.getByRole('button', { name: 'Publish world state', exact: true }).focus()
  await key.press('Enter')
  await expect(panel.getByText(/Unpublished edits/)).toHaveCount(0, { timeout: 20_000 })
  expect(errors).toEqual([])
})
