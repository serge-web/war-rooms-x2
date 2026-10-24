import { expect, test } from '@playwright/test'

test('the shell shows the backend in use (PLY-1)', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'War Rooms X1' })).toBeVisible()
  await expect(page.getByLabel('Backend: MOCK')).toHaveText('MOCK')
  await expect(page.getByRole('status')).toHaveText('No game has been published yet.')
})

test('the build loads its assets by relative URL (DOC-11)', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'War Rooms X1' })).toBeVisible()
  const foreign = requests.filter((url) => !url.startsWith('http://localhost:4173/'))
  expect(foreign).toEqual([])
})
