// SC-8 Two people share one role (SRD §12). Traces to: D22, S11, R4.
//
// Two people log in as Blue CO, each in their own browser (on the mock, two tabs of one, which
// share its mock): both are in the same rooms, both receive every message, and what either posts
// appears as Blue CO in every client, Red's included; nothing tells the two apart (D22). Both
// backends.
import type { Page } from '@playwright/test'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const TALKS = 'Blue–Red negotiation'
const tabs = (page: Page) => page.locator('.flexlayout__layout_main').getByRole('tab')
const messages = (page: Page, room: string) =>
  page.getByRole('region', { name: `Messages in ${room}`, exact: true })
const composer = (page: Page, room: string) =>
  page.getByRole('textbox', { name: `Message ${room}`, exact: true })

/**
 * Blue CO has four rooms, the map room included, in three columns, so the negotiation starts
 * behind Blue HQ: moved to the next column with the keyboard and put on show, so both are open.
 */
async function talksBeside(page: Page): Promise<void> {
  await page.getByRole('tab', { name: TALKS, exact: true }).focus()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(page.getByRole('tab', { name: TALKS, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(composer(page, TALKS)).toBeVisible()
}

async function post(page: Page, room: string, text: string): Promise<void> {
  await composer(page, room).fill(text)
  await composer(page, room).press('Enter')
  await expect(composer(page, room)).toHaveValue('')
}

test('SC-8: two people logged in as Blue CO both get every message, and each posts as Blue CO (D22, S11, R4)', async ({
  context,
  peerContext,
  backend,
}) => {
  test.setTimeout(90_000)
  const errors: string[][] = []
  const open = async (where: typeof context, id: string): Promise<Page> => {
    const page = await where.newPage()
    await page.setViewportSize({ width: 1400, height: 900 })
    errors.push(watchErrors(page))
    await openApp(page, backend)
    await logInAs(page, backend, id)
    await expect(tabs(page).first()).toBeVisible({ timeout: 20_000 })
    return page
  }
  const first = await open(context, 'blue-co')
  const second = await open(peerContext, 'blue-co')
  const red = await open(context, 'red-co')

  // 1. The same rooms in both, and every message reaches both.
  for (const page of [first, second]) {
    await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
    await expect(tabs(page)).toHaveText(['Blue HQ', TALKS, 'Blue Reports', 'Map'])
    await talksBeside(page)
  }
  await post(red, TALKS, 'Red asks: who speaks for Blue?')
  await post(first, 'Blue HQ', 'First Blue CO: I will take the talks.')
  await post(second, 'Blue HQ', 'Second Blue CO: agreed, I watch the bridge.')
  await post(second, TALKS, 'Blue CO speaks for Blue.')
  for (const page of [first, second]) {
    await expect(messages(page, TALKS)).toContainText('Red asks: who speaks for Blue?')
    await expect(messages(page, 'Blue HQ')).toContainText('First Blue CO: I will take the talks.')
    await expect(messages(page, 'Blue HQ')).toContainText('Second Blue CO: agreed')
    await expect(messages(page, TALKS)).toContainText('Blue CO speaks for Blue.')
  }

  // 2. Each message is Blue CO's in every client, with nothing to tell the two people apart.
  const card = (page: Page, room: string, text: string) =>
    messages(page, room).getByRole('article').filter({ hasText: text })
  for (const page of [first, second]) {
    for (const text of ['First Blue CO', 'Second Blue CO']) {
      await expect(card(page, 'Blue HQ', text)).toHaveAttribute('data-sender', 'blue-co')
      await expect(card(page, 'Blue HQ', text)).toHaveAttribute('aria-label', /(^|, )Blue CO, /)
    }
  }
  const spoken = card(red, TALKS, 'Blue CO speaks for Blue.')
  await expect(spoken).toHaveAttribute('data-sender', 'blue-co')
  await expect(spoken).toHaveAttribute('aria-label', /(^|, )Blue CO, /)
  // The second login's posts show no other name, nick or resource in Red's view either.
  await expect(spoken).not.toContainText(/blue-co\//)
  expect(errors.flat()).toEqual([])
})
