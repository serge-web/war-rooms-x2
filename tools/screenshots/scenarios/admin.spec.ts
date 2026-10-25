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
  await page.getByLabel('Role id').fill('admin')
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
  // The groups collapsed, with Access open to show its summarised batches.
  const access = plan.getByRole('region', { name: 'Access' }).getByRole('button').first()
  await access.click()
  await expect(access).toHaveAttribute('aria-expanded', 'true')
  await page.mouse.move(0, 0)
  await shoot(page, 'admin-publish-plan')
})
