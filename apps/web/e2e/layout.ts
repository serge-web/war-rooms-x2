// Reading and driving the dockable workspace (WP 2.5) as a user would, shared by the workspace
// spec and the scenarios: the DOM only, nothing reaches into the layout library.
import type { Locator, Page } from '@playwright/test'

/** Room tab names per docked tabset, left to right (then top to bottom). */
export function columns(page: Page | Locator): Promise<string[][]> {
  return page
    .locator('.flexlayout__layout_main')
    .first()
    .evaluate((main) =>
      [...main.querySelectorAll('.flexlayout__tabset')]
        .map((ts) => ({ box: ts.getBoundingClientRect(), ts }))
        .sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y)
        .map(({ ts }) =>
          [...ts.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-label') ?? ''),
        ),
    )
}

/** A user-like mouse drag: press, move in steps so dragenter and dragover fire, release. */
export async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  at: { readonly x: number; readonly y: number } = { x: 0.5, y: 0.5 },
): Promise<void> {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (from === null || to === null) throw new Error('drag: element not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 })
  await page.mouse.move(to.x + to.width * at.x, to.y + to.height * at.y, { steps: 20 })
  await page.mouse.up()
}
