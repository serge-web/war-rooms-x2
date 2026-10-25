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
