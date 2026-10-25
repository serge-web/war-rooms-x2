// The admin backend on a fresh mock (D17): the demo seed starts published, with the observer
// vault stored in the admin's private storage (ADM-37). The admin logs in at #/admin, finds
// nothing to publish and every role on the credentials sheet with its demo password, unlocks the
// vault with the demo passphrase shown as such (NFR-6), and the audit (WP 2.10) is clean with
// the observer's voice read through the vault.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { logIn } from './mock.ts'

/** The demo seed's vault passphrase (DEMO_VAULT_PASSPHRASE in @wrx/mock-server). */
const DEMO_PASSPHRASE = 'demo-observer-vault'

async function open(page: Page, section: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('button', { name: section, exact: false })
    .first()
    .click()
  await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
}

test('the seeded game is published; the demo passphrase opens the vault; the audit is clean (ADM-37, ADM-41)', async ({
  page,
}) => {
  await page.goto('./#/admin')
  await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible()
  await logIn(page, 'admin', 'demo-admin')
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible()

  await open(page, 'Publish')
  await expect(
    page.getByText(`the mock’s demo game opens it with ${DEMO_PASSPHRASE}`),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Check the server and plan' }).click()
  await expect(page.getByText('Nothing to publish: the server matches the draft.')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText('A vault is needed.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show the credentials sheet' }).click()
  const sheet = page.getByRole('table', { name: 'Role credentials' })
  await expect(sheet.getByRole('row', { name: /Blue Observer/ })).toContainText(
    'demo-blue-observer',
  )

  await open(page, 'Audit')
  await page.getByRole('button', { name: 'Run the audit' }).click()
  await expect(page.getByText('Unlock the vault to check observer voice.')).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Unlock the vault' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Unlock the vault' })
  await expect(dialog.getByText(/DEMO vault/)).toContainText(DEMO_PASSPHRASE)
  await dialog.getByLabel('Passphrase', { exact: true }).fill(DEMO_PASSPHRASE)
  await dialog.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('No differences: the server matches the design.')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/Voice checked through 1 role login/)).toBeVisible()
})
