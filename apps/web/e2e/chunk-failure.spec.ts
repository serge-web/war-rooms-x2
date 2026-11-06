// A chunk loaded on first use that fails to arrive (a timeout, a dropped connection, a redeploy)
// is contained to the part that needed it, with Try again; the rest of the page keeps working.
// Found on a PR preview: the asset form's symbol preview timed out and took the view down.
import { expect, test } from '@playwright/test'
import { mapPanel, openMap, stubTiles } from './map.ts'
import { logIn } from './mock.ts'

test.use({ contextOptions: { reducedMotion: 'reduce' } })

test('a lazy chunk that fails to load shows Try again in place, and loads on retry', async ({
  context,
  page,
}) => {
  await stubTiles(context)
  let block = true
  await context.route(/\/assets\/symbol-preview-[^/?]*\.js(\?.*)?$/, (route) =>
    block ? route.abort('timedout') : route.continue(),
  )
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.goto('./')
  await logIn(page, 'admin', 'demo-admin')
  const panel = await openMap(page, 6)
  await panel.getByRole('button', { name: 'Table', exact: true }).click()
  await panel.getByRole('button', { name: '1st Rifles', exact: true }).click()
  await panel.locator('.wrx-map__details').getByRole('button', { name: 'Edit…' }).click()
  const form = panel.getByRole('form', { name: 'Edit 1st Rifles' })

  // The retries run out, and only the preview says so; the form stays usable.
  await expect(form.getByText('The symbol preview could not be loaded')).toBeVisible({
    timeout: 15_000,
  })
  await expect(form.getByLabel('Title', { exact: true })).toBeEditable()
  await expect(mapPanel(page)).toBeVisible()

  block = false
  await form.getByRole('button', { name: 'Try again' }).click()
  await expect(form.getByText('The symbol preview could not be loaded')).toHaveCount(0)
  await expect(form.getByRole('img', { name: /Symbol preview for/ })).toBeVisible()
})

test('a chunk that times out once is fetched again by itself, with no message', async ({
  context,
  page,
}) => {
  await stubTiles(context)
  let failures = 1
  await context.route(/\/assets\/symbol-preview-[^/?]*\.js(\?.*)?$/, (route) => {
    if (failures > 0) {
      failures -= 1
      return route.abort('timedout')
    }
    return route.continue()
  })
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.goto('./')
  await logIn(page, 'admin', 'demo-admin')
  const panel = await openMap(page, 6)
  await panel.getByRole('button', { name: 'Table', exact: true }).click()
  await panel.getByRole('button', { name: '1st Rifles', exact: true }).click()
  await panel.locator('.wrx-map__details').getByRole('button', { name: 'Edit…' }).click()
  const form = panel.getByRole('form', { name: 'Edit 1st Rifles' })
  await expect(form.getByRole('img', { name: /Symbol preview for/ })).toBeVisible()
  await expect(form.getByText('The symbol preview could not be loaded')).toHaveCount(0)
  expect(failures).toBe(0)
})
