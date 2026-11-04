// SC-3 Cross-force chat, including a dropped connection (SRD §12). Traces to: PLY-2, PLY-9–11,
// ARC-4, §3 rule 3.
//
// Blue and Red talk in the negotiation room: Red sees Blue's post at once, by role name and
// force colour, with an unread badge while the tab is hidden. Then Red's network goes away while
// Blue posts three more; Red shows it is reconnecting, comes back, and has each of the three
// once, in order. Scrolling back pages in older history. Both backends: on ejabberd Red's browser
// context goes offline; on the mock, which runs in the browser, Red's tab loses its mock
// connection instead (backend.ts, `setNetwork`).
import type { Page } from '@playwright/test'
import { ROOM } from '@wrx/schemas/fixtures'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const TALKS = 'Blue–Red negotiation'
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const messages = (page: Page) =>
  page.getByRole('region', { name: `Messages in ${TALKS}`, exact: true })
const composer = (page: Page) =>
  page.getByRole('textbox', { name: `Message ${TALKS}`, exact: true })

/** History older than the first page a client loads (PLY-49). */
const HISTORY = Array.from(
  { length: 120 },
  (_, i) => `Earlier item ${String(i + 1).padStart(3, '0')}`,
)
/** How long Red's network stays away: several reconnection attempts, within the back-off budget. */
const OFFLINE_MS = 6_000

test('SC-3: Blue and Red chat across forces; Red’s dropped connection loses, repeats and reorders nothing (PLY-2, PLY-9–11, ARC-4)', async ({
  context,
  peerContext,
  backend,
}) => {
  test.setTimeout(120_000)
  const blue = await context.newPage()
  await blue.setViewportSize({ width: 1400, height: 900 })
  const blueErrors = watchErrors(blue)
  await openApp(blue, backend)
  // The negotiation already has more history than one page (PLY-49).
  await backend.asAdmin(blue, [{ op: 'post', room: ROOM.negotiation, texts: HISTORY }])
  await logInAs(blue, backend, 'blue-co')
  await expect(tab(blue, TALKS)).toBeVisible({ timeout: 20_000 })
  // Four rooms in three columns: Blue's negotiation starts behind Blue HQ.
  await tab(blue, TALKS).click()

  const red = await peerContext.newPage()
  await red.setViewportSize({ width: 1400, height: 900 })
  const redErrors = watchErrors(red)
  await openApp(red, backend)
  await logInAs(red, backend, 'red-co')
  await expect(tab(red, TALKS)).toBeVisible({ timeout: 20_000 })
  await expect(messages(red)).toContainText('Earlier item 120')
  // Red keeps the negotiation behind Red HQ, so it is a hidden tab.
  await tab(red, TALKS).focus()
  await red.keyboard.press('Alt+Shift+ArrowLeft')
  await tab(red, 'Red HQ').click()
  await expect(red.getByRole('region', { name: TALKS, exact: true })).toBeHidden()

  // 1. Blue posts; Red has it at once, as unread on the hidden tab, then by role name and colour.
  await composer(blue).fill('Blue offers a ceasefire at the crossing.')
  await composer(blue).press('Enter')
  await expect(composer(blue)).toHaveValue('')
  await expect(tab(red, TALKS).getByLabel('1 unread')).toBeVisible()
  await tab(red, TALKS).click()
  const offer = messages(red).getByRole('article').filter({ hasText: 'Blue offers a ceasefire' })
  await expect(offer).toContainText('Blue CO')
  await expect(offer).toHaveAttribute('data-sender', 'blue-co')
  await expect(offer.locator('.wrx-chat__swatch')).toHaveCSS('background-color', 'rgb(29, 78, 216)')
  await expect(tab(red, TALKS).locator('.wrx-unread')).toHaveCount(0)

  // 2. Red's network goes; Blue posts three more while it is away.
  await backend.setNetwork(red, false)
  await expect(red.getByText('Reconnecting…')).toBeVisible({ timeout: 30_000 })
  const dropped = ['While away 1', 'While away 2', 'While away 3']
  for (const text of dropped) {
    await composer(blue).fill(text)
    await composer(blue).press('Enter')
    await expect(composer(blue)).toHaveValue('')
    await expect(messages(blue)).toContainText(text)
  }
  await red.waitForTimeout(OFFLINE_MS)
  await expect(messages(red)).not.toContainText('While away 1')

  // 3. Back: Red rejoins and shows the three once, in order, after what it already had.
  await backend.setNetwork(red, true)
  await expect(red.getByText('Reconnecting…')).toBeHidden({ timeout: 60_000 })
  await expect(messages(red)).toContainText('While away 3', { timeout: 30_000 })
  /** The texts in the list, in reading order (aria-posinset, as the list is virtualised). */
  const latest = () =>
    messages(red)
      .getByRole('article')
      .evaluateAll((all) =>
        all
          .map((a) => ({
            at: Number(a.getAttribute('aria-posinset')),
            text: a.querySelector('.wrx-chat__text')?.textContent ?? '',
          }))
          .sort((x, y) => x.at - y.at)
          .map((m) => m.text),
      )
  await expect
    .poll(async () => (await latest()).slice(-4))
    .toEqual(['Blue offers a ceasefire at the crossing.', ...dropped])
  for (const text of dropped) {
    await expect(messages(red).getByRole('article').filter({ hasText: text })).toHaveCount(1)
  }
  await expect(
    messages(red).getByRole('article').filter({ hasText: 'Blue offers a ceasefire' }),
  ).toHaveCount(1)
  // And Red can still answer.
  await composer(red).fill('Red is back and considering it.')
  await composer(red).press('Enter')
  await expect(messages(blue)).toContainText('Red is back and considering it.')

  // 4. Scrolling back pages in older history, to its start. Scrolling again until the oldest is
  // on screen: each page that arrives, and the list measuring its rows, moves the content.
  const list = messages(red)
  await expect(async () => {
    await list.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(list).toContainText('Earlier item 001', { timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
  await expect(list).toContainText('Start of the room’s history.')

  expect(blueErrors).toEqual([])
  // (Each reconnection attempt while offline is logged by the browser, which watchErrors skips.)
  expect(redErrors).toEqual([])
})
