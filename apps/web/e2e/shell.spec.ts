// Smoke tests for both builds: the app loads, shows its backend, and loads only its own files.
import { expect, test } from '@playwright/test'

test('the app shows the backend in use and the welcome page (PLY-1, PLY-46)', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'War Rooms X1' })).toBeVisible()
  await expect(page.getByLabel('Backend: MOCK')).toHaveText('MOCK')
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})

test('the build loads its assets by relative URL (DOC-11)', async ({ page, baseURL }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
  const foreign = requests.filter((url) => !url.startsWith(baseURL ?? 'none'))
  expect(foreign).toEqual([])
})

// Security review F7: both builds carry a Content-Security-Policy with no inline script and no
// eval, and the app runs under it (the mock's SharedWorker, IndexedDB, bundled fonts, login, the
// admin page) without a single violation.
test('the build runs under its Content-Security-Policy, with no violation (F7)', async ({
  page,
}) => {
  const violations: string[] = []
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { wrxCspViolations: seen })
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push(`${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text())
  })
  await page.goto('./')
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toContain('unsafe-eval')
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
  await page.getByLabel('Role id').fill('blue-co')
  await page.getByLabel('Password', { exact: true }).fill('demo-blue-co')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.status === 'loaded').length
  })
  expect(fonts).toBeGreaterThan(0)
  violations.push(
    ...(await page.evaluate(
      () => (window as unknown as { wrxCspViolations: string[] }).wrxCspViolations,
    )),
  )
  expect(violations).toEqual([])
})
