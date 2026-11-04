// SC-10 Templated room (SRD Annex A, WP 4.4). Traces to: TD2–TD7, TPL-1–TPL-9, T-R1, ADM-9.
//
// The admin builds a template in the builder (a required text and a role picker), offers it to
// Blue in the Blue–Red negotiation with free text off, and publishes: the template locks. Blue CO
// sends it, naming a new role, Blue Liaison, in the picker; Red CO sees the card but is offered
// nothing to send. The admin copies the locked template, changes the copy, offers the copy
// instead, deletes Blue Liaison and publishes again. The old message still shows with the old
// template's name and fields, its picker value "Blue Liaison (deleted)", and the warning that
// the room no longer offers that template (provisional answer 3); Blue CO sends the new one.
// Both backends; on ejabberd the admin first imports the published design (admin.ts).
import type { Page, TestInfo } from '@playwright/test'
import { expectNoViolations } from '../a11y.ts'
import { openAdminOnDemo, openSection, plan, publishPlan } from './admin.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const TALKS = 'Blue–Red negotiation'
const OLD = 'Liaison request'
const NEW = 'Liaison request v2'
const NO_TEMPLATES = 'This room takes templated messages only, and none is offered to your role.'

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const roomPanel = (page: Page) => page.getByRole('region', { name: TALKS, exact: true })
const messages = (page: Page) =>
  page.getByRole('region', { name: `Messages in ${TALKS}`, exact: true })
const fields = (page: Page) => page.getByRole('list', { name: 'Fields' })
const palette = (page: Page) => page.getByRole('group', { name: 'Field palette' })

/** Sets one field's label (and whether it is required) in the builder. */
async function label(
  page: Page,
  row: RegExp,
  kind: string,
  text: string,
  required?: boolean,
): Promise<void> {
  await fields(page).getByRole('button', { name: row }).click()
  const settings = page.getByRole('group', { name: new RegExp(`^${kind}: `) })
  await settings.getByLabel('Label').fill(text)
  if (required === true) await settings.getByLabel('Required').check()
}

/** axe on the screen as it is (NFR-14), on the mock only: the screens are the same on both. */
async function scan(page: Page, kind: string, testInfo: TestInfo, screen: string) {
  if (kind !== 'mock') return
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expectNoViolations(page, testInfo, screen)
}

/** The room's template table, in the Rooms section. */
async function openRoomTemplates(admin: Page) {
  await openSection(admin, 'Rooms')
  await admin.getByRole('button', { name: TALKS, exact: true }).click()
  return admin.getByRole('group', { name: 'Templates' })
}

test('SC-10: the admin offers a template to one force in a templates-only room; Blue sends it, Red cannot; a copy replaces it and old messages keep the old template (TD2–TD7, TPL-1–TPL-9, T-R1)', async ({
  context,
  backend,
}, testInfo) => {
  test.setTimeout(300_000)
  const player = async (id: string) => {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1400, height: 900 })
    const errors = watchErrors(page)
    await openApp(page, backend)
    await logInAs(page, backend, id)
    await expect(tab(page, TALKS)).toBeVisible({ timeout: 20_000 })
    await tab(page, TALKS).click()
    return { page, errors }
  }
  const admin = await context.newPage()
  await admin.setViewportSize({ width: 1400, height: 1000 })
  const adminErrors = watchErrors(admin)
  await openAdminOnDemo(admin, backend, testInfo)

  // 1. A new role, Blue Liaison, for the picker to name (and, later, to be deleted).
  await openSection(admin, 'Roles')
  await admin.getByLabel('New role name').fill('Blue Liaison')
  await admin.getByLabel('In force').selectOption({ label: 'Blue' })
  await admin.getByRole('button', { name: 'Add role' }).click()

  // 2. The template, from the builder's palette (TD5): a required text and a role picker.
  await openSection(admin, 'Templates')
  await admin.getByLabel('New template name').fill(OLD)
  await admin.getByRole('button', { name: 'Add template' }).click()
  await expect(admin.getByRole('heading', { level: 3, name: `Template: ${OLD}` })).toBeVisible()
  await palette(admin).getByRole('button', { name: 'Text', exact: true }).click()
  await palette(admin).getByRole('button', { name: 'Role picker', exact: true }).click()
  await label(admin, /^Text\s+Text$/, 'Text', 'Request', true)
  await label(admin, /^Role picker\s+Role picker$/, 'Role picker', 'Point of contact')
  // The preview is the player's form (TPL-7).
  const preview = admin.getByRole('region', { name: `Preview of ${OLD}` })
  await expect(preview.getByLabel(/^Request/)).toBeVisible()
  await expect(preview.getByLabel(/^Point of contact/)).toHaveValue('')

  // 3. Offered to Blue in the negotiation, free text off (TD3, TD4, TPL-2).
  let offers = await openRoomTemplates(admin)
  await offers.getByLabel('Free text allowed').uncheck()
  await offers
    .getByLabel('Add a force or role', { exact: true })
    .selectOption({ label: 'Force: Blue' })
  await offers.getByRole('button', { name: 'Add row' }).click()
  await offers.getByLabel(`Force: Blue may use ${OLD}`, { exact: true }).check()
  await scan(admin, backend.kind, testInfo, 'room template table')
  // The access matrix shows who may use it (ADM-9).
  await openSection(admin, 'Access matrix')
  await expect(admin.getByRole('table', { name: /Templates each role may use/ })).toContainText(OLD)

  // 4. Published: the plan says the template locks (TD6).
  await plan(admin, backend)
  const region = admin.getByRole('region', { name: 'Publish plan' })
  await region.getByRole('button', { name: 'Show every step' }).click()
  await expect(region.locator('li[data-step]').filter({ hasText: OLD }).first()).toBeVisible()
  await publishPlan(admin)
  await openSection(admin, 'Templates')
  // The list marks it locked.
  await admin.getByRole('button', { name: new RegExp(`^${OLD}\\s*Locked$`) }).click()
  await expect(admin.getByText(/A published room has offered this template/)).toBeVisible()
  // Locked: its fields are read only (TPL-4).
  await fields(admin)
    .getByRole('button', { name: /^Request\s+Text/ })
    .click()
  await expect(
    admin.getByRole('group', { name: /^Text: Request/ }).getByLabel('Label'),
  ).toBeDisabled()
  await scan(admin, backend.kind, testInfo, 'locked template')

  // 5. Blue CO sends it; Red CO sees the card and has nothing to send (TPL-3, TPL-5, TPL-6).
  const { page: blue, errors: blueErrors } = await player('blue-co')
  const { page: red, errors: redErrors } = await player('red-co')
  const blueForm = roomPanel(blue)
  const type = blueForm.getByRole('combobox', { name: 'Message type' })
  await expect(type).toBeVisible({ timeout: 30_000 })
  await expect(type.locator('option')).toHaveText([OLD])
  await blueForm.getByLabel(/^Request/).fill('Open a channel at the bridge')
  await blueForm.getByLabel(/^Point of contact/).selectOption({ label: 'Blue Liaison (Blue)' })
  await blueForm.getByRole('button', { name: 'Send' }).click()
  await expect(blueForm.getByLabel(/^Request/)).toHaveValue('', { timeout: 20_000 })

  const redCard = messages(red)
    .getByRole('article')
    .filter({ hasText: 'Open a channel at the bridge' })
  await expect(redCard.locator('.wrx-tcard')).toBeVisible({ timeout: 20_000 })
  await expect(redCard.locator('.wrx-tcard__name')).toHaveText(OLD)
  await expect(redCard.locator('dt')).toHaveText(['Request', 'Point of contact'])
  await expect(redCard.locator('dd')).toHaveText(['Open a channel at the bridge', 'Blue Liaison'])
  await expect(redCard.locator('.wrx-chat__warning')).toHaveCount(0)
  await expect(roomPanel(red).getByRole('combobox', { name: 'Message type' })).toHaveCount(0)
  await expect(roomPanel(red).getByText(NO_TEMPLATES)).toBeVisible()
  await expect(
    roomPanel(red).getByRole('textbox', { name: `Message ${TALKS}`, exact: true }),
  ).toBeDisabled()
  await scan(red, backend.kind, testInfo, 'templates-only composer offering nothing')

  // 6. The admin copies the locked template and changes the copy (TPL-4), offers the copy in
  // its place, and deletes Blue Liaison.
  await admin.getByRole('button', { name: 'Copy to new template' }).first().click()
  await expect(
    admin.getByRole('heading', { level: 3, name: `Template: Copy of ${OLD}` }),
  ).toBeVisible()
  await admin.getByLabel('Name', { exact: true }).fill(NEW)
  await expect(admin.getByRole('heading', { level: 3, name: `Template: ${NEW}` })).toBeVisible()
  await label(admin, /^Request\s+Text/, 'Text', 'Request detail')
  await palette(admin).getByRole('button', { name: 'Yes/no', exact: true }).click()
  await label(admin, /^Yes\/no\s+Yes\/no$/, 'Yes/no', 'Urgent')
  offers = await openRoomTemplates(admin)
  // Unticked first: the row stays for the copy to be ticked.
  await offers.getByLabel(`Force: Blue may use ${OLD}`, { exact: true }).uncheck()
  await offers.getByLabel(`Force: Blue may use ${NEW}`, { exact: true }).check()
  await openSection(admin, 'Roles')
  await admin.getByRole('button', { name: 'Blue Liaison', exact: true }).click()
  await admin.getByRole('button', { name: 'Delete Blue Liaison' }).click()
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete role' }).click()
  await plan(admin, backend)
  await region.getByRole('button', { name: 'Show every step' }).click()
  await expect(region.locator('li[data-step]').filter({ hasText: NEW }).first()).toBeVisible()
  await publishPlan(admin, [/Delete Blue Liaison/])

  // 7. The old message keeps its template: its name, its fields, the deleted role's last name
  // (TPL-8, TPL-9); a warning says the room no longer offers it (provisional answer 3).
  for (const page of [red, blue]) {
    const old = messages(page)
      .getByRole('article')
      .filter({ hasText: 'Open a channel at the bridge' })
    await expect(old.locator('.wrx-tcard__name')).toHaveText(OLD, { timeout: 30_000 })
    await expect(old.locator('dt')).toHaveText(['Request', 'Point of contact'])
    await expect(old.locator('dd').nth(1)).toHaveText('Blue Liaison (deleted)', {
      timeout: 30_000,
    })
    await expect(old.locator('.wrx-chat__warning')).toContainText(
      `This room does not offer ${OLD} to the sender now.`,
    )
  }
  await scan(red, backend.kind, testInfo, 'card with a warning, deleted role')

  // 8. Blue CO's composer offers the copy only; its message shows with the new fields.
  await expect(type.locator('option')).toHaveText([NEW], { timeout: 30_000 })
  await blueForm.getByLabel(/^Request detail/).fill('Channel open, standing by')
  await blueForm.getByLabel('Urgent').check()
  await blueForm.getByRole('button', { name: 'Send' }).click()
  const fresh = messages(red).getByRole('article').filter({ hasText: 'Channel open, standing by' })
  await expect(fresh.locator('.wrx-tcard__name')).toHaveText(NEW, { timeout: 20_000 })
  await expect(fresh.locator('dt')).toHaveText(['Request detail', 'Urgent'])
  await expect(fresh.locator('dd')).toHaveText(['Channel open, standing by', 'Yes'])
  await expect(fresh.locator('.wrx-chat__warning')).toHaveCount(0)
  // Red CO still has nothing to send.
  await expect(roomPanel(red).getByText(NO_TEMPLATES)).toBeVisible()

  expect(adminErrors).toEqual([])
  expect(blueErrors).toEqual([])
  expect(redErrors).toEqual([])
})
