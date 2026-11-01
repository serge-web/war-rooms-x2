// Message templates on the mock (WP 4.2, Annex A): the composer with a template's form in Blue
// Reports, and the card a sent situation report becomes (TD7), in the room's theme (PLY-26).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'
import { hostMockInLeaderTab, welcomeLoaded } from './mock-app.ts'

/** No focus ring or caret in the shot. */
async function blur(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
}

async function openReports(page: Page) {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('blue-co')
  await page.getByLabel('Password', { exact: true }).fill('demo-blue-co')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await page.getByRole('tab', { name: 'Blue Reports', exact: true }).click()
  const room = page.getByRole('region', { name: 'Blue Reports', exact: true })
  await expect(room.getByRole('combobox', { name: 'Message type' })).toBeVisible()
  await expect(room.getByLabel('Reporting force')).toBeVisible()
  return room
}

async function fillSitrep(page: Page) {
  const room = page.getByRole('region', { name: 'Blue Reports', exact: true })
  await room.getByLabel('Reporting force').selectOption({ label: 'Blue' })
  await room.getByLabel('Summary').fill('Holding the bridge at the crossing; recce forward.')
  await room.getByLabel('Readiness (%), exact value').fill('75')
  await room.getByLabel('Threat level').selectOption({ label: 'Medium' })
  await room.getByLabel('As of').fill('2026-01-15')
  return room
}

test('template composer', { tag: '@screenshot' }, async ({ page }) => {
  await openReports(page)
  await fillSitrep(page)
  await blur(page)
  await page.mouse.move(0, 0)
  await shoot(page, 'template-composer')
})

test('template card', { tag: '@screenshot' }, async ({ page }) => {
  await openReports(page)
  const room = await fillSitrep(page)
  await room.getByRole('button', { name: 'Send' }).click()
  const card = room.getByRole('region', { name: 'Messages in Blue Reports' }).locator('.wrx-tcard')
  await expect(card).toContainText('Holding the bridge at the crossing; recce forward.')
  await expect(room.getByLabel('Summary')).toHaveValue('')
  await blur(page)
  await page.mouse.move(0, 0)
  await shoot(page, 'template-card')
})
