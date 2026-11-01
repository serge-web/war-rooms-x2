// Driving the multi-client view (WP 2.9) as a user would, shared by its spec and the SC-7
// scenario.
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { columnTab, roomTabs } from './mock.ts'

export const pane = (page: Page, n: number) =>
  page.getByRole('region', { name: `Pane ${n}`, exact: true })
export const tabsIn = (scope: Locator) => roomTabs(scope)
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

/**
 * A pane's force panel. Three panes side by side are narrow, so each pane's out-of-game column is
 * a workspace tab, in the strip along the bottom, opened here first (FT-1).
 */
export async function paneForce(scope: Locator): Promise<Locator> {
  const open = scope.getByRole('region', { name: 'Out of game', exact: true })
  // Wait for the pane to settle on a form: a wide pane keeps the column, a narrow one has the tab.
  await expect(columnTab(scope).or(forcePanel(scope)).first()).toBeVisible()
  // The tab opens the strip's panel, and a second click would close it again.
  if ((await columnTab(scope).count()) > 0 && !(await open.isVisible())) {
    await columnTab(scope).click()
    await expect(open).toBeVisible()
  }
  return forcePanel(scope)
}

export async function editObjectives(page: Page, scope: Locator, force: string, text: string) {
  await paneForce(scope)
  await forcePanel(scope).getByLabel('Show objectives for').selectOption({ label: force })
  await forcePanel(scope)
    .getByRole('button', { name: `Edit ${force} objectives` })
    .click()
  const dialog = page.getByRole('dialog', { name: `Edit ${force} objectives` })
  await dialog.getByRole('textbox', { name: 'Objectives (Markdown)' }).fill(text)
  await dialog.getByRole('button', { name: 'Publish objectives' }).click()
  await expect(dialog).toHaveCount(0)
}
