// The SVG sanitiser and the bundled fonts in Chromium (WP 2.8, §3 rule 12, NFR-7). DOMPurify
// needs a real DOM, so these are the sanitiser's unit tests, run in a real browser.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'

async function open(page: Page) {
  const external: string[] = []
  page.on('request', (req) => {
    if (!req.url().startsWith('http://localhost:') && !req.url().startsWith('data:')) {
      external.push(req.url())
    }
  })
  await page.goto('./')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  return external
}

async function sanitise(page: Page, svg: string): Promise<{ ok: boolean; value: string }> {
  return page.evaluate((input) => {
    const result = window.wrxTheme.sanitizeSvg(input)
    return result.ok ? { ok: true, value: result.value } : { ok: false, value: result.error.code }
  }, svg)
}

test('removes script, event handlers and dangerous content from SVG', async ({ page }) => {
  await open(page)
  const dirty = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY x "boom">]>
<svg ${SVG_NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert('svg')</script>
  <script xlink:href="https://evil.example/x.js"></script>
  <foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
  <a href="javascript:alert(2)"><rect width="10" height="10" fill="#1d4ed8" onclick="alert(3)"/></a>
  <image href="https://evil.example/track.png" width="1" height="1"/>
  <use xlink:href="#dot"/>
  <circle id="dot" cx="5" cy="5" r="2" fill="red"/>
  <animate attributeName="href" to="javascript:alert(4)"/>
  <set attributeName="onmouseover" to="alert(5)"/>
</svg>`
  const result = await sanitise(page, dirty)
  expect(result.ok).toBe(true)
  const clean = result.value
  expect(clean).toMatch(/^<svg[\s>]/)
  expect(clean).toContain(SVG_NS)
  expect(clean).toContain('viewBox="0 0 10 10"')
  expect(clean).toContain('<rect')
  expect(clean).toContain('<circle')
  expect(clean).toContain('id="dot"')
  for (const bad of [
    '<script',
    'onload',
    'onclick',
    'onmouseover',
    'javascript:',
    'foreignObject',
    'iframe',
    'evil.example',
    'alert',
    'ENTITY',
  ]) {
    expect(clean, bad).not.toContain(bad)
  }
})

test('refuses what is not a single SVG image', async ({ page }) => {
  await open(page)
  expect(await sanitise(page, '<p>hello</p>')).toEqual({ ok: false, value: 'svg' })
  expect(await sanitise(page, `<svg ${SVG_NS}></svg><svg ${SVG_NS}></svg>`)).toEqual({
    ok: false,
    value: 'svg',
  })
  expect(await sanitise(page, '<script>alert(1)</script>')).toEqual({ ok: false, value: 'svg' })
})

test('stores sanitised SVG that still renders through <img>', async ({ page }) => {
  await open(page)
  const svg = `<svg ${SVG_NS} width="40" height="20"><script>document.title='pwned'</script><rect width="40" height="20" fill="#0a0"/></svg>`
  const out = await page.evaluate(async (text) => {
    const bytes = new TextEncoder().encode(text)
    const result = await window.wrxTheme.createAsset({
      id: 'logo',
      bytes,
      declaredType: 'image/svg+xml',
    })
    if (!result.ok) return { error: result.error.code }
    const img = document.createElement('img')
    img.alt = 'logo'
    img.src = window.wrxTheme.assetDataUrl(result.value) ?? ''
    document.body.append(img)
    await img.decode()
    return {
      decoded: atob(result.value.data),
      size: result.value.size,
      sha256: result.value.sha256,
      width: img.naturalWidth,
      title: document.title,
    }
  }, svg)
  expect(out).not.toHaveProperty('error')
  expect(out.decoded).not.toContain('script')
  expect(out.decoded).toContain('<rect')
  expect(out.size).toBe(new TextEncoder().encode(out.decoded ?? '').length)
  expect(out.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(out.width).toBe(40)
  expect(out.title).not.toBe('pwned')
})

test('loads the bundled fonts from the build, with no external requests', async ({ page }) => {
  const external = await open(page)
  const loaded = await page.evaluate(async () => {
    const families = ['WRX IBM Plex Sans', 'WRX IBM Plex Serif', 'WRX IBM Plex Mono']
    const counts = await Promise.all(
      families.flatMap((f) => [
        document.fonts.load(`400 16px '${f}'`, 'Aa'),
        document.fonts.load(`700 16px '${f}'`, 'Aa'),
      ]),
    )
    return counts.map((faces) => faces.length)
  })
  expect(loaded).toEqual([1, 1, 1, 1, 1, 1])
  expect(external).toEqual([])
})
