// Act and adjudicate on the mock (WP 6.4; SRD Annex C PD6–PD9, PY-2, PY-8, PY-9, PR2; ADM-45,
// ADM-46, PLY-56). An admin script sends a message; a White Force script posts a proposal to the
// umpire room and the admin loads it into the draft after its change summary; publishing
// without review off and on; a White Force `on_message` handler answers a player; the pause
// holds for a player in adjudication while the White Force's script still posts; and hand
// edits in the draft survive an admin script. Pyodide runs from the build (py/).
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoViolations } from './a11y.ts'
import { isTileNoise, openMap, stubTiles } from './map.ts'
import { logIn } from './mock.ts'

const WIDE = { width: 1500, height: 950 }
const PYTHON_MS = 60_000
const BLUE_HQ = '30000000-0000-4000-8000-000000000001'

test.describe.configure({ mode: 'parallel' })
test.setTimeout(180_000)

function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !isTileNoise(m)) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

const scriptsTab = (page: Page) => page.getByRole('tab', { name: 'Scripts', exact: true })
const panelOf = (page: Page) => page.getByRole('region', { name: 'Scripts', exact: true })
const editorOf = (panel: Locator) => panel.getByRole('textbox', { name: /^Code of / })
const statusOf = (panel: Locator) => panel.locator('.wrx-scripts__status')
const outputOf = (panel: Locator) => panel.getByRole('region', { name: 'Output' })
const turnPanel = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Out-of-game column' })
    .getByRole('region', { name: 'Turn', exact: true })

async function signIn(page: Page, login: string): Promise<void> {
  await page.setViewportSize(WIDE)
  await page.goto('./')
  await logIn(page, login, `demo-${login}`)
  await expect(page.locator('.flexlayout__layout_main [role="tab"]').first()).toBeVisible({
    timeout: 20_000,
  })
}

async function openScripts(page: Page): Promise<Locator> {
  await expect(scriptsTab(page)).toBeVisible()
  if ((await scriptsTab(page).getAttribute('aria-selected')) !== 'true') {
    await scriptsTab(page).click()
  }
  const panel = panelOf(page)
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Loading the scripts…')).toHaveCount(0, { timeout: 20_000 })
  await expect(panel.getByText(/^Python is ready/)).toBeVisible({ timeout: PYTHON_MS })
  return panel
}

async function createScript(panel: Locator, name: string, code: string): Promise<void> {
  await panel.getByRole('button', { name: 'New script' }).click()
  await expect(panel.getByRole('heading', { level: 3, name: /^Untitled script/ })).toBeVisible()
  await panel.getByRole('button', { name: 'Rename…' }).click()
  const form = panel.getByRole('form', { name: /^Rename / })
  await form.getByLabel('New name').fill(name)
  await form.getByRole('button', { name: 'Rename' }).click()
  await expect(panel.getByRole('heading', { level: 3, name })).toBeVisible()
  await editorOf(panel).fill(code)
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(panel.getByText('(unsaved)')).toHaveCount(0)
}

async function runAndFinish(panel: Locator, name: string): Promise<void> {
  await panel.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(statusOf(panel)).toHaveText(new RegExp(`^${name} finished in `), {
    timeout: PYTHON_MS,
  })
}

/** A room's tab in the main area, and its panel. */
async function openRoom(page: Page, name: string): Promise<Locator> {
  await page.locator('.flexlayout__layout_main').getByRole('tab', { name, exact: true }).click()
  const room = page.getByRole('region', { name, exact: true })
  await expect(room).toBeVisible({ timeout: 20_000 })
  return room
}

const messagesOf = (room: Locator) => room.getByRole('article')

test('an admin script sends a message to a room, as the umpire (PY-2)', async ({ context }) => {
  const admin = await context.newPage()
  const errors = watch(admin)
  await signIn(admin, 'admin')
  const panel = await openScripts(admin)
  await createScript(
    panel,
    'Announce',
    `import wrx\ngame = wrx.Game()\nprint(await game.send_message("${BLUE_HQ}", "Umpire: contact report received."))\n`,
  )
  await runAndFinish(panel, 'Announce')
  const blue = await context.newPage()
  await signIn(blue, 'blue-co')
  const room = await openRoom(blue, 'Blue HQ')
  await expect(
    messagesOf(room).filter({ hasText: 'Umpire: contact report received.' }),
  ).toHaveCount(1, { timeout: 20_000 })
  await expect(
    messagesOf(room).filter({ hasText: 'Umpire: contact report received.' }),
  ).toContainText('Umpire')
  expect(errors).toEqual([])
})

test('a White Force script proposes a world state; the admin loads it into the draft after its summary (PD6, PY-8, ADM-46)', async ({
  context,
}, testInfo) => {
  await stubTiles(context)
  const white = await context.newPage()
  const errors = watch(white)
  await signIn(white, 'white-cell')
  const panel = await openScripts(white)
  await createScript(
    panel,
    'Propose',
    [
      'import wrx',
      'game = wrx.Game()',
      'state = await game.world_state()',
      'tank = next(a for a in state.assets.values() if a.title == "Tank Company")',
      'state.assets[tank.id] = tank.model_copy(update={"state": "damaged", "health": 40})',
      'print(await game.post_proposal(state, "Tank Company hit by artillery: damaged, 40%."))',
      '',
    ].join('\n'),
  )
  await runAndFinish(panel, 'Propose')
  // White Cell sees its proposal as a card, with nothing to load.
  const whiteRoom = await openRoom(white, 'Umpires')
  const whiteCard = whiteRoom.getByRole('region', { name: 'Proposed world state' })
  await expect(whiteCard).toContainText('Tank Company hit by artillery', { timeout: 20_000 })
  await expect(whiteCard.getByRole('button', { name: 'Load into draft…' })).toHaveCount(0)

  // Players never see the umpire room.
  const blue = await context.newPage()
  await signIn(blue, 'blue-co')
  await expect(
    blue.locator('.flexlayout__layout_main').getByRole('tab', { name: 'Umpires', exact: true }),
  ).toHaveCount(0)

  const admin = await context.newPage()
  const adminErrors = watch(admin)
  await signIn(admin, 'admin')
  await openMap(admin, 6)
  const room = await openRoom(admin, 'Umpires')
  const card = room.getByRole('region', { name: 'Proposed world state' })
  await expect(card).toContainText('Turn 1, 6 assets.', { timeout: 20_000 })
  await card.getByRole('button', { name: 'Load into draft…' }).click()
  const confirm = room.getByRole('alertdialog', { name: /^Load White Cell’s proposal/ })
  const summary = confirm.getByRole('group', { name: 'World-state changes' })
  await expect(summary).toContainText('1 asset: 0 added, 0 removed, 1 changed')
  await expect(summary).toContainText('Tank Company: state operational → damaged; health')
  await expectNoViolations(admin, testInfo, 'proposal load confirmation', {
    include: '.wrx-chat__proposal-load',
  })
  await confirm.getByRole('button', { name: 'Load into draft', exact: true }).click()
  await expect(room.getByText(/proposal is now your world-state draft/)).toBeVisible()
  const map = await openMap(admin, 6)
  await expect(map.getByText('Unpublished edits: 1 asset changed')).toBeVisible()
  expect(errors).toEqual([])
  expect(adminErrors).toEqual([])
})

const REFUEL = (fuel: number) =>
  [
    'import wrx',
    'game = wrx.Game()',
    'state = await game.draft()',
    'tank = next(a for a in state.assets.values() if a.title == "Tank Company")',
    `state.assets[tank.id] = tank.model_copy(update={"fuel": ${fuel}})`,
    'await game.write_draft(state)',
    '',
  ].join('\n')

test('publishing without review: off, a run fills the draft only; on, after a confirmation, it publishes and records it (PD7, PY-9, PR2)', async ({
  context,
}, testInfo) => {
  await stubTiles(context)
  const admin = await context.newPage()
  const errors = watch(admin)
  await signIn(admin, 'admin')
  const panel = await openScripts(admin)
  await createScript(panel, 'Refuel', REFUEL(33))
  const box = panel.getByRole('checkbox', { name: 'Publish without review' })
  await expect(box).not.toBeChecked()
  await runAndFinish(panel, 'Refuel')
  await expect(panel.getByText('The world-state draft was updated')).toBeVisible()
  await expect(panel.getByText(/Nothing is published\./)).toBeVisible()

  // On: it asks first, saying it changes the live map without review.
  // A click asks first; the box stays clear until the admin confirms.
  await box.click()
  const ask = panel.getByRole('alertdialog', { name: 'Publish without review for Refuel?' })
  await expect(ask).toContainText('It changes the live map without review')
  await expectNoViolations(admin, testInfo, 'publish-without-review confirmation', {
    include: '.wrx-scripts',
  })
  await ask.getByRole('button', { name: 'Turn on' }).click()
  await expect(box).toBeChecked()
  await editorOf(panel).fill(REFUEL(21))
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await runAndFinish(panel, 'Refuel')
  await expect(panel.getByText('The world state was published without review')).toBeVisible()
  const record = panel.getByRole('region', { name: 'Published without review' })
  await expect(record).toContainText(/Refuel published turn 1 at .*: changed Tank Company\./)

  // Every role sees it at once; the admin has no draft left.
  const red = await context.newPage()
  await signIn(red, 'red-co')
  const redMap = await openMap(red, 6)
  await redMap.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(redMap.getByRole('row').filter({ hasText: 'Tank Company' })).toContainText('21')
  const map = await openMap(admin, 6)
  await expect(map.getByText(/Unpublished edits/)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('hand edits in the draft survive an admin script (WP 6.4)', async ({ context }) => {
  await stubTiles(context)
  const admin = await context.newPage()
  await signIn(admin, 'admin')
  // By hand: A Squadron's health.
  const map = await openMap(admin, 6)
  await map.getByRole('button', { name: 'Table', exact: true }).click()
  await map.getByRole('button', { name: 'A Squadron', exact: true }).click()
  await map.locator('.wrx-map__details').getByRole('button', { name: 'Edit…' }).click()
  const form = map.getByRole('form', { name: 'Edit A Squadron' })
  await form.getByLabel('Health (%)', { exact: true }).fill('55')
  await form.getByRole('button', { name: 'Save to the draft' }).click()
  await expect(map.getByText('Unpublished edits: 1 asset changed')).toBeVisible()

  // A script that starts from the published state, not the draft, still keeps the hand edit.
  const panel = await openScripts(admin)
  await createScript(
    panel,
    'From published',
    [
      'import wrx',
      'game = wrx.Game()',
      'state = await game.world_state()',
      'tank = next(a for a in state.assets.values() if a.title == "Tank Company")',
      'state.assets[tank.id] = tank.model_copy(update={"fuel": 12})',
      'await game.write_draft(state)',
      '',
    ].join('\n'),
  )
  await runAndFinish(panel, 'From published')
  await expect(
    panel.getByText(/The script changed your draft: 1 asset changed; the rest of the draft/),
  ).toBeVisible()
  await expect(panel.getByText(/Against the published state: 2 assets changed\./)).toBeVisible()
  const after = await openMap(admin, 6)
  await expect(after.getByText('Unpublished edits: 2 assets changed')).toBeVisible()
  await after.getByRole('button', { name: 'Publish world state…' }).click()
  const summary = after
    .getByRole('region', { name: 'Publish world state?' })
    .getByRole('group', { name: 'World-state changes' })
  await expect(summary).toContainText('A Squadron: health 100% → 55%')
  await expect(summary).toContainText('Tank Company: fuel')
})

test('a White Force on_message handler answers a player; the pause holds for the player, not the White Force (PY-2, PLY-56)', async ({
  context,
}) => {
  const white = await context.newPage()
  const errors = watch(white)
  await signIn(white, 'white-cell')
  const panel = await openScripts(white)
  await createScript(
    panel,
    'Answer',
    [
      'import wrx',
      'game = wrx.Game()',
      '',
      `@game.on_message("${BLUE_HQ}")`,
      'async def answer(message):',
      '    text = message.body.content.text',
      '    print("heard", text, flush=True)',
      '    await game.send_message(message.roomId, "White Cell copies: " + text)',
      '    game.stop()',
      '',
      'print("listening", flush=True)',
      'await game.run_forever(seconds=60)',
      '',
    ].join('\n'),
  )
  await panel.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(outputOf(panel)).toContainText('listening', { timeout: PYTHON_MS })

  const blue = await context.newPage()
  await signIn(blue, 'blue-co')
  const room = await openRoom(blue, 'Blue HQ')
  const box = blue.getByRole('textbox', { name: 'Message Blue HQ', exact: true })
  await box.fill('Request fire support.')
  await box.press('Enter')
  await expect(
    messagesOf(room).filter({ hasText: 'White Cell copies: Request fire support.' }),
  ).toHaveCount(1, { timeout: 30_000 })
  await expect(statusOf(panel)).toHaveText(/^Answer finished in /, { timeout: 30_000 })
  await expect(outputOf(panel)).toContainText('heard Request fire support.')

  // Adjudication: the player's composer is paused (PLY-56); the White Force's script posts.
  const admin = await context.newPage()
  await signIn(admin, 'admin')
  await turnPanel(admin).getByRole('button', { name: 'Start adjudication…' }).click()
  const dialog = admin.getByRole('dialog', { name: 'Start adjudication?' })
  await dialog.getByRole('button', { name: 'Start adjudication', exact: true }).click()
  await expect(turnPanel(admin).getByRole('status')).toHaveText('Turn 1, Adjudication')
  await expect(box).toBeDisabled({ timeout: 20_000 })
  await editorOf(panel).fill(
    `import wrx\nprint(await wrx.Game().send_message("${BLUE_HQ}", "Adjudication under way."))\n`,
  )
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await panel.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(statusOf(panel)).toHaveText(/^Answer finished in /, { timeout: PYTHON_MS })
  await expect(messagesOf(room).filter({ hasText: 'Adjudication under way.' })).toHaveCount(1, {
    timeout: 20_000,
  })
  expect(errors).toEqual([])
})
