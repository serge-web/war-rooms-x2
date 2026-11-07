// SC-12 The umpires adjudicate with Python (SRD §12, Annex C). Traces to: PD4, PD6, PD7, PD8,
// PD9, PY-2, PY-6, PY-8, PY-9, ADM-45, ADM-46.
//
// White Cell, a White Force role, runs a script in its Scripts panel that reads the world state,
// marks the Tank Company damaged at 40% and posts it to the umpire room as a proposal. The admin,
// the umpire in its own game view, sees the card in the umpire room, reviews the proposal's
// change summary and loads it into the world-state draft; nothing is published. The admin moves
// 1st Rifles by hand in the asset form, then runs an admin script that reads the draft and sets
// the Tank Company's fuel: the script's change lands on top of the draft, and the hand edit is
// kept (PY-9). "Publish world state…" shows all three changes; the admin publishes, and Blue
// CO's map, open throughout, shows the new state without a reload. Blue CO is offered no Scripts
// tab and never sees the umpire room (PD4, PD8). Both backends; Pyodide runs from the build.
import type { Locator, Page } from '@playwright/test'
import { expectNoViolations } from '../a11y.ts'
import { openMap } from '../map.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const WIDE = { width: 1500, height: 950 }
/** Pyodide's start, and a first run's imports (pydantic), on a loaded machine. */
const PYTHON_MS = 90_000
const UMPIRES = 'Umpires'

// Leaflet's zoom animations off, so the map settles at once.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

const mainTab = (page: Page, name: string) =>
  page.locator('.flexlayout__layout_main').getByRole('tab', { name, exact: true })
const scriptsTab = (page: Page) => page.getByRole('tab', { name: 'Scripts', exact: true })
const turnStatus = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Out-of-game column' })
    .getByRole('region', { name: 'Turn', exact: true })
    .getByRole('status')
const side = (panel: Locator) => panel.locator('.wrx-map__details')

async function signIn(page: Page, backend: Parameters<typeof logInAs>[1], id: string) {
  await page.setViewportSize(WIDE)
  await openApp(page, backend)
  await logInAs(page, backend, id)
  await expect(turnStatus(page)).toHaveText('Turn 1, Planning', { timeout: 20_000 })
}

/** Shows the Scripts panel and waits for Python. */
async function openScripts(page: Page): Promise<Locator> {
  await expect(scriptsTab(page)).toBeVisible()
  if ((await scriptsTab(page).getAttribute('aria-selected')) !== 'true') {
    await scriptsTab(page).click()
  }
  const panel = page.getByRole('region', { name: 'Scripts', exact: true })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Loading the scripts…')).toHaveCount(0, { timeout: 20_000 })
  await expect(panel.getByText(/^Python is ready/)).toBeVisible({ timeout: PYTHON_MS })
  return panel
}

/** Makes a script with a name and code, saved to the account's private storage (PY-7). */
async function createScript(panel: Locator, name: string, code: string): Promise<void> {
  await panel.getByRole('button', { name: 'New script' }).click()
  await expect(panel.getByRole('heading', { level: 3, name: /^Untitled script/ })).toBeVisible()
  await panel.getByRole('button', { name: 'Rename…' }).click()
  const form = panel.getByRole('form', { name: /^Rename / })
  await form.getByLabel('New name').fill(name)
  await form.getByRole('button', { name: 'Rename' }).click()
  await expect(panel.getByRole('heading', { level: 3, name })).toBeVisible()
  await panel.getByRole('textbox', { name: /^Code of / }).fill(code)
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(panel.getByText('(unsaved)')).toHaveCount(0, { timeout: 20_000 })
}

async function runToTheEnd(panel: Locator, name: string): Promise<void> {
  await panel.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(panel.locator('.wrx-scripts__status')).toHaveText(
    new RegExp(`^${name} finished in `),
    { timeout: PYTHON_MS },
  )
}

/** An asset's details, picked from the map room's table. */
async function details(map: Locator, title: string): Promise<Locator> {
  await map.getByRole('button', { name: 'Table', exact: true }).click()
  const row = map.getByRole('button', { name: title, exact: true })
  // A second press on the selected asset's row would close its details.
  if ((await row.getAttribute('aria-pressed')) !== 'true') await row.click()
  return map.getByRole('region', { name: 'Asset details' })
}

const PROPOSE = [
  'import wrx',
  'game = wrx.Game()',
  'state = await game.world_state()',
  'tank = next(a for a in state.assets.values() if a.title == "Tank Company")',
  'state.assets[tank.id] = tank.model_copy(update={"state": "damaged", "health": 40})',
  'print(await game.post_proposal(state, "Tank Company hit by artillery: damaged, 40%."))',
  '',
].join('\n')

const REFUEL = [
  'import wrx',
  'game = wrx.Game()',
  'state = await game.draft()',
  'tank = next(a for a in state.assets.values() if a.title == "Tank Company")',
  'state.assets[tank.id] = tank.model_copy(update={"fuel": 35})',
  'await game.write_draft(state)',
  'print("refuelled", tank.title)',
  '',
].join('\n')

test('SC-12: the White Force proposes from a script, the admin loads it, adjusts the draft with a script on top of a hand edit, reviews and publishes; players see the map, never the scripts (PD4, PD6–PD9, PY-2, PY-6, PY-8, PY-9, ADM-45, ADM-46)', async ({
  context,
  backend,
}, testInfo) => {
  test.setTimeout(420_000)
  // Scripts follow the login (PD5), and a server reset keeps the admin's account, so an earlier
  // run's scripts may still be there on ejabberd: this run's names are its own.
  const tag = Date.now().toString(36)
  const strike = `Artillery strike ${tag}`
  const refuel = `Refuel ${tag}`

  // Blue CO watches the map throughout; it has no Scripts tab and no umpire room (PD4, PD8).
  const blue = await context.newPage()
  const blueErrors = watchErrors(blue)
  await signIn(blue, backend, 'blue-co')
  const blueMap = await openMap(blue, 6)
  await expect(scriptsTab(blue)).toHaveCount(0)
  await expect(mainTab(blue, UMPIRES)).toHaveCount(0)

  // 1. White Cell's script proposes a world state in the umpire room (PD6, PY-8).
  const white = await context.newPage()
  const whiteErrors = watchErrors(white)
  await signIn(white, backend, 'white-cell')
  const whiteScripts = await openScripts(white)
  await createScript(whiteScripts, strike, PROPOSE)
  await runToTheEnd(whiteScripts, strike)
  await mainTab(white, UMPIRES).click()
  const whiteCard = white
    .getByRole('region', { name: UMPIRES, exact: true })
    .getByRole('region', { name: 'Proposed world state' })
  await expect(whiteCard).toContainText('Tank Company hit by artillery', { timeout: 20_000 })
  // The White Force sees the card only: loading is the admin's (PD6).
  await expect(whiteCard.getByRole('button', { name: 'Load into draft…' })).toHaveCount(0)

  // 2. The admin loads it into the draft after its change summary (ADM-46). Nothing is published.
  const admin = await context.newPage()
  const adminErrors = watchErrors(admin)
  await signIn(admin, backend, 'admin')
  const map = await openMap(admin, 6)
  await expect(map.getByRole('group', { name: 'World-state editor' })).toBeVisible()
  await mainTab(admin, UMPIRES).click()
  const umpires = admin.getByRole('region', { name: UMPIRES, exact: true })
  const card = umpires.getByRole('region', { name: 'Proposed world state' })
  await expect(card).toContainText('Turn 1, 6 assets.', { timeout: 20_000 })
  await card.getByRole('button', { name: 'Load into draft…' }).click()
  const load = umpires.getByRole('alertdialog', { name: /^Load White Cell’s proposal/ })
  const proposed = load.getByRole('group', { name: 'World-state changes' })
  await expect(proposed).toContainText('1 asset: 0 added, 0 removed, 1 changed')
  await expect(proposed).toContainText('Tank Company: state operational → damaged; health')
  await expectNoViolations(admin, testInfo, 'SC-12 proposal load confirmation', {
    include: '.wrx-chat__proposal-load',
  })
  await load.getByRole('button', { name: 'Load into draft', exact: true }).click()
  await expect(umpires.getByText(/proposal is now your world-state draft/)).toBeVisible()

  // 3. A hand edit: 1st Rifles moved in the asset form (NFR-14's keyboard way to move).
  await openMap(admin, 6)
  await expect(map.getByText('Unpublished edits: 1 asset changed')).toBeVisible()
  await map.getByRole('button', { name: 'Table', exact: true }).click()
  await map.getByRole('button', { name: '1st Rifles', exact: true }).click()
  await side(map).getByRole('button', { name: 'Edit…' }).click()
  const form = map.getByRole('form', { name: 'Edit 1st Rifles' })
  await form.getByLabel('Latitude', { exact: true }).fill('51.995')
  await form.getByLabel('Longitude', { exact: true }).fill('5.885')
  await form.getByRole('button', { name: 'Save to the draft' }).click()
  await expect(form).toHaveCount(0)
  await expect(map.getByText('Unpublished edits: 2 assets changed')).toBeVisible()

  // 4. An admin script adjusts the draft; its change lands on top, the hand edit kept (PY-9, PD9).
  const scripts = await openScripts(admin)
  await createScript(scripts, refuel, REFUEL)
  await expect(scripts.getByRole('checkbox', { name: 'Publish without review' })).not.toBeChecked()
  await runToTheEnd(scripts, refuel)
  await expect(scripts.getByRole('region', { name: 'Output' })).toContainText(
    'refuelled Tank Company',
  )
  await expect(
    scripts.getByText(/The script changed your draft: 1 asset changed; the rest of the draft/),
  ).toBeVisible()
  await expect(scripts.getByText(/Against the published state: 2 assets changed\./)).toBeVisible()
  await expect(scripts.getByText(/Nothing is published\./)).toBeVisible()
  // Blue still sees the published state.
  await expect(await details(blueMap, 'Tank Company')).toContainText('Health100%')

  // 5. The admin reviews the change summary and publishes (ADM-45, ADM-46).
  await openMap(admin, 6)
  await expect(map.getByText('Unpublished edits: 2 assets changed')).toBeVisible()
  await map.getByRole('button', { name: 'Publish world state…' }).click()
  const confirm = map.getByRole('region', { name: 'Publish world state?' })
  const summary = confirm.getByRole('group', { name: 'World-state changes' })
  await expect(summary).toContainText('2 assets: 0 added, 0 removed, 2 changed')
  await expect(summary).toContainText('1st Rifles: position')
  await expect(summary).toContainText('Tank Company: state operational → damaged; health')
  await expect(summary).toContainText('fuel 100% → 35%')
  await confirm.getByRole('button', { name: 'Publish world state', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(map.getByText(/Unpublished edits/)).toHaveCount(0, { timeout: 20_000 })

  // 6. Blue CO's map shows the new state without a reload; still no Scripts and no umpire room.
  const tank = await details(blueMap, 'Tank Company')
  await expect(tank).toContainText('Health40%', { timeout: 20_000 })
  await expect(tank).toContainText('Fuel35%')
  await expect(await details(blueMap, '1st Rifles')).toContainText('51.9950° N, 5.8850° E')
  await expect(scriptsTab(blue)).toHaveCount(0)
  await expect(mainTab(blue, UMPIRES)).toHaveCount(0)
  for (const page of [admin, white, blue]) {
    await expect(turnStatus(page)).toHaveText('Turn 1, Planning')
  }

  expect(blueErrors).toEqual([])
  expect(whiteErrors).toEqual([])
  expect(adminErrors).toEqual([])
})
