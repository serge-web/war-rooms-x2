// SC-11 Admin runs a turn and updates the map (SRD §12). Traces to: ADM-43–46, PLY-55–59, D7, D25.
//
// Blue CO and Red CO chat in turn 1 planning and see the admin's initial world state in the map
// room. The admin, the umpire in its own game view (where the world-state editor is, WP 5.6),
// starts adjudication: every turn panel follows, and Blue's and Red's composers pause with why.
// The admin moves two Blue assets, reduces a Red asset's health and adds a Red asset, all in the
// asset form (its latitude and longitude are the keyboard's way to move, NFR-14), into a draft
// held only in this browser, which players do not see. Starting turn 2 shows the change summary
// in the confirmation and publishes the draft with the phase change: both maps show turn 2 and
// the composers work again. Red CO reloads and the map room finds the newest state in MAM. In
// turn 2 the admin corrects a Blue asset and publishes from "Publish world state", with its own
// summary, and both players see it with no phase change. Both backends.
import type { Locator, Page } from '@playwright/test'
import { expectNoViolations } from '../a11y.ts'
import { openMap, symbols } from '../map.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const WIDE = { width: 1500, height: 950 }
const TALKS = 'Blue–Red negotiation'
const PAUSED = /The game is in adjudication, so posting is paused for your role/

// Leaflet's zoom animations off, so the map settles at once.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const column = (page: Page) => page.getByRole('complementary', { name: 'Out-of-game column' })
const turnPanel = (page: Page) => column(page).getByRole('region', { name: 'Turn', exact: true })
const turnStatus = (page: Page) => turnPanel(page).getByRole('status')
const roomTab = (page: Page, name: string) =>
  page.locator('.flexlayout__layout_main').getByRole('tab', { name, exact: true })
const box = (page: Page, room: string) =>
  page.getByRole('textbox', { name: `Message ${room}`, exact: true })
const room = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const messages = (page: Page, name: string) =>
  page.getByRole('region', { name: `Messages in ${name}`, exact: true })
const mapStatus = (panel: Locator) => panel.locator('.wrx-map__turn')
const side = (panel: Locator) => panel.locator('.wrx-map__details')

/** Picks an asset from the table and shows its details. */
async function pick(panel: Locator, title: string): Promise<void> {
  await panel.getByRole('button', { name: 'Table', exact: true }).click()
  await panel.getByRole('button', { name: title, exact: true }).click()
}

/** Opens an asset's form, fills the fields and saves it to the draft. */
async function edit(
  panel: Locator,
  title: string,
  fields: Readonly<Record<string, string>>,
): Promise<void> {
  await pick(panel, title)
  await side(panel).getByRole('button', { name: 'Edit…' }).click()
  const form = panel.getByRole('form', { name: `Edit ${title}` })
  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value)
  }
  await form.getByRole('button', { name: 'Save to the draft' }).click()
  await expect(form).toHaveCount(0)
}

/** The details a player sees for an asset, from the table. */
async function details(panel: Locator, title: string): Promise<Locator> {
  await pick(panel, title)
  return panel.getByRole('region', { name: 'Asset details' })
}

test('SC-11: the admin runs a turn and publishes the world state with the phase change and on its own; every player sees the latest (ADM-43–46, PLY-55–59, D7, D25)', async ({
  context,
  backend,
}, testInfo) => {
  test.setTimeout(240_000)
  const player = async (id: string) => {
    const page = await context.newPage()
    await page.setViewportSize(WIDE)
    const errors = watchErrors(page)
    await openApp(page, backend)
    await logInAs(page, backend, id)
    await expect(turnStatus(page)).toHaveText('Turn 1, Planning', { timeout: 20_000 })
    return { page, errors }
  }
  const { page: blue, errors: blueErrors } = await player('blue-co')
  const { page: red, errors: redErrors } = await player('red-co')

  // 1. Turn 1 planning: the players chat, and the map room shows the initial world state.
  await roomTab(blue, TALKS).click()
  await box(blue, TALKS).fill('Blue proposes a ceasefire at the crossing.')
  await box(blue, TALKS).press('Enter')
  await roomTab(red, TALKS).click()
  await expect(messages(red, TALKS)).toContainText('Blue proposes a ceasefire at the crossing.', {
    timeout: 20_000,
  })
  await box(red, TALKS).fill('Red will consider it.')
  await box(red, TALKS).press('Enter')
  await expect(messages(blue, TALKS)).toContainText('Red will consider it.', { timeout: 20_000 })
  const blueMap = await openMap(blue, 6)
  const redMap = await openMap(red, 6)
  await expect(mapStatus(blueMap)).toHaveText('World state for turn 1: 6 assets')
  await expect(mapStatus(redMap)).toHaveText('World state for turn 1: 6 assets')

  const umpire = await context.newPage()
  await umpire.setViewportSize(WIDE)
  const umpireErrors = watchErrors(umpire)
  await openApp(umpire, backend)
  await logInAs(umpire, backend, 'admin')
  await expect(turnStatus(umpire)).toHaveText('Turn 1, Planning', { timeout: 20_000 })
  const panel = await openMap(umpire, 6)
  await expect(panel.getByRole('group', { name: 'World-state editor' })).toBeVisible()

  // 2. Adjudication: every turn panel follows; Blue's and Red's composers pause, with why.
  await turnPanel(umpire).getByRole('button', { name: 'Start adjudication…' }).click()
  const start = umpire.getByRole('dialog', { name: 'Start adjudication?' })
  await start.getByRole('button', { name: 'Start adjudication', exact: true }).click()
  await expect(start).toHaveCount(0)
  for (const page of [umpire, blue, red]) {
    await expect(turnStatus(page)).toHaveText('Turn 1, Adjudication', { timeout: 20_000 })
  }
  for (const page of [blue, red]) {
    await roomTab(page, TALKS).click()
    await expect(room(page, TALKS).getByText(PAUSED)).toBeVisible()
    await expect(box(page, TALKS)).not.toBeEditable()
    await expect(
      room(page, TALKS).getByRole('button', { name: 'Send', exact: true }),
    ).toBeDisabled()
  }

  // 3. The admin's edits: two Blue assets moved, a Red asset's health down, a Red asset added.
  await edit(panel, '1st Rifles', { Latitude: '51.995', Longitude: '5.885' })
  await edit(panel, 'Recce Troop', { Latitude: '51.99', Longitude: '5.92' })
  await edit(panel, 'Tank Company', { 'Health (%)': '40' })
  await panel.getByRole('button', { name: 'Add asset…' }).click()
  const add = panel.getByRole('form', { name: 'Add an asset' })
  await add.getByLabel('Title', { exact: true }).fill('Mortar Platoon')
  await add.getByLabel('Force', { exact: true }).selectOption({ label: 'Red' })
  await add.getByLabel('Category', { exact: true }).fill('artillery')
  await add.getByLabel('Symbol code (SIDC)', { exact: true }).fill('SHGPUCF----K---')
  await add.getByLabel('Latitude', { exact: true }).fill('52.03')
  await add.getByLabel('Longitude', { exact: true }).fill('5.92')
  await add.getByRole('button', { name: 'Add to the draft' }).click()
  await expect(add).toHaveCount(0)
  // The map shows unpublished edits, held only in this browser (ADM-45, R25).
  await expect(panel.getByText('Unpublished edits: 4 assets changed')).toBeVisible()
  await expect(panel.getByText(/held only in this browser/)).toBeVisible()
  await expect(mapStatus(panel)).toHaveText('Your draft for turn 1: 7 assets, not published')
  // Players still see the published state.
  await expect(mapStatus(blueMap)).toHaveText('World state for turn 1: 6 assets')
  await expect(mapStatus(redMap)).toHaveText('World state for turn 1: 6 assets')

  // 4. Turn 2 planning: the confirmation shows the change summary (ADM-46); the admin confirms.
  await turnPanel(umpire).getByRole('button', { name: 'Start turn 2…' }).click()
  const next = umpire.getByRole('dialog', { name: 'Start turn 2?' })
  await expect(next).toContainText('published with this change, for turn 2')
  const summary = next.getByRole('group', { name: 'World-state changes' })
  await expect(summary).toContainText('4 assets: 1 added, 0 removed, 3 changed')
  await expect(summary).toContainText('Mortar Platoon (Red)')
  await expect(summary).toContainText('1st Rifles: position')
  await expect(summary).toContainText('Recce Troop: position')
  await expect(summary).toContainText('Tank Company: health 100% → 40%')
  await expectNoViolations(umpire, testInfo, 'turn confirmation with the world-state summary', {
    include: '[role="dialog"]',
  })
  await next.getByRole('button', { name: 'Start turn 2', exact: true }).click()
  await expect(next).toHaveCount(0)
  await expect(turnStatus(umpire)).toHaveText('Turn 2, Planning')
  await expect(mapStatus(panel)).toHaveText('World state for turn 2: 7 assets', {
    timeout: 20_000,
  })
  await expect(panel.getByText(/Unpublished edits/)).toHaveCount(0)

  // 5. Both maps show the new state; the composers work again.
  for (const [page, map] of [
    [blue, blueMap],
    [red, redMap],
  ] as const) {
    await expect(turnStatus(page)).toHaveText('Turn 2, Planning', { timeout: 20_000 })
    await expect(mapStatus(map)).toHaveText('World state for turn 2: 7 assets', {
      timeout: 20_000,
    })
    await expect(map.locator('img.wrx-map__symbol[alt="Mortar Platoon"]')).toHaveCount(1)
    await expect(await details(map, 'Tank Company')).toContainText('Health40%')
    await expect(await details(map, 'Recce Troop')).toContainText('51.9900° N, 5.9200° E')
  }
  await roomTab(red, TALKS).click()
  await expect(room(red, TALKS).getByText(PAUSED)).toHaveCount(0)
  await box(red, TALKS).fill('Red accepts the ceasefire.')
  await box(red, TALKS).press('Enter')
  await expect(box(red, TALKS)).toHaveValue('')
  await roomTab(blue, TALKS).click()
  await expect(messages(blue, TALKS)).toContainText('Red accepts the ceasefire.', {
    timeout: 20_000,
  })

  // 6. Red CO reloads: the map room pages back through MAM to the newest world state (PLY-59).
  await red.reload()
  await logInAs(red, backend, 'red-co')
  const redAgain = await openMap(red, 7)
  await expect(mapStatus(redAgain)).toHaveText('World state for turn 2: 7 assets')
  await expect(redAgain.locator('img.wrx-map__symbol[alt="Mortar Platoon"]')).toHaveCount(1)
  await expect(await details(redAgain, 'Tank Company')).toContainText('Health40%')

  // 7. Turn 2 planning: a Blue asset is in the wrong place. The admin corrects it and publishes
  // on its own, after the summary; every player sees it with no phase change (ADM-45, ADM-46).
  await edit(panel, '1st Rifles', { Latitude: '51.98', Longitude: '5.875' })
  await expect(panel.getByText('Unpublished edits: 1 asset changed')).toBeVisible()
  await panel.getByRole('button', { name: 'Publish world state…' }).click()
  const confirm = panel.getByRole('region', { name: 'Publish world state?' })
  const own = confirm.getByRole('group', { name: 'World-state changes' })
  await expect(own).toContainText('1 asset: 0 added, 0 removed, 1 changed')
  await expect(own).toContainText('1st Rifles: position 51.9950° N, 5.8850° E → 51.9800° N')
  await confirm.getByRole('button', { name: 'Publish world state', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(panel.getByText(/Unpublished edits/)).toHaveCount(0, { timeout: 20_000 })
  for (const map of [blueMap, redAgain]) {
    await expect(await details(map, '1st Rifles')).toContainText('51.9800° N, 5.8750° E', {
      timeout: 20_000,
    })
    await expect(mapStatus(map)).toHaveText('World state for turn 2: 7 assets')
    await expect(symbols(map)).toHaveCount(7)
  }
  for (const page of [umpire, blue, red]) {
    await expect(turnStatus(page)).toHaveText('Turn 2, Planning')
  }

  expect(blueErrors).toEqual([])
  expect(redErrors).toEqual([])
  expect(umpireErrors).toEqual([])
})
