// The admin backend on the mock (WP 2.2, 2.3, 2.8, DOC-20): the design editor, the theme editor
// and the publish plan, after logging in at #/admin as the admin with its demo password.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'
import { hostMockInLeaderTab } from './mock-app.ts'

async function adminLogin(page: Page): Promise<void> {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/#/admin')
  await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible()
  await expect(page.getByLabel('Backend: MOCK')).toBeVisible()
  await page.getByLabel('Login name').fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('demo-admin')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
}

async function openSection(page: Page, section: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('button', { name: section, exact: false })
    .first()
    .click()
  await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
}

test('admin design editor', { tag: '@screenshot' }, async ({ page }) => {
  await adminLogin(page)
  await openSection(page, 'Rooms')
  await page.getByRole('button', { name: 'Blue HQ', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Room: Blue HQ' })).toBeVisible()
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-design-editor')
})

test('admin theme editor', { tag: '@screenshot' }, async ({ page }) => {
  await adminLogin(page)
  await openSection(page, 'Themes')
  await expect(page.getByRole('figure', { name: /^Welcome page/ })).toBeVisible()
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-theme-editor')
})

test('admin publish plan', { tag: '@screenshot' }, async ({ page }) => {
  await adminLogin(page)
  // The mock already holds the demo design: a new room gives the plan something to do.
  await openSection(page, 'Rooms')
  await page.getByLabel('New room name').fill('Press room')
  await page.getByRole('button', { name: 'Add room' }).click()
  await page.getByLabel('Add participant').selectOption({ label: 'Force: Blue' })
  await page.getByLabel('With access').selectOption('write')
  await page.getByRole('button', { name: 'Add participant' }).click()
  await expect(page.getByLabel('Access for Force: Blue')).toHaveValue('write')
  await openSection(page, 'Publish')
  await page.getByRole('button', { name: /Check the server and plan|Plan again/ }).click()
  const plan = page.getByRole('region', { name: 'Publish plan' })
  await expect(plan).toBeVisible()
  // The demo seed's vault (ADM-37) must keep Blue Observer read-only in the new room: unlock it
  // with the demo passphrase the dialog shows (NFR-6); unlocking plans again.
  await page.getByRole('button', { name: 'Unlock the vault' }).click()
  const vault = page.getByRole('alertdialog', { name: 'Unlock the vault' })
  await vault.getByLabel('Passphrase', { exact: true }).fill('demo-observer-vault')
  await vault.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Vault unlocked.')).toBeVisible({ timeout: 20_000 })
  await expect(plan.getByRole('button', { name: /^Publish \d+ changes?…$/ })).toBeEnabled()
  // The groups collapsed, with Access open to show its summarised batches.
  const access = plan.getByRole('region', { name: 'Access' }).getByRole('button').first()
  await access.click()
  await expect(access).toHaveAttribute('aria-expanded', 'true')
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-publish-plan')
})

// WP 4.3: the template builder, the raw editor and a room's template settings, on the demo's
// templates (the support request has linked drop-downs and a role picker).
async function openTemplate(page: Page, name: string): Promise<void> {
  await adminLogin(page)
  await openSection(page, 'Templates')
  await page
    .getByRole('list', { name: 'Templates' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
  await expect(page.getByRole('heading', { level: 3, name: `Template: ${name}` })).toBeVisible()
}

test('admin template builder', { tag: '@screenshot' }, async ({ page }) => {
  await openTemplate(page, 'Support request')
  await page
    .getByRole('list', { name: 'Fields' })
    .getByRole('button', { name: /^Detail/ })
    .click()
  await expect(page.getByRole('group', { name: 'When Support is air' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Preview of Support request' })).toBeVisible()
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-template-builder')
})

test('admin template raw editor', { tag: '@screenshot' }, async ({ page }) => {
  await openTemplate(page, 'Contact report')
  await page.getByRole('tab', { name: 'Raw JSON Schema' }).click()
  await expect(page.getByRole('textbox', { name: 'JSON Schema of Contact report' })).toBeVisible()
  await expect(page.getByText('No problems: the template is inside the profile.')).toBeVisible()
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-template-raw')
})

test('admin room templates', { tag: '@screenshot' }, async ({ page }) => {
  await adminLogin(page)
  await openSection(page, 'Rooms')
  await page.getByRole('button', { name: 'Blue Reports', exact: true }).click()
  const templates = page.getByRole('group', { name: 'Templates' })
  await expect(templates.getByLabel('Force: Blue may use Situation report')).toBeChecked()
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-room-templates')
})
