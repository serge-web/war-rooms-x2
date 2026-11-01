// The template editor in the built app, under its Content-Security-Policy (WP 4.3, F7): the
// builder, the CodeMirror raw editor and the RJSF preview with the interpreting validator run
// with no eval and no blocked style, and axe finds nothing on them (NFR-14).
import { expect, test } from '@playwright/test'
import { expectNoViolations } from './a11y.ts'
import { logIn } from './mock.ts'

test('the template editor runs under the CSP, with no violation (F7, NFR-14)', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  const violations: string[] = []
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { wrxCspViolations: seen })
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push(`${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  page.on('console', (m) => {
    if (/Content Security Policy|unsafe-eval/i.test(m.text())) violations.push(m.text())
  })
  page.on('pageerror', (e) => violations.push(e.message))
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./#/admin')
  await logIn(page, 'admin', 'demo-admin')
  const nav = page.getByRole('navigation', { name: 'Admin sections' })
  await nav.getByRole('button', { name: 'Templates' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Templates' })).toBeVisible()

  // The demo's situation report: locked, as a published room offers it (TD6).
  await expect(page.getByRole('heading', { name: 'Template: Situation report' })).toBeVisible()
  await expect(page.getByText(/A published room has offered this template/)).toBeVisible()
  const preview = page.getByRole('region', { name: 'Preview of Situation report' })
  await preview.getByLabel(/^Summary/).fill('All quiet')
  await preview.getByLabel(/^Reporting force/).selectOption({ label: 'Blue' })
  await expect(preview.getByText('is too long')).toHaveCount(0)
  await expectNoViolations(page, testInfo, 'template builder (locked) and preview')

  await page.getByRole('tab', { name: 'Raw JSON Schema' }).click()
  const editor = page.getByRole('textbox', { name: 'JSON Schema of Situation report' })
  await expect(editor).toBeVisible()
  await expect(page.locator('.cm-editor')).toHaveCSS('border-top-style', 'solid')
  await expectNoViolations(page, testInfo, 'template raw editor')

  // An unlocked copy, edited raw: the linter and the preview's validator both run.
  await page.getByRole('button', { name: 'Copy to new template' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Template: Copy of Situation report' }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Raw JSON Schema' }).click()
  const copy = page.getByRole('textbox', { name: 'JSON Schema of Copy of Situation report' })
  await copy.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(
    JSON.stringify({ schema: { type: 'object', properties: { note: { type: 'string' } } } }),
  )
  await expect(page.getByText(/note.maxLength: a text field needs a maxLength/)).toBeVisible()
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(
    JSON.stringify({
      schema: { type: 'object', properties: { note: { type: 'string', maxLength: 3 } } },
    }),
  )
  const copyPreview = page.getByRole('region', { name: 'Preview of Copy of Situation report' })
  await copyPreview.getByLabel('note').fill('toolong')
  await expect(copyPreview.getByText('is too long')).toBeVisible()

  violations.push(
    ...(await page.evaluate(
      () => (window as unknown as { wrxCspViolations: string[] }).wrxCspViolations,
    )),
  )
  expect(violations).toEqual([])
})
