import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { base } from '../playwright.config.ts'

const origin = 'http://localhost:4391'

/** Records every request that leaves the local server: the site must work offline (NFR-7). */
function foreignRequests(page: Page): string[] {
  const foreign: string[] = []
  page.on('request', (request) => {
    if (!request.url().startsWith(`${origin}/`)) foreign.push(request.url())
  })
  return foreign
}

test('the home page embeds the app on the mock backend, under a nested base path (DOC-6, DOC-11)', async ({
  page,
}) => {
  const foreign = foreignRequests(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Try it' })).toBeVisible()
  const app = page.frameLocator('.wrx-demo iframe')
  await expect(app.getByRole('heading', { name: 'War Rooms X1' })).toBeVisible()
  await expect(app.getByLabel('Backend: MOCK')).toHaveText('MOCK')
  expect(page.frames().some((f) => f.url() === `${origin}${base}app/`)).toBe(true)
  expect(foreign).toEqual([])
})

test('Mermaid diagrams render from the bundled library (DOC-4, DOC-15)', async ({ page }) => {
  const foreign = foreignRequests(page)
  await page.goto('./architecture')
  const diagrams = page.locator('.wrx-mermaid[data-rendered] svg')
  await expect(diagrams).toHaveCount(5)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(foreign).toEqual([])
})

test('the data dictionary is the generated one (DOC-3)', async ({ page }) => {
  await page.goto('./data-dictionary')
  await expect(page.getByRole('heading', { name: 'Data dictionary', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Game setup' })).toBeVisible()
  await expect(page.getByText('Do not edit by hand')).toBeVisible()
})

test('the PR index page is built (DOC-9)', async ({ page }) => {
  await page.goto('./prs')
  await expect(page.getByRole('heading', { name: 'PR index' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'live demo' })).toHaveAttribute(
    'href',
    '/wrx-e2e/demo/',
  )
})

test('an intermediate post is labelled work in progress (DOC-26)', async ({ page }) => {
  await page.goto('./blog/')
  await page
    .locator('.wrx-posts')
    .getByRole('link', { name: /Schemas first/ })
    .click()
  await expect(page.getByRole('note')).toContainText("hasn't yet passed its phase gate")
})
