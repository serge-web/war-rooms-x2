// The theme editor in Chromium, on the dev page (WP 2.8, ADM-18–21): a token edit restyles the
// live preview, an uploaded SVG loses its script before it is stored, a contrast warning
// appears without blocking the save, and each preview pane themes on its own (PLY-26).
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

async function openThemes(page: Page) {
  await page.goto('./')
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('button', { name: 'Themes' })
    .click()
  await expect(page.getByRole('heading', { level: 2, name: 'Themes' })).toBeVisible()
}

const pane = (page: Page, name: RegExp) => page.getByRole('figure', { name })
const scope = (figure: Locator) => figure.locator('[data-wrx-theme]')

async function cssVar(locator: Locator, name: string): Promise<string> {
  return locator.evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name)
}

async function background(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor)
}

test.beforeEach(async ({ page }) => {
  // Start each scenario from the seed: the draft is kept in localStorage.
  await page.goto('./')
  await page.evaluate(() => {
    localStorage.clear()
  })
})

test(
  'editing a token restyles the live preview',
  { tag: '@screenshot' },
  async ({ page }, testInfo) => {
    await openThemes(page)
    const welcome = pane(page, /^Welcome page/)
    const card = scope(welcome).locator('.wrx-preview-card').first()
    expect(await background(card)).toBe('rgb(255, 255, 255)')

    await page.getByLabel('Surface', { exact: true }).fill('#fef3c7')
    await expect.poll(() => background(card)).toBe('rgb(254, 243, 199)')
    for (const name of [/^Welcome page/, /^Room panel/, /^Force panel/]) {
      expect(await cssVar(scope(pane(page, name)), '--wrx-surface')).toBe('#fef3c7')
    }

    // The native picker drives the same token.
    await page.getByLabel('Primary picker').fill('#7c2d12')
    const bar = scope(pane(page, /^Room panel/)).locator('.wrx-preview-bar')
    await expect.poll(() => background(bar)).toBe('rgb(124, 45, 18)')

    await page.getByLabel('Font').selectOption('serif')
    await expect
      .poll(() => cssVar(scope(welcome), '--wrx-font-family'))
      .toContain('WRX IBM Plex Serif')
    await expect
      .poll(() => page.evaluate(() => document.fonts.check("16px 'WRX IBM Plex Serif'")))
      .toBe(true)

    await page
      .getByRole('group', { name: 'Live preview' })
      .screenshot({ path: testInfo.outputPath('themed-preview.png') })
  },
)

test('an uploaded SVG has its script removed before it is stored', async ({ page }) => {
  await openThemes(page)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" onload="document.title='pwned'">
  <script>document.title = 'pwned'</script>
  <rect width="120" height="40" fill="#b45309"/>
  <text x="10" y="26" fill="#fff">LOGO</text>
</svg>`
  await page.getByLabel('Logo').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg),
  })
  const img = scope(pane(page, /^Welcome page/)).getByRole('img')
  await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/)
  const src = (await img.getAttribute('src')) ?? ''
  const stored = Buffer.from(src.split(',')[1] ?? '', 'base64').toString('utf8')
  expect(stored).toContain('<rect')
  expect(stored).not.toContain('<script')
  expect(stored).not.toContain('onload')
  expect(stored).not.toContain('pwned')
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(120)
  expect(await page.title()).not.toBe('pwned')

  // It is in the saved draft's assets, referenced by id from the game theme.
  const draft = await page.evaluate(() => {
    const values: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null) values.push(localStorage.getItem(key) ?? '')
    }
    return values.find((v) => v.includes('wrx1-design'))
  })
  expect(draft).toContain('"logoAssetId":"game-logo-2"')
})

test('a contrast warning appears and the theme is still saved', async ({ page }) => {
  await openThemes(page)
  const report = page.getByRole('region', { name: /Contrast/ })
  await expect(report).toContainText('Every checked colour pair passes.')
  await page.getByLabel('Text', { exact: true }).fill('#c0c0c0')
  await expect(report.getByRole('status')).toContainText('may be hard to read')
  await expect(report.getByRole('status')).toContainText('Text on panels: #c0c0c0 on #ffffff')

  await page.reload()
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('button', { name: 'Themes' })
    .click()
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue('#c0c0c0')
  await expect(page.getByRole('region', { name: /Contrast/ })).toContainText('may be hard to read')
})

test(
  'a force theme styles only the force panel; copy and reset work',
  { tag: '@screenshot' },
  async ({ page }, testInfo) => {
    await openThemes(page)
    await page.getByLabel('Theme for').selectOption('force:blue')
    await page.getByLabel('Primary', { exact: true }).fill('#065f46')
    const force = scope(pane(page, /^Force panel: Blue/))
    await expect.poll(() => cssVar(force, '--wrx-primary')).toBe('#065f46')
    expect(await cssVar(scope(pane(page, /^Welcome page/)), '--wrx-primary')).toBe('#1d4ed8')
    expect(await cssVar(scope(pane(page, /^Room panel/)), '--wrx-primary')).toBe('#1d4ed8')
    await page
      .getByRole('group', { name: 'Live preview' })
      .screenshot({ path: testInfo.outputPath('force-themed.png') })

    await page.getByLabel('Theme for').selectOption('force:red')
    await page.getByLabel('Copy theme from').selectOption('force:blue')
    await page.getByRole('button', { name: 'Copy theme' }).click()
    const red = scope(pane(page, /^Force panel: Red/))
    await expect.poll(() => cssVar(red, '--wrx-primary')).toBe('#065f46')
    await page.getByRole('button', { name: 'Reset to inherit' }).click()
    await expect.poll(() => cssVar(red, '--wrx-primary')).toBe('#1d4ed8')
  },
)
