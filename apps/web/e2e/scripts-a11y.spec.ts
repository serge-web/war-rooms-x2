// The Scripts panel, the umpire room and their confirmations by keyboard alone, with axe (WP 6.5;
// NFR-14, WCAG 2.2 AA; SRD Annex C PY-6, PY-8, PY-9). After the login (and the panel's tab, a
// FlexLayout tab whose keyboard use is WP 2.5's test), every step is a key press, starting from a
// control the test focuses: create and rename a script, write it, save with Ctrl+S, leave the
// editor with Escape then Tab, run it, and the confirmations (delete; publishing without review)
// with Escape and with their buttons; the proposal card's "Load into draft…" and its summary.
// Each confirmation takes focus when it opens and gives it back when it closes.
// plan/reviews/phase-6-accessibility.md records the results.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoViolations } from './a11y.ts'
import { stubTiles } from './map.ts'
import { logIn } from './mock.ts'

const WIDE = { width: 1500, height: 950 }
const PYTHON_MS = 60_000

test.setTimeout(180_000)

async function signIn(page: Page, login: string): Promise<void> {
  await page.setViewportSize(WIDE)
  await page.goto('./')
  await logIn(page, login, `demo-${login}`)
  await expect(page.locator('.flexlayout__layout_main [role="tab"]').first()).toBeVisible({
    timeout: 20_000,
  })
}

async function openScripts(page: Page): Promise<Locator> {
  const tab = page.getByRole('tab', { name: 'Scripts', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  const panel = page.getByRole('region', { name: 'Scripts', exact: true })
  await expect(panel.getByText('Loading the scripts…')).toHaveCount(0, { timeout: 20_000 })
  await expect(panel.getByText(/^Python is ready/)).toBeVisible({ timeout: PYTHON_MS })
  return panel
}

/** Focuses a control, as a keyboard user who has tabbed to it, and presses a key there. */
async function press(control: Locator, key: string): Promise<void> {
  await control.focus()
  await expect(control).toBeFocused()
  await control.page().keyboard.press(key)
}

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    return el === null || el === document.body
      ? 'body'
      : `${el.tagName.toLowerCase()}:${el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40)}`
  })

const PROPOSE = [
  'import wrx',
  'game = wrx.Game()',
  'state = await game.world_state()',
  'tank = next(a for a in state.assets.values() if a.title == "Tank Company")',
  'state.assets[tank.id] = tank.model_copy(update={"health": 40})',
  'print(await game.post_proposal(state, "Tank Company down to 40%."))',
  '',
].join('\n')

test('the keyboard alone writes, saves, runs and deletes a script; confirmations take and give back focus (NFR-14, PY-6)', async ({
  context,
}, testInfo) => {
  const page = await context.newPage()
  await signIn(page, 'white-cell')
  const panel = await openScripts(page)

  // Create, then rename: the form takes focus and gives it back to "Rename…".
  await press(panel.getByRole('button', { name: 'New script' }), 'Enter')
  await expect(panel.getByRole('heading', { level: 3, name: /^Untitled script/ })).toBeVisible()
  await press(panel.getByRole('button', { name: 'Rename…' }), 'Enter')
  const name = panel.getByRole('textbox', { name: 'New name' })
  await expect(name).toBeFocused()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Strike')
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('heading', { level: 3, name: 'Strike' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Rename…' })).toBeFocused()
  // Escape closes the rename form, focus back on "Rename…".
  await page.keyboard.press('Enter')
  await expect(name).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(name).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Rename…' })).toBeFocused()

  // The editor: type, indent with Tab, save with Ctrl+S, leave with Escape then Tab.
  const editor = panel.getByRole('textbox', { name: 'Code of Strike' })
  await editor.focus()
  // A new script starts from a short example: replace it.
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(PROPOSE)
  await page.keyboard.press('Tab')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue(PROPOSE)
  await expect(panel.getByText('(unsaved)')).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+S')
  await expect(panel.getByText('(unsaved)')).toHaveCount(0, { timeout: 20_000 })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await expect(editor).not.toBeFocused()
  expect(await focused(page)).not.toBe('body')

  // Run from the keyboard; the status is a live region.
  await press(panel.getByRole('button', { name: 'Run', exact: true }), 'Enter')
  await expect(panel.locator('.wrx-scripts__status[role="status"]')).toHaveText(
    /^Strike finished in /,
    { timeout: PYTHON_MS },
  )
  await expectNoViolations(page, testInfo, 'script panel after a keyboard run', {
    include: '.wrx-scripts',
  })

  // Delete: the confirmation takes focus; Escape gives it back to "Delete…"; confirming moves it
  // to the panel, not the page's body.
  const remove = panel.getByRole('button', { name: 'Delete…' })
  await press(remove, 'Enter')
  const ask = panel.getByRole('alertdialog', { name: 'Delete Strike?' })
  await expect(ask.getByRole('heading', { name: 'Delete Strike?' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(ask).toHaveCount(0)
  await expect(remove).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(ask.getByRole('heading', { name: 'Delete Strike?' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(ask.getByRole('button', { name: 'Delete script' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('heading', { level: 3, name: 'Strike' })).toHaveCount(0)
  await expect(panel.getByText('No scripts yet.', { exact: false })).toBeVisible()
  expect(await focused(page)).not.toBe('body')
  await expect(panel.getByRole('button', { name: 'New script' })).toBeFocused()
})

test('the keyboard alone turns publishing without review on and off; the umpire room and its proposal card, with its summary (NFR-14, PY-8, PY-9)', async ({
  context,
}, testInfo) => {
  await stubTiles(context)
  // A proposal to load: White Cell posts one from a script.
  const white = await context.newPage()
  await signIn(white, 'white-cell')
  const whiteScripts = await openScripts(white)
  await press(whiteScripts.getByRole('button', { name: 'New script' }), 'Enter')
  const whiteEditor = whiteScripts.getByRole('textbox', { name: /^Code of / })
  await whiteEditor.focus()
  await white.keyboard.press('ControlOrMeta+A')
  await white.keyboard.insertText(PROPOSE)
  await press(whiteScripts.getByRole('button', { name: 'Run', exact: true }), 'Enter')
  await expect(whiteScripts.locator('.wrx-scripts__status')).toHaveText(/ finished in /, {
    timeout: PYTHON_MS,
  })
  await white.locator('.flexlayout__layout_main').getByRole('tab', { name: 'Umpires' }).click()
  const whiteRoom = white.getByRole('region', { name: 'Umpires', exact: true })
  await expect(whiteRoom.getByRole('region', { name: 'Proposed world state' })).toBeVisible({
    timeout: 20_000,
  })
  await expectNoViolations(white, testInfo, 'umpire room with a proposal card, White Force', {
    include: '.flexlayout__layout_main',
  })

  // The admin: publishing without review, by keyboard (a checkbox: Space).
  const admin = await context.newPage()
  await signIn(admin, 'admin')
  const panel = await openScripts(admin)
  await press(panel.getByRole('button', { name: 'New script' }), 'Enter')
  const box = panel.getByRole('checkbox', { name: 'Publish without review' })
  await press(box, 'Space')
  const ask = panel.getByRole('alertdialog', { name: /^Publish without review for / })
  await expect(ask.getByRole('heading', { name: /^Publish without review for / })).toBeFocused()
  await expectNoViolations(admin, testInfo, 'publish-without-review confirmation, keyboard', {
    include: '.wrx-scripts',
  })
  await admin.keyboard.press('Escape')
  await expect(ask).toHaveCount(0)
  await expect(box).not.toBeChecked()
  await expect(box).toBeFocused()
  await admin.keyboard.press('Space')
  await expect(ask.getByRole('heading', { name: /^Publish without review for / })).toBeFocused()
  await admin.keyboard.press('Tab')
  await expect(ask.getByRole('button', { name: 'Turn on' })).toBeFocused()
  await admin.keyboard.press('Enter')
  await expect(box).toBeChecked({ timeout: 20_000 })
  await expect(box).toBeFocused()
  // Off again: no question asked.
  await admin.keyboard.press('Space')
  await expect(box).not.toBeChecked({ timeout: 20_000 })
  await expect(ask).toHaveCount(0)

  // The umpire room as the admin: the card's "Load into draft…", its summary, by keyboard.
  await admin.locator('.flexlayout__layout_main').getByRole('tab', { name: 'Umpires' }).click()
  const room = admin.getByRole('region', { name: 'Umpires', exact: true })
  const load = room.getByRole('button', { name: 'Load into draft…' })
  await expect(load).toBeVisible({ timeout: 20_000 })
  await expectNoViolations(admin, testInfo, 'umpire room with a proposal card, admin', {
    include: '.flexlayout__layout_main',
  })
  await press(load, 'Enter')
  const confirm = room.getByRole('alertdialog', { name: /^Load White Cell’s proposal/ })
  await expect(confirm.getByRole('heading', { name: /^Load White Cell’s proposal/ })).toBeFocused()
  await expect(confirm.getByRole('group', { name: 'World-state changes' })).toContainText(
    'Tank Company: health 100% → 40%',
  )
  await admin.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(load).toBeFocused()
  await admin.keyboard.press('Enter')
  await expect(confirm.getByRole('heading', { name: /^Load White Cell’s proposal/ })).toBeFocused()
  await admin.keyboard.press('Tab')
  await expect(confirm.getByRole('button', { name: 'Load into draft', exact: true })).toBeFocused()
  await admin.keyboard.press('Enter')
  const done = room.getByText(/proposal is now your world-state draft/)
  await expect(done).toBeVisible()
  expect(await focused(admin)).not.toBe('body')
  await expectNoViolations(admin, testInfo, 'umpire room after loading a proposal', {
    include: '.flexlayout__layout_main',
  })
})
