// Templated messages against the mock, in the built app under its CSP (WP 4.2, Annex A): in the
// multi-client view, Blue CO sends each of the demo's three templates from a narrow pane, every
// field type among them, and the umpire's pane shows them as cards (TPL-3, TD7); a hostile
// client's message that does not fit its template shows as plain text with a warning (TPL-6);
// a template sent from the keyboard alone; and axe on the composer and the cards (NFR-14).
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { ROOM, TEMPLATE } from '@wrx/schemas/fixtures'
import { expectNoViolations } from './a11y.ts'
import { DOMAIN, logIn } from './mock.ts'
import { isBrowserNotice } from './notices.ts'
import { openMulti, pane, quickLogIn } from './multi.ts'

const REPORTS = 'Blue Reports'

const messages = (scope: Page | Locator) =>
  scope.getByRole('region', { name: `Messages in ${REPORTS}`, exact: true })
const roomPanel = (scope: Page | Locator) =>
  scope.getByRole('region', { name: REPORTS, exact: true })
const messageType = (scope: Page | Locator) =>
  roomPanel(scope).getByRole('combobox', { name: 'Message type' })

/** Errors in the page, and any refusal by the CSP (F7: the form must not need eval). */
async function watch(page: Page): Promise<string[]> {
  const errors: string[] = []
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => {
    if (!isBrowserNotice(e.message)) errors.push(e.message)
  })
  return errors
}

async function openReports(scope: Page | Locator): Promise<void> {
  await scope.getByRole('tab', { name: REPORTS, exact: true }).click()
  await expect(messageType(scope)).toBeVisible()
}

async function choose(scope: Page | Locator, name: string): Promise<Locator> {
  await messageType(scope).selectOption({ label: name })
  const panel = roomPanel(scope)
  await expect(panel.getByRole('button', { name: 'Clear' })).toBeVisible()
  return panel
}

test('each template is sent from a narrow pane and received as a card in another (TPL-3, TD7)', async ({
  page,
}) => {
  const errors = await watch(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openMulti(page)
  await page.getByRole('radio', { name: '2' }).check()
  const blue = pane(page, 1)
  const umpire = pane(page, 2)
  await quickLogIn(blue, 'Blue CO (Blue)')
  await quickLogIn(umpire, 'Umpire (White, admin)')
  await openReports(blue)
  await openReports(umpire)

  // Free text is off here (TD3): the drop-down offers Blue CO's three templates only.
  await expect(messageType(blue).locator('option')).toHaveText([
    'Situation report',
    'Contact report',
    'Support request',
  ])

  // A situation report: force picker, long text, slider with its number, drop-down, date.
  let form = await choose(blue, 'Situation report')
  await form.getByLabel('Reporting force').selectOption({ label: 'Blue' })
  await form.getByLabel('Summary').fill('Holding the bridge at the crossing.')
  await expect(form.getByText('35 of 500 characters')).toBeVisible()
  await form.getByLabel('Readiness (%), exact value').fill('75')
  await expect(form.getByRole('slider', { name: 'Readiness (%)' })).toHaveValue('75')
  await form.getByLabel('Threat level').selectOption({ label: 'High' })
  await form.getByLabel('As of').fill('2026-10-24')
  await form.getByRole('button', { name: 'Send' }).click()
  await expect(form.getByLabel('Summary')).toHaveValue('')

  // A contact report: date and time, patterned text, a whole number, yes/no.
  form = await choose(blue, 'Contact report')
  await form.getByRole('button', { name: 'Send' }).click()
  // Errors inline before sending, announced.
  await expect(form.getByRole('alert')).toHaveText('Not sent: 2 fields need attention.')
  await expect(form.getByLabel('Grid reference')).toHaveAttribute('aria-invalid', 'true')
  await form.getByLabel('Seen at').fill('2026-10-24T08:40')
  await form.getByLabel('Grid reference').fill('NV1234')
  await form.getByLabel('Strength').fill('12')
  await form.getByLabel('Hostile').check()
  await form.getByRole('button', { name: 'Send' }).click()
  await expect(form.getByLabel('Grid reference')).toHaveValue('')

  // A support request: linked drop-downs, a role picker filtered to Blue.
  form = await choose(blue, 'Support request')
  await form.getByLabel('Support').selectOption('logistics')
  await expect(form.getByLabel('Detail').locator('option')).toHaveText([
    'Choose…',
    'fuel',
    'ammunition',
  ])
  await form.getByLabel('Detail').selectOption('ammunition')
  await form.getByLabel('Addressed to').selectOption({ label: 'Blue CO' })
  await form.getByLabel('Urgent').check()
  await form.getByRole('button', { name: 'Send' }).click()
  await expect(form.getByLabel('Urgent')).not.toBeChecked()

  // The umpire's pane: three cards, each field's label and value, pickers as names.
  const cards = messages(umpire).locator('.wrx-tcard')
  await expect(cards).toHaveCount(3)
  const sitrep = cards.nth(0)
  await expect(sitrep.locator('.wrx-tcard__name')).toHaveText('Situation report')
  await expect(sitrep.locator('dt')).toHaveText([
    'Reporting force',
    'Summary',
    'Readiness (%)',
    'Threat level',
    'As of',
  ])
  await expect(sitrep.locator('dd')).toHaveText([
    'Blue',
    'Holding the bridge at the crossing.',
    '75',
    'High',
    /2026/,
  ])
  const contact = cards.nth(1)
  await expect(contact.locator('dt')).toHaveText([
    'Seen at',
    'Grid reference',
    'Strength',
    'Hostile',
  ])
  await expect(contact.locator('dd')).toHaveText([/2026/, 'NV1234', '12', 'Yes'])
  const support = cards.nth(2)
  await expect(support.locator('dd')).toHaveText(['logistics', 'ammunition', 'Blue CO', 'Yes'])
  await expect(messages(umpire).locator('.wrx-chat__warning')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a hostile client’s message that does not fit its template shows as plain text (TPL-6)', async ({
  page,
}, testInfo) => {
  const errors = await watch(page)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await logIn(page, 'admin', 'demo-admin')
  await openReports(page)
  // A modified client posts straight to the room, past the composer's checks.
  const failed = await page.evaluate(
    async ({ domain, room, templateId }) => {
      const host = window.wrxMock
      if (host === undefined) return 'no mock host'
      const login = await host.connect({
        endpoint: { websocketUrl: '', domain },
        credentials: { kind: 'password', username: 'blue-co', password: 'demo-blue-co' },
        resource: 'hostile',
      })
      if (!login.ok) return `login: ${login.error.condition}`
      const jid = `${room}@${login.value.services.muc}`
      const joined = await login.value.muc.join(jid, 'hostile')
      if (!joined.ok) return `join: ${joined.error.condition}`
      const body = JSON.stringify({
        type: 'template',
        schemaVersion: 1,
        content: {
          templateId,
          values: {
            summary: '<img src=x onerror="window.pwned=1"> **bold**',
            readiness: 500,
            asOf: 'yesterday',
          },
        },
      })
      const sent = await login.value.muc.send(jid, body)
      return sent.ok ? undefined : `send: ${sent.error.condition}`
    },
    { domain: DOMAIN, room: ROOM.blueReports, templateId: TEMPLATE.sitrep },
  )
  expect(failed).toBeUndefined()
  const article = messages(page).getByRole('article').last()
  await expect(article.locator('.wrx-chat__warning')).toHaveText(
    'Warning: This message does not fit the template Situation report.',
  )
  await expect(article.locator('.wrx-tcard')).toHaveCount(0)
  await expect(article.locator('.wrx-chat__text')).toContainText(
    'Summary: <img src=x onerror="window.pwned=1"> **bold**',
  )
  await expect(article.locator('img, strong')).toHaveCount(0)
  expect(await page.evaluate(() => 'pwned' in window)).toBe(false)
  // The plain text with its warning passes axe too (NFR-14, WP 4.4).
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expectNoViolations(page, testInfo, 'templated message shown as plain text with a warning')
  expect(errors).toEqual([])
})

test('a template is filled and sent from the keyboard alone; axe passes (NFR-14)', async ({
  page,
}, testInfo) => {
  const errors = await watch(page)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await logIn(page, 'blue-co', 'demo-blue-co')
  await openReports(page)
  const panel = roomPanel(page)
  await messageType(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(messageType(page)).toHaveValue(TEMPLATE.contact)
  // Into the form: date and time, grid, strength, yes/no, then past Clear to Send.
  await page.keyboard.press('Tab')
  const seenAt = panel.getByLabel('Seen at')
  await expect(seenAt).toBeFocused()
  // The browser's own date and time field. How its parts take typed digits (and whether a part
  // moves on by itself) differs between Chromium, Firefox and WebKit, so each part is set with
  // the arrow key every engine gives it (an empty part takes a value on ArrowUp), and Tab moves
  // to the next part, then out of the field to the grid reference.
  const grid = panel.getByLabel('Grid reference')
  for (let i = 0; i < 10 && !(await grid.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Tab')
  }
  await expect(seenAt).toHaveValue(/^\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}/)
  await expect(grid).toBeFocused()
  await page.keyboard.type('NV5678')
  await page.keyboard.press('Tab')
  await page.keyboard.type('40')
  await page.keyboard.press('Tab')
  await expect(panel.getByLabel('Hostile')).toBeFocused()
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Clear' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Send' })).toBeFocused()
  await page.keyboard.press('Enter')
  const card = messages(page).locator('.wrx-tcard').last()
  await expect(card.locator('dd')).toHaveText([/\d/, 'NV5678', '40', 'Yes'])

  // The slider and drop-downs answer the arrow keys too.
  await messageType(page).selectOption({ label: 'Situation report' })
  const slider = panel.getByRole('slider', { name: 'Readiness (%)' })
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(panel.getByLabel('Readiness (%), exact value')).toHaveValue('5')
  await panel.getByLabel('Threat level').focus()
  await page.keyboard.press('ArrowDown')
  await expect(panel.getByLabel('Threat level')).not.toHaveValue('')

  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect(page.locator('[role="feed"][aria-busy="true"]')).toHaveCount(0)
  await expectNoViolations(page, testInfo, 'template composer and card')
  expect(errors).toEqual([])
})
