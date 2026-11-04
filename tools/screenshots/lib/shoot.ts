// Repeatable screenshots (DOC-20): a fixed clock, no animation or caret, fonts loaded, and the
// page settled before capture. Scenarios call shoot() and nothing else saves images.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { isShotName } from './manifest.ts'

/** Every scenario runs at this instant, so dates and times render the same on every run. */
export const FIXED_TIME = new Date('2026-01-15T09:30:00Z')

export function outDir(): string {
  const dir = process.env.WRX_SHOTS_OUT
  if (dir === undefined || dir === '') throw new Error('WRX_SHOTS_OUT is not set')
  return dir
}

/** The map's one local tile (WP 5.5): the same image for every tile, from the e2e fixtures. */
const TILE_PNG = readFileSync(new URL('../../../apps/web/e2e/fixtures/tile.png', import.meta.url))

/**
 * Call before the first navigation: a fixed clock, and the map's tiles served locally, so no
 * shot depends on (or reaches) a tile server. The config's launch flag makes the demo's tile host
 * unresolvable as well, so a missed request fails rather than fetching.
 */
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME)
  await page
    .context()
    .route('https://tile.openstreetmap.org/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: TILE_PNG }),
    )
}

/** Waits until the map's tiles in view have loaded. */
export async function mapSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('img.leaflet-tile').length > 0 &&
      document.querySelectorAll('img.leaflet-tile:not(.leaflet-tile-loaded)').length === 0,
  )
}

export async function shoot(page: Page, name: string): Promise<void> {
  if (!isShotName(name)) throw new Error(`Bad screenshot name: ${name}`)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const dir = outDir()
  mkdirSync(dir, { recursive: true })
  await page.screenshot({
    path: join(dir, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  })
}
