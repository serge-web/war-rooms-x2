// A templated message's round trip on both backends (WP 4.2, Annex A; not a user scenario, SC-10
// is WP 4.4's): Blue CO sends a contact report from the composer in Blue Reports, and the
// umpire, in another browser, sees it as a card with each field's label and value (TPL-3, TD7).
// On ejabberd it crosses the real server; on the mock, the shared in-browser one.
import type { Page } from '@playwright/test'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const REPORTS = 'Blue Reports'
const panel = (page: Page) => page.getByRole('region', { name: REPORTS, exact: true })
const messages = (page: Page) =>
  page.getByRole('region', { name: `Messages in ${REPORTS}`, exact: true })

test('a templated message crosses the server and is shown as a card (TPL-3, TD7)', async ({
  context,
  peerContext,
  backend,
}) => {
  test.setTimeout(90_000)
  const blue = await context.newPage()
  await blue.setViewportSize({ width: 1400, height: 900 })
  const blueErrors = watchErrors(blue)
  await openApp(blue, backend)
  await logInAs(blue, backend, 'blue-co')
  await blue.getByRole('tab', { name: REPORTS, exact: true }).click({ timeout: 20_000 })

  const umpire = await peerContext.newPage()
  await umpire.setViewportSize({ width: 1400, height: 900 })
  const umpireErrors = watchErrors(umpire)
  await openApp(umpire, backend)
  await logInAs(umpire, backend, 'admin')
  await umpire.getByRole('tab', { name: REPORTS, exact: true }).click({ timeout: 20_000 })

  const form = panel(blue)
  await form
    .getByRole('combobox', { name: 'Message type' })
    .selectOption({ label: 'Contact report' })
  await form.getByLabel('Seen at').fill('2026-10-24T08:40')
  await form.getByLabel('Grid reference').fill('NV2468')
  await form.getByLabel('Strength').fill('30')
  await form.getByLabel('Hostile').check()
  await form.getByRole('button', { name: 'Send' }).click()
  await expect(form.getByLabel('Grid reference')).toHaveValue('', { timeout: 20_000 })

  const card = messages(umpire).locator('.wrx-tcard').filter({ hasText: 'NV2468' })
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.locator('.wrx-tcard__name')).toHaveText('Contact report')
  await expect(card.locator('dt')).toHaveText(['Seen at', 'Grid reference', 'Strength', 'Hostile'])
  await expect(card.locator('dd')).toHaveText([/2026/, 'NV2468', '30', 'Yes'])
  await expect(messages(umpire).locator('.wrx-chat__warning')).toHaveCount(0)
  expect(blueErrors).toEqual([])
  expect(umpireErrors).toEqual([])
})
