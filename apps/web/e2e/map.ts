// The map room in the browser (WP 5.5): a local tile in place of every tile server, so no test
// reaches the internet and screenshots repeat (DOC-20), and the panel's parts.
import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import type { BrowserContext, ConsoleMessage, Locator, Page } from '@playwright/test'

/** One 256-pixel tile, served for every tile request. */
export const TILE_PNG = readFileSync(new URL('fixtures/tile.png', import.meta.url))

/** The mock build's tile host (apps/web/src/tiles.ts). */
export const DEMO_TILE_HOST = 'https://tile.openstreetmap.org'
/** A tile server for config.json in the server build's tests. */
export const TEST_TILE_HOST = 'https://tiles.wrx.test'

export const TEST_TILES = {
  url: `${TEST_TILE_HOST}/{z}/{x}/{y}.png`,
  attribution: '© Test tiles',
  attributionUrl: `${TEST_TILE_HOST}/copyright`,
}

/**
 * Serves the local tile for the demo's and the test tile hosts, on a page or a whole context
 * (popouts included). Returns the URLs asked for, with the Referer each sent.
 */
export async function stubTiles(
  target: Page | BrowserContext,
): Promise<{ readonly url: string; readonly referer: string | undefined }[]> {
  const asked: { url: string; referer: string | undefined }[] = []
  for (const host of [DEMO_TILE_HOST, TEST_TILE_HOST]) {
    await target.route(`${host}/**`, async (route) => {
      asked.push({
        url: route.request().url(),
        referer: (await route.request().headerValue('referer')) ?? undefined,
      })
      await route.fulfill({ contentType: 'image/png', body: TILE_PNG })
    })
  }
  return asked
}

/**
 * A console error from a tile request that a test did not stub. The demo's map room is in the
 * default layout, so a test about something else can still load tiles; Chromium cannot resolve
 * the demo's tile host in tests (playwright.config.ts), and each failed tile logs
 * "Failed to load resource". Those are noise for tests that do not look at the map.
 */
export function isTileNoise(message: ConsoleMessage): boolean {
  const url = message.location().url
  return [DEMO_TILE_HOST, TEST_TILE_HOST].some((host) => url.startsWith(`${host}/`))
}

/** The map room's panel. */
export function mapPanel(scope: Page | Locator, name = 'Map'): Locator {
  return scope.getByRole('group', { name: `${name}: world state`, exact: true })
}

/** The symbols drawn on the map, one `<img>` per asset. */
export function symbols(scope: Page | Locator): Locator {
  return scope.locator('img.wrx-map__symbol')
}

/** Opens the map room's tab and waits for its map to show `count` symbols. */
export async function openMap(page: Page, count: number, name = 'Map'): Promise<Locator> {
  await page.locator('.flexlayout__layout_main').getByRole('tab', { name, exact: true }).click()
  const panel = mapPanel(page, name)
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(symbols(panel)).toHaveCount(count, { timeout: 20_000 })
  return panel
}

/** Waits until every tile in view has loaded. */
export async function tilesLoaded(scope: Page | Locator): Promise<void> {
  const tiles = scope.locator('img.leaflet-tile')
  await expect(tiles.first()).toBeVisible()
  await expect(scope.locator('img.leaflet-tile:not(.leaflet-tile-loaded)')).toHaveCount(0)
}
