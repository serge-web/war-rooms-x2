// The Scripts panel on the mock (WP 6.3; SRD Annex C PD4, PD5, PD7, PD9, PY-6, PY-7, PY-10, PR1;
// ADM-45, ADM-46; NFR-14). The admin's script reads the world state and moves an asset into the
// draft, and the map room's change summary shows it, unpublished; a White Force script reads its
// rooms; Stop and the time limit leave the draft as it was; players, observers and the admin's
// preview as a role get no panel; an export imports back; a reload keeps the scripts; and two
// sessions of one role see each other's edits, with the version check. Axe on the panel, the
// editor, the output and the confirmations. Pyodide runs from the build (py/), so each test that
// runs a script waits for it to start.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoViolations } from './a11y.ts'
import { isTileNoise, openMap, stubTiles } from './map.ts'
import { logIn } from './mock.ts'

const WIDE = { width: 1500, height: 950 }
const PYTHON_MS = 60_000

test.describe.configure({ mode: 'parallel' })
test.setTimeout(150_000)

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

async function signIn(page: Page, login: string): Promise<void> {
  await page.setViewportSize(WIDE)
  await page.goto('./')
  await logIn(page, login, `demo-${login}`)
  await expect(page.locator('.flexlayout__layout_main [role="tab"]').first()).toBeVisible({
    timeout: 20_000,
  })
}

/** Opens the Scripts tab in the strip along the bottom, docked into the main area for room. */
async function openScripts(page: Page): Promise<Locator> {
  // A restored layout may have it open already, and a second click would close it.
  await expect(scriptsTab(page)).toBeVisible()
  if ((await scriptsTab(page).getAttribute('aria-selected')) !== 'true') {
    await scriptsTab(page).click()
  }
  const panel = panelOf(page)
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Loading the scripts…')).toHaveCount(0, { timeout: 20_000 })
  return panel
}

async function pythonReady(panel: Locator): Promise<void> {
  await expect(panel.getByText(/^Python is ready/)).toBeVisible({ timeout: PYTHON_MS })
}

/** A new script with `code`, saved under `name`. */
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

async function runScript(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Run', exact: true }).click()
}

const MOVE = `import wrx
import wrx_draft

game = wrx.Game()
state = await game.world_state()
asset = next(a for a in state.assets.values() if a.title == "Tank Company")
state.assets[asset.id] = asset.model_copy(update={"lat": asset.lat + 0.25})
print("Moved", asset.title)
await wrx_draft.write_draft(state)
`

test('the admin’s script reads the world state and moves an asset; the change summary shows it, unpublished (PY-6, PD7, PD9, ADM-45, ADM-46)', async ({
  context,
}, testInfo) => {
  await stubTiles(context)
  const page = await context.newPage()
  const errors = watch(page)
  await signIn(page, 'admin')
  const panel = await openScripts(page)
  await expect(panel.getByText('They run as the admin (Umpire).')).toBeVisible()
  await expect(panel.getByText('No scripts yet. Create one, or import a file.')).toBeVisible()
  await expectNoViolations(page, testInfo, 'script panel, empty', { include: '.wrx-scripts' })
  await createScript(panel, 'Move the tanks', MOVE)
  await pythonReady(panel)
  await runScript(panel)
  await expect(statusOf(panel)).toHaveText(/^Move the tanks finished in /, { timeout: PYTHON_MS })
  await expect(outputOf(panel)).toContainText('Moved Tank Company')
  await expect(panel.getByText('The world-state draft was updated')).toBeVisible()
  await expect(panel.getByText(/1 asset changed\. Nothing is published\./)).toBeVisible()
  await expectNoViolations(page, testInfo, 'script panel after a run, with the editor and output', {
    include: '.wrx-scripts',
  })

  // The map room shows the draft and its change summary; nothing was published (PD7).
  const map = await openMap(page, 6)
  await expect(map.getByText('Unpublished edits: 1 asset changed')).toBeVisible()
  await map.getByRole('button', { name: 'Publish world state…' }).click()
  const confirm = map.getByRole('region', { name: 'Publish world state?' })
  const summary = confirm.getByRole('group', { name: 'World-state changes' })
  await expect(summary).toContainText('1 asset: 0 added, 0 removed, 1 changed')
  await expect(summary).toContainText('Tank Company: position')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  expect(errors).toEqual([])
})

test('a White Force script reads its rooms; a failure shows the Python traceback (PD4, PY-6)', async ({
  page,
}, testInfo) => {
  const errors = watch(page)
  await signIn(page, 'white-cell')
  const panel = await openScripts(page)
  await expect(panel.getByText(/They run as White Cell, with its access\./)).toBeVisible()
  await createScript(
    panel,
    'Rooms',
    `import wrx\n\nfor room in await wrx.Game().rooms():\n    print("room:", room.name)\n`,
  )
  await runScript(panel)
  await expect(statusOf(panel)).toHaveText(/^Rooms finished in /, { timeout: PYTHON_MS })
  await expect(outputOf(panel)).toContainText('room: Map')
  await expect(outputOf(panel)).toContainText('room: Blue HQ')
  // No draft for the White Force: a write is refused by the bridge (PD4).
  await expect(panel.getByText('The world-state draft was updated')).toHaveCount(0)

  await editorOf(panel).fill(
    'import sys\nprint("to stderr", file=sys.stderr)\nraise ValueError("bad move")\n',
  )
  await runScript(panel)
  await expect(statusOf(panel)).toHaveText(/^Rooms failed after /, { timeout: PYTHON_MS })
  const error = panel.getByRole('region', { name: 'Error' })
  await expect(error).toContainText('Traceback')
  await expect(error).toContainText('ValueError: bad move')
  await expect(outputOf(panel).locator('.wrx-scripts__stderr')).toContainText('to stderr')
  await expectNoViolations(page, testInfo, 'script panel with an error', {
    include: '.wrx-scripts',
  })
  expect(errors).toEqual([])
})

test('Stop and the time limit end a run and leave the draft unchanged (PY-10, PD9, S17)', async ({
  context,
}) => {
  await stubTiles(context)
  const page = await context.newPage()
  await signIn(page, 'admin')
  const panel = await openScripts(page)
  await createScript(
    panel,
    'Spin',
    `import wrx, wrx_draft\nawait wrx_draft.write_draft(await wrx.Game().world_state())\nprint("wrote", flush=True)\nwhile True:\n    pass\n`,
  )
  await pythonReady(panel)
  await runScript(panel)
  await expect(statusOf(panel)).toHaveText('Running Spin… It is stopped after 30 s.')
  await expect(panel.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  await expect(panel.getByRole('listitem').filter({ hasText: '(running)' })).toHaveCount(1)
  await panel.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(statusOf(panel)).toHaveText(
    /^Spin was stopped after .*\. The world-state draft is unchanged\.$/,
  )

  await panel.getByLabel('Time limit (seconds)').fill('3')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await runScript(panel)
  await expect(statusOf(panel)).toHaveText(
    'Spin reached its 3 s time limit and was stopped. The world-state draft is unchanged.',
    { timeout: PYTHON_MS },
  )
  const map = await openMap(page, 6)
  await expect(map.getByText(/Unpublished edits/)).toHaveCount(0)
  await expect(map.getByRole('button', { name: 'Publish world state…' })).toBeDisabled()
})

test('players, observers and the admin’s preview as a role are offered no Scripts panel (PD4, PY-6)', async ({
  page,
}) => {
  const loaded: string[] = []
  page.on('request', (r) => {
    if (/\/py\/|scripts-panel/.test(r.url())) loaded.push(r.url())
  })
  for (const login of ['blue-co', 'white-observer']) {
    await signIn(page, login)
    await expect(page.getByRole('tab', { name: 'Game info', exact: true })).toBeVisible()
    await expect(scriptsTab(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page.getByLabel('Login name')).toBeVisible()
  }
  await signIn(page, 'admin')
  await expect(scriptsTab(page)).toBeVisible()
  await page.getByLabel('View as').selectOption({ label: 'White Cell (White)' })
  await expect(page.getByText('Viewing as White Cell')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Game info', exact: true })).toBeVisible()
  await expect(scriptsTab(page)).toHaveCount(0)
  // Neither the panel's chunk nor the runner was loaded for any of them, nor for the admin, who
  // never opened the tab (PY-5).
  expect(loaded).toEqual([])
})

test('an export imports back as a new script, after a confirmed delete; nothing runs (PY-7, PR1)', async ({
  page,
}, testInfo) => {
  await signIn(page, 'white-cell')
  const panel = await openScripts(page)
  const code = 'print("exported")  # <kept> & "quoted"\n'
  await createScript(panel, 'Exported', code)
  await panel.getByLabel('Time limit (seconds)').fill('12')
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(panel.getByText('(unsaved)')).toHaveCount(0)
  const downloading = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export all' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^scripts-\d{4}-\d{2}-\d{2}\.json$/)
  const file = await download.path()
  const text = readFileSync(file, 'utf8')
  expect(JSON.parse(text)).toMatchObject({
    format: 'wrx-script-bundle',
    version: 1,
    scripts: [{ name: 'Exported', code, settings: { timeLimitSeconds: 12, autoPublish: false } }],
  })

  await panel.getByRole('button', { name: 'Delete…' }).click()
  const confirm = panel.getByRole('alertdialog', { name: 'Delete Exported?' })
  await expect(confirm.getByRole('heading', { name: 'Delete Exported?' })).toBeFocused()
  await expectNoViolations(page, testInfo, 'script delete confirmation', {
    include: '.wrx-scripts',
  })
  await confirm.getByRole('button', { name: 'Delete script' }).click()
  await expect(panel.getByText('No scripts yet. Create one, or import a file.')).toBeVisible()

  await panel.getByLabel('Import scripts from files').setInputFiles(file)
  await expect(panel.getByText(/^Imported 1 script\. Nothing was run/)).toBeVisible()
  await expect(panel.getByRole('heading', { level: 3, name: 'Exported' })).toBeVisible()
  await expect(editorOf(panel)).toHaveValue(code)
  await expect(panel.getByLabel('Time limit (seconds)')).toHaveValue('12')
  await expect(panel.getByText('Run a script to see its output here.')).toBeVisible()

  // A file that is not a bundle is refused, and says why.
  await panel.getByLabel('Import scripts from files').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })
  await expect(
    panel.getByText('notes.txt is neither a script bundle (.json) nor a Python file (.py).'),
  ).toBeVisible()
})

test('a reload keeps the scripts: they are in the login’s private storage (PD5, PY-7)', async ({
  page,
}) => {
  await signIn(page, 'white-cell')
  let panel = await openScripts(page)
  await createScript(panel, 'Kept', 'print("kept")\n')
  await page.reload()
  await logIn(page, 'white-cell', 'demo-white-cell')
  panel = await openScripts(page)
  await expect(panel.getByRole('heading', { level: 3, name: 'Kept' })).toBeVisible()
  await expect(editorOf(panel)).toHaveValue('print("kept")\n')
})

test('two sessions of one role see each other’s edits, and a save over the other’s is caught (PD5)', async ({
  context,
}) => {
  const one = await context.newPage()
  const two = await context.newPage()
  await signIn(one, 'white-cell')
  await signIn(two, 'white-cell')
  const panelOne = await openScripts(one)
  const panelTwo = await openScripts(two)
  await createScript(panelOne, 'Shared', 'print("one")\n')
  // The other session picks it up within its re-read interval, having no unsaved edits.
  await expect(panelTwo.getByRole('heading', { level: 3, name: 'Shared' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(editorOf(panelTwo)).toHaveValue('print("one")\n')

  // Two edits without saving while one saves: two is told, and keeps its edit.
  await editorOf(panelTwo).fill('print("two")\n')
  await editorOf(panelOne).fill('print("one again")\n')
  await panelOne.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(panelTwo.getByText('Changed in another session')).toBeVisible({ timeout: 15_000 })
  await panelTwo.getByRole('button', { name: 'Keep editing' }).click()
  await panelTwo.getByRole('button', { name: 'Save', exact: true }).click()
  // Its save was based on the older revision: refused, until it keeps its change.
  await expect(panelTwo.getByText(/so your change was not saved/)).toBeVisible()
  await panelTwo.getByRole('button', { name: 'Keep my change' }).click()
  await expect(panelTwo.getByText('(unsaved)')).toHaveCount(0)
  await expect(panelOne.getByText('Changed in another session')).toHaveCount(0)
  await expect(editorOf(panelOne)).toHaveValue('print("two")\n', { timeout: 15_000 })
})
