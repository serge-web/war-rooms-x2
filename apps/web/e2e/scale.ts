// The NFR-11 scale fixture in the running app (WP 3.2): 50 roles, 30 rooms and 10,000 messages
// in one room, imported into the page's shared mock as an admin restores an export (PLY-34), so
// the demo seed stays the default. The admin's draft is the same design, stored where the admin
// backend keeps it, so the editor, the access matrix and the publish plan open at that size too.
import { SCALE_BUSY_ROOM_NAME, scaleDesign, scaleState } from '@wrx/mock-server'
import type { ScaleOptions } from '@wrx/mock-server'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export { SCALE_BUSY_ROOM_NAME, SCALE_PLAYER } from '@wrx/mock-server'

/** Made once per worker: the JSON is a few megabytes. */
let cached: string | undefined
function scaleJson(): string {
  cached ??= JSON.stringify(scaleState())
  return cached
}

/** Opens the app and replaces the mock database with the scale fixture. */
export async function loadScale(page: Page, path = './'): Promise<void> {
  await page.goto(path)
  await page.waitForFunction(() => window.wrxMock !== undefined)
  const error = await page.evaluate(async (json) => {
    const host = window.wrxMock
    if (host === undefined) return 'no mock host'
    const imported = await host.importDatabase(json)
    return imported.ok ? undefined : imported.error
  }, scaleJson())
  expect(error).toBeUndefined()
}

/**
 * Stores the scale design as the admin's draft, already published (as the mock's demo draft
 * starts), in the format of @wrx/admin-ui's `serialiseDraft`.
 */
export async function storeScaleDraft(page: Page, options: ScaleOptions = {}): Promise<void> {
  const design = scaleDesign(options)
  const draft = JSON.stringify({
    format: 'wrx1-admin-draft',
    schemaVersion: 2,
    design,
    meta: {
      publishedRoleIds: design.roles.map((r) => r.id),
      publishedForceIds: design.forces.map((f) => f.id),
    },
  })
  await page.waitForFunction(() => window.wrxMock !== undefined)
  await page.evaluate((text) => {
    const key = window.wrxMock?.names.storageKey('admin-draft')
    if (key === undefined) throw new Error('no mock host')
    localStorage.setItem(key, text)
  }, draft)
}

/** The scale room's message list. */
export function busyRoomList(page: Page) {
  return page.getByRole('region', { name: `Messages in ${SCALE_BUSY_ROOM_NAME}`, exact: true })
}
