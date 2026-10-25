// The publish flow in Chromium, on the dev page against its in-page mock server (WP 2.3):
// plan, create the vault, confirm, progress, the result; a second plan finds nothing; the
// credentials sheet prints alone; a change with warnings that must be ticked; and a reset with
// typed confirmation.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const PASSPHRASE = 'correct horse battery staple'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' })

async function open(page: Page, section: string) {
  await nav(page).getByRole('button', { name: section, exact: false }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
}

/** A plan group's disclosure button, e.g. "Access". */
function groupButton(region: Locator, group: string): Locator {
  return region.getByRole('region', { name: group }).getByRole('button').first()
}

async function plan(page: Page) {
  await page.getByRole('button', { name: /Check the server and plan|Plan again/ }).click()
  await expect(page.getByRole('region', { name: 'Publish plan' })).toBeVisible()
}

async function publish(page: Page, ticks: RegExp[] = []) {
  const region = page.getByRole('region', { name: 'Publish plan' })
  await region.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Publish these changes?' })
  for (const tick of ticks) await dialog.getByRole('checkbox', { name: tick }).check()
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText(/Publish complete: \d+ steps applied/)).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Checked again: nothing is left to publish.')).toBeVisible()
}

async function firstPublish(page: Page) {
  await page.goto('./')
  await open(page, 'Publish')
  await expect(page.getByText('Mock server.')).toBeVisible()
  await plan(page)
  await page.getByRole('button', { name: 'Create the vault' }).click()
  const vault = page.getByRole('alertdialog', { name: 'Create the observer-password vault' })
  await vault.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await vault.getByLabel('Passphrase again').fill(PASSPHRASE)
  await vault.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Vault unlocked.')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('A vault is needed.')).toBeHidden()
  await publish(page)
}

test(
  'publishes the design, then finds nothing left',
  { tag: '@screenshot' },
  async ({ page }, testInfo) => {
    await page.goto('./')
    await open(page, 'Publish')
    await expect(page.getByText('Mock server.')).toBeVisible()
    await plan(page)
    const region = page.getByRole('region', { name: 'Publish plan' })
    for (const group of ['Accounts', 'Rooms', 'Nodes', 'Access', 'Documents', 'Game setup']) {
      await expect(region.getByRole('region', { name: group })).toBeVisible()
      // Collapsed by default, with a count and a status.
      await expect(groupButton(region, group)).toHaveAttribute('aria-expanded', 'false')
    }
    await expect(region.locator('li[data-step]')).toHaveCount(0)
    await expect(groupButton(region, 'Access')).toHaveText(/Access\s*20 steps\s*To do/)
    await expect(region.getByText(/the game becomes design version 1/)).toBeVisible()
    // The access steps summarised per kind, expandable from the keyboard.
    await groupButton(region, 'Access').focus()
    await page.keyboard.press('Enter')
    await expect(groupButton(region, 'Access')).toHaveAttribute('aria-expanded', 'true')
    const nodeGrants = region.getByRole('button', { name: /^Give node access: 15 nodes × roles/ })
    await expect(nodeGrants).toHaveAttribute('aria-expanded', 'false')
    await nodeGrants.click()
    await expect(region.getByText('Give access to node game-state')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('publish-plan.png'), fullPage: true })
    await groupButton(region, 'Access').click()

    await firstPublish(page)
    await expect(region.getByRole('status').filter({ hasText: 'All 58 steps done.' })).toBeVisible()
    await expect(region.locator('section[data-group]:not([data-state="done"])')).toHaveCount(0)
    await region.getByRole('button', { name: 'Show every step' }).click()
    await expect(region.locator('li[data-step][data-state="done"]')).toHaveCount(58)
    await expect(region.locator('li[data-step]:not([data-state="done"])')).toHaveCount(0)
    await expect(page.getByText(/All 3 rooms are members-only/)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('publish-done.png'), fullPage: true })

    await page.getByRole('button', { name: 'Close' }).click()
    await plan(page)
    await expect(page.getByText('Nothing to publish: the server matches the draft.')).toBeVisible()
  },
)

test('prints the credentials sheet alone, with demo passwords labelled', async ({
  page,
}, testInfo) => {
  await firstPublish(page)
  await page.getByRole('button', { name: 'Show the credentials sheet' }).click()
  const sheet = page.getByRole('table', { name: 'Role credentials' })
  await expect(sheet.getByRole('row', { name: /Blue CO/ })).toContainText('demo-blue-co')
  await expect(page.getByText(/DEMO PASSWORDS: known, not secret/)).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(sheet).toBeVisible()
  await expect(nav(page)).toBeHidden()
  await expect(page.getByRole('region', { name: 'Publish plan' })).toBeHidden()
  await expect(sheet.getByRole('button', { name: /Reset the password/ }).first()).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('credentials-print.png'), fullPage: true })
  await page.emulateMedia({ media: 'screen' })
})

test('publishes a change with warnings, then resets the game', async ({ page }) => {
  await firstPublish(page)
  await page.getByRole('button', { name: 'Close' }).click()

  await open(page, 'Roles')
  await page.getByRole('button', { name: 'Red CO', exact: true }).click()
  await page.getByRole('button', { name: 'Delete Red CO' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete role' }).click()
  await open(page, 'Rooms')
  await page.getByRole('button', { name: 'Blue–Red negotiation', exact: true }).click()
  await page.getByRole('button', { name: /^Delete Blue–Red negotiation/ }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete room/ })
    .click()

  await open(page, 'Publish')
  await plan(page)
  const region = page.getByRole('region', { name: 'Publish plan' })
  await expect(region.getByRole('region', { name: 'Removals' })).toBeVisible()
  await expect(region.getByText(/stays attributed to its old login, red-co/)).toBeVisible()
  await expect(region.getByText(/Blue–Red negotiation is destroyed with its history/)).toBeVisible()
  await expect(region.getByText(/the game becomes design version 2/)).toBeVisible()
  // The confirmation stays disabled until both are ticked.
  await region.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Publish these changes?' })
  await expect(dialog.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await publish(page, [/Delete Red CO/, /Destroy Blue–Red negotiation/])

  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Plan a reset' }).click()
  const reset = page.getByRole('region', { name: 'Reset plan' })
  await expect(reset).toBeVisible()
  await reset.getByRole('button', { name: 'Reset the game…' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Reset the game?' })
  for (const box of await confirm.getByRole('checkbox').all()) await box.check()
  await expect(confirm.getByRole('button', { name: 'Reset the game' })).toBeDisabled()
  await confirm.getByLabel(/to confirm/).fill('Exercise Northern Gate')
  await confirm.getByRole('button', { name: 'Reset the game' }).click()
  await expect(page.getByText(/Reset complete/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Plan a reset' }).click()
  await expect(page.getByText('Nothing to reset: the server holds no game.')).toBeVisible()
})

test('exports the design without passwords', async ({ page }) => {
  await page.goto('./?server=none')
  await open(page, 'Publish')
  await expect(page.getByText('Not connected to a server.')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export the design' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^exercise-northern-gate-design-.*\.json$/)
  const path = await file.path()
  const { readFileSync } = await import('node:fs')
  const text = readFileSync(path, 'utf8')
  expect(text).toContain('"format": "wrx1-design"')
  expect(text).not.toContain('password')
})
