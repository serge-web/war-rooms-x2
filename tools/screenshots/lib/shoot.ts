// Repeatable screenshots (DOC-20): a fixed clock, no animation or caret, fonts loaded, and the
// page settled before capture. Scenarios call shoot() and nothing else saves images.
import { mkdirSync } from 'node:fs'
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

/** Call before the first navigation. */
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME)
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
