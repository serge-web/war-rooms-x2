// Driving the multi-client view (WP 2.9) as a user would, shared by its spec and the SC-7
// scenario.
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

export const pane = (page: Page, n: number) =>
  page.getByRole('region', { name: `Pane ${n}`, exact: true })
export const tabsIn = (scope: Locator) => scope.locator('.flexlayout__layout_main').getByRole('tab')
export const forcePanel = (scope: Locator | Page) =>
  scope.getByRole('region', { name: 'Force panel' })
export const mockStatus = (page: Page) =>
  page.getByRole('group', { name: 'Mock database' }).getByRole('status')

export async function openMulti(page: Page): Promise<void> {
  await page.goto('./#/multi')
  await expect(page.getByRole('heading', { name: 'Multi-client view' })).toBeVisible()
  await expect(pane(page, 1).getByLabel('Backend: MOCK')).toBeVisible()
}

export async function quickLogIn(scope: Locator, label: string): Promise<void> {
  await scope.getByRole('button', { name: `Log in as ${label}`, exact: true }).click()
}

export async function editObjectives(page: Page, scope: Locator, force: string, text: string) {
  await forcePanel(scope).getByLabel('Show objectives for').selectOption({ label: force })
  await forcePanel(scope)
    .getByRole('button', { name: `Edit ${force} objectives` })
    .click()
  const dialog = page.getByRole('dialog', { name: `Edit ${force} objectives` })
  await dialog.getByRole('textbox', { name: 'Objectives (Markdown)' }).fill(text)
  await dialog.getByRole('button', { name: 'Publish objectives' }).click()
  await expect(dialog).toHaveCount(0)
}
