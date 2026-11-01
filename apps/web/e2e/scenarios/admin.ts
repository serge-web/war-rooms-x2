// The admin backend (#/admin) as the scenarios drive it: log in, find the published design in
// the editor, plan, unlock the vault, publish. Both backends.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { demoSeed } from '@wrx/mock-server'
import type { Backend } from './backend.ts'
import { expect, logInAs, test } from './backend.ts'

export const adminNav = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' })

export async function openSection(page: Page, section: string): Promise<void> {
  await adminNav(page).getByRole('button', { name: section, exact: false }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
}

/** Imports a design file into the draft, from the Publish section (ADM-16). */
export async function importDesign(page: Page, file: string): Promise<void> {
  await openSection(page, 'Publish')
  // As bytes: Playwright sets no file from a path with non-ASCII characters (test titles here
  // have en dashes, and so do their output folders).
  await page.getByLabel('Import a design…').setInputFiles({
    name: basename(file),
    mimeType: 'application/json',
    buffer: readFileSync(file),
  })
  await page.getByRole('button', { name: 'Replace the draft' }).click()
  await expect(page.getByText(/^Imported .*\.json\./)).toBeVisible()
}

/**
 * Logs in at #/admin with the published demo game in the editor. The mock's draft starts from
 * its demo seed. On a real server the draft lives in the browser that made it, so an admin in
 * a fresh browser first imports the design file (ADM-16), here the demo design's.
 */
export async function openAdminOnDemo(
  page: Page,
  backend: Backend,
  testInfo: TestInfo,
): Promise<void> {
  await page.goto('./#/admin')
  await expect(page.getByLabel(backend.badge)).toBeVisible()
  await logInAs(page, backend, 'admin')
  await expect(adminNav(page)).toBeVisible({ timeout: 20_000 })
  if (backend.kind === 'ejabberd') {
    const file = testInfo.outputPath('exercise-northern-gate-design.json')
    writeFileSync(file, JSON.stringify(demoSeed().design, null, 2))
    await importDesign(page, file)
  }
}

/** Unlocks the observer vault with `passphrase` (the backend's `vaultPassphrase` for the demo). */
export async function unlockVault(page: Page, passphrase: string): Promise<void> {
  await page.getByRole('button', { name: 'Unlock the vault' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Unlock the vault' })
  await dialog.getByLabel('Passphrase', { exact: true }).fill(passphrase)
  await dialog.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Vault unlocked.')).toBeVisible({ timeout: 30_000 })
}

/** Plans from the Publish section; unlocks the vault first when the plan needs it. */
export async function plan(page: Page, backend: Backend): Promise<void> {
  await openSection(page, 'Publish')
  const planButton = page.getByRole('button', { name: /Check the server and plan|Plan again/ })
  await planButton.click()
  const region = page.getByRole('region', { name: 'Publish plan' })
  await expect(region).toBeVisible({ timeout: 30_000 })
  if (await page.getByRole('button', { name: 'Unlock the vault' }).isVisible()) {
    await unlockVault(page, backend.vaultPassphrase)
    await planButton.click()
  }
  await expect(page.getByText('Reading the server…')).toBeHidden({ timeout: 30_000 })
  await expect(region).toBeVisible()
}

/** Publishes the plan on screen, ticking the warnings named, and waits for it to complete. */
export async function publishPlan(page: Page, ticks: readonly RegExp[] = []): Promise<void> {
  const region = page.getByRole('region', { name: 'Publish plan' })
  await region.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Publish these changes?' })
  for (const tick of ticks) await dialog.getByRole('checkbox', { name: tick }).check()
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText(/Publish complete: \d+ steps applied/))
    .toBeVisible({ timeout: 90_000 })
    .catch(async (error: unknown) => {
      // What the plan says, for the report: the step that stopped, and why.
      const file = test.info().outputPath('publish-plan.txt')
      writeFileSync(
        file,
        await page
          .locator('body')
          .innerText()
          .catch(() => '(no page)'),
      )
      await test.info().attach('publish plan', { path: file, contentType: 'text/plain' })
      throw error
    })
}
