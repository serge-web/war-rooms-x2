// SC-4 Observer reads but cannot post (SRD §12). Traces to: PLY-12, D8, S1 (R1).
//
// The Blue observer sees Blue's rooms and their history, and a disabled composer that says why.
// A modified client, logged in with the observer's own credentials, joins Blue HQ and sends a
// message anyway: the server refuses it, and neither Blue CO, the umpire nor the observer ever
// sees it. Both backends; on ejabberd the modified client is the real transport in Node.
import type { Page } from '@playwright/test'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const BLUE_HQ = 'Blue HQ'
const messages = (page: Page) =>
  page.getByRole('region', { name: `Messages in ${BLUE_HQ}`, exact: true })
const tabs = (page: Page) => page.locator('.flexlayout__layout_main').getByRole('tab')

test('SC-4: the Blue observer reads Blue’s rooms; the server refuses a modified client’s post, and nobody sees it (PLY-12, D8, R1)', async ({
  context,
  backend,
}) => {
  test.setTimeout(90_000)
  const errors: string[][] = []
  const open = async (id: string): Promise<Page> => {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1400, height: 900 })
    errors.push(watchErrors(page))
    await openApp(page, backend)
    await logInAs(page, backend, id)
    await expect(tabs(page).first()).toBeVisible({ timeout: 20_000 })
    return page
  }
  const observer = await open('blue-observer')
  const blue = await open('blue-co')
  const umpire = await open('admin')

  // 1. Blue's rooms with their history.
  await expect(observer.getByLabel('Logged in as Blue Observer, Blue')).toBeVisible()
  await expect(tabs(observer)).toHaveText([BLUE_HQ])
  await expect(messages(observer)).toContainText('Orders for the crossing are out.')
  await expect(messages(observer)).toContainText('Recce team moving to the bridge.')

  // 2. The composer is disabled, with an explanation (PLY-12).
  const panel = observer.getByRole('region', { name: BLUE_HQ, exact: true })
  await expect(observer.getByRole('textbox', { name: `Message ${BLUE_HQ}` })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled()
  await expect(panel).toContainText(
    'You are observing this game: you can read this room but not post in it.',
  )

  // 3. A modified client with the observer's credentials posts anyway: the server refuses it.
  const forged = 'Forged order: Blue withdraws from the crossing.'
  const outcome = await backend.raw(observer, 'blue-observer', [
    { op: 'post', room: 'blue-hq', texts: [forged] },
  ])
  expect(outcome).toHaveLength(1)
  expect(outcome[0]).toMatch(/^(forbidden|not-allowed|not-acceptable)$/)

  // Messages reach every occupant in order, so once Blue CO's next post has arrived everywhere,
  // the forged one would have too.
  const after = 'Blue CO: next message after the forged one.'
  await blue.getByRole('textbox', { name: `Message ${BLUE_HQ}`, exact: true }).fill(after)
  await blue.getByRole('textbox', { name: `Message ${BLUE_HQ}`, exact: true }).press('Enter')
  for (const page of [observer, blue, umpire]) {
    await expect(messages(page)).toContainText(after)
    await expect(messages(page)).not.toContainText('Forged order')
  }
  // Nor is it in the room's history for a client that loads it afresh.
  await umpire.reload()
  await logInAs(umpire, backend, 'admin')
  await expect(messages(umpire)).toContainText(after, { timeout: 20_000 })
  await expect(messages(umpire)).not.toContainText('Forged order')
  expect(errors.flat()).toEqual([])
})
