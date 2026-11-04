// The real-server build (vite build --mode server): endpoints come from config.json at runtime
// (NFR-9), and the mock stays selectable (PLY-20). The server here is unreachable on purpose:
// the welcome page must fall back to the default theme and still allow login (PLY-27).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { TEST_TILES, TEST_TILE_HOST, mapPanel, openMap, stubTiles, tilesLoaded } from './map.ts'
import { logIn } from './mock.ts'

async function serveConfig(page: Page, body: unknown): Promise<void> {
  await page.route('**/config.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

const UNREACHABLE = {
  server: {
    websocketUrl: 'ws://127.0.0.1:9/xmpp-websocket',
    domain: 'wrx.test',
    label: 'Test server',
  },
}

test('config.json names the real server; it is the default and shown in the badge (NFR-9, PLY-1)', async ({
  page,
}) => {
  await serveConfig(page, UNREACHABLE)
  await page.goto('./')
  await expect(page.getByLabel('Backend: Test server')).toHaveText('Test server')
  await expect(page.getByRole('radio', { name: /Real server: Test server/ })).toBeChecked()
  await expect(
    page.getByText('The game details could not be loaded from the server. You can still log in.'),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  await expect(page.getByLabel('Login name')).toBeEditable()
})

test('the mock stays selectable next to the real server (PLY-20)', async ({ page }) => {
  await serveConfig(page, UNREACHABLE)
  await page.goto('./')
  await page.getByRole('radio', { name: /Mock/ }).check()
  await expect(page.getByLabel('Backend: MOCK')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
  await logIn(page, 'blue-co', 'demo-blue-co')
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  // The choice is remembered in this browser.
  await page.reload()
  await expect(page.getByRole('radio', { name: /Mock/ })).toBeChecked()
})

test('an invalid config.json is reported, and the mock is used', async ({ page }) => {
  await serveConfig(page, { server: { websocketUrl: 'ftp://nowhere', domain: 'wrx.test' } })
  await page.goto('./')
  await expect(page.getByRole('alert').filter({ hasText: 'config.json was ignored' })).toBeVisible()
  await expect(page.getByLabel('Backend: MOCK')).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
})

test('the map’s base tiles come from config.json (NFR-9); with none, there is no base map (WP 5.5)', async ({
  page,
  context,
}) => {
  const tiles = await stubTiles(context)
  await serveConfig(page, { ...UNREACHABLE, map: { tiles: TEST_TILES } })
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await page.getByRole('radio', { name: /Mock/ }).check()
  await logIn(page, 'blue-co', 'demo-blue-co')
  const panel = await openMap(page, 6)
  await tilesLoaded(panel)
  expect(tiles.length).toBeGreaterThan(0)
  expect(tiles.every((t) => t.url.startsWith(`${TEST_TILE_HOST}/`))).toBe(true)
  await expect(panel.getByRole('link', { name: '© Test tiles' })).toBeVisible()
  expect(
    await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),
  ).toContain("img-src 'self' data: blob: https:;")

  // Without a map block: the assets on a plain background, and no tile asked for.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await serveConfig(page, UNREACHABLE)
  const before = tiles.length
  await page.reload()
  await logIn(page, 'blue-co', 'demo-blue-co')
  await openMap(page, 6)
  await expect(mapPanel(page)).toContainText('No base map is configured for this deployment')
  await expect(mapPanel(page).locator('img.leaflet-tile')).toHaveCount(0)
  expect(tiles.length).toBe(before)
})
