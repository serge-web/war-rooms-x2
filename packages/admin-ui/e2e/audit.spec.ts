// The audit flow in Chromium, on the dev page against its in-page mock server (WP 2.10): publish,
// audit clean, inject drift (the dev page unmoderates a room), audit again and see it, repair it,
// and see the clean re-audit.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = 'correct horse battery staple'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' })

async function open(page: Page, section: string) {
  await nav(page).getByRole('button', { name: section, exact: false }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
}

async function firstPublish(page: Page) {
  await page.goto('./')
  await open(page, 'Publish')
  await expect(page.getByText('Mock server.')).toBeVisible()
  await page.getByRole('button', { name: 'Check the server and plan' }).click()
  await page.getByRole('button', { name: 'Create the vault' }).click()
  const vault = page.getByRole('alertdialog', { name: 'Create the observer-password vault' })
  await vault.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await vault.getByLabel('Passphrase again').fill(PASSPHRASE)
  await vault.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Vault unlocked.')).toBeVisible({ timeout: 20_000 })
  const region = page.getByRole('region', { name: 'Publish plan' })
  await region.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Publish these changes?' })
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Checked again: nothing is left to publish.')).toBeVisible({
    timeout: 30_000,
  })
}

test('audits the published game, finds an unmoderated room and repairs it', async ({
  page,
}, testInfo) => {
  await firstPublish(page)
  await open(page, 'Audit')
  await page.getByRole('button', { name: 'Run the audit' }).click()
  const report = page.getByRole('region', { name: 'Audit report' })
  await expect(report.getByText('No differences: the server matches the design.')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText(/Voice checked through \d+ role login/)).toBeVisible()
  await expect(report.getByText(/listable by anyone/)).toBeVisible()

  await page.getByRole('button', { name: 'Dev: unmoderate the first room (audit drift)' }).click()
  await page.getByRole('button', { name: 'Audit again' }).click()
  // An unmoderated room gives everyone voice, so the observer can post there too: both show.
  await expect(report.getByText('2 differences: 2 critical.')).toBeVisible({ timeout: 20_000 })
  const critical = report.getByRole('region', { name: 'Critical (2)' })
  await expect(critical.getByText(/^Room settings: /)).toBeVisible()
  await expect(critical.getByText('moderated: false')).toBeVisible()
  await expect(critical.getByText(/^Voice: .* \(blue-observer\)$/)).toBeVisible()
  await expect(critical.getByText('participant: can post')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('audit-drift.png'), fullPage: true })

  await report.getByRole('button', { name: 'Repair all (2)…' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Repair these differences?' })
  await dialog.getByRole('button', { name: 'Repair', exact: true }).click()
  await expect(
    page.getByText('Repaired 2 differences. Audited again: the server matches the design.'),
  ).toBeVisible({ timeout: 20_000 })
  await expect(report.getByText('No differences: the server matches the design.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('audit-repaired.png'), fullPage: true })
})
