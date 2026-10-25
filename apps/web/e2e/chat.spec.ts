// The chat room panel against the mock (WP 2.6): two clients sending and receiving, with an unread
// badge on a hidden tab (PLY-9, PLY-11, PLY-44); the observer's disabled composer (PLY-12); the
// size cap (PLY-53); paging back through MAM history (PLY-49); and hostile message text that
// stays plain text in a real browser (PLY-14). Two pages of one context share one mock server.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { asMockAdmin, logIn } from './mock.ts'

const ROOMS = { blue: 'Blue HQ', red: 'Red HQ', talks: 'Blue–Red negotiation' } as const

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const messages = (page: Page, room: string) =>
  page.getByRole('region', { name: `Messages in ${room}`, exact: true })
const composer = (page: Page, room: string) =>
  page.getByRole('textbox', { name: `Message ${room}`, exact: true })

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

async function open(page: Page, roleId: string): Promise<string[]> {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('./')
  await logIn(page, roleId, `demo-${roleId}`)
  return errors
}

test('two clients send and receive; a hidden tab counts unread (PLY-9, PLY-11, PLY-43, PLY-44)', async ({
  context,
}) => {
  const blue = await context.newPage()
  const red = await context.newPage()
  const blueErrors = await open(blue, 'blue-co')
  const redErrors = await open(red, 'red-co')

  // History from the demo seed, with role names and local times (PLY-9).
  await expect(messages(blue, ROOMS.talks)).toContainText(
    'Blue proposes a ceasefire at the crossing until noon.',
  )
  await expect(messages(blue, ROOMS.talks).getByRole('article').first()).toContainText('Blue CO')

  // Red stacks the negotiation behind Red HQ, so it is a hidden tab.
  await tab(red, ROOMS.talks).focus()
  await red.keyboard.press('Alt+Shift+ArrowLeft')
  await tab(red, ROOMS.red).click()
  await expect(panel(red, ROOMS.talks)).toBeHidden()

  // Shift+Enter adds a line; Enter sends.
  const box = composer(blue, ROOMS.talks)
  await box.fill('First line')
  await box.press('Shift+Enter')
  await box.pressSequentially('second line')
  await expect(box).toHaveValue('First line\nsecond line')
  await box.press('Enter')
  await expect(box).toHaveValue('')
  await expect(messages(blue, ROOMS.talks)).toContainText('First line\nsecond line')
  await box.fill('And a second message.')
  await box.press('Enter')

  // Red has two unread in the hidden tab, none in the one on screen.
  await expect(tab(red, ROOMS.talks).getByLabel('2 unread')).toBeVisible()
  await expect(tab(red, ROOMS.red).locator('.wrx-unread')).toHaveCount(0)
  await tab(red, ROOMS.talks).click()
  await expect(messages(red, ROOMS.talks)).toContainText('And a second message.')
  await expect(tab(red, ROOMS.talks).locator('.wrx-unread')).toHaveCount(0)
  // Blue's two messages share one header (PLY-43).
  const own = messages(red, ROOMS.talks).locator('article[data-sender="blue-co"]')
  await expect(own.last()).toContainText('And a second message.')
  await expect(own.last().locator('.wrx-chat__header')).toHaveCount(0)

  // Red answers; Blue sees it at once in its visible tab.
  await composer(red, ROOMS.talks).fill('Red agrees to talk.')
  await composer(red, ROOMS.talks).press('Enter')
  await expect(messages(blue, ROOMS.talks)).toContainText('Red agrees to talk.')
  await expect(tab(blue, ROOMS.talks).locator('.wrx-unread')).toHaveCount(0)
  // Both online in the room (PLY-13).
  await expect(
    panel(blue, ROOMS.talks).getByRole('list', { name: 'Online in this room' }),
  ).toContainText('Red CO')

  expect(blueErrors).toEqual([])
  expect(redErrors).toEqual([])
})

test('an observer reads but cannot post (PLY-12)', async ({ page }) => {
  const errors = await open(page, 'blue-observer')
  await expect(messages(page, ROOMS.blue)).toContainText('Orders for the crossing are out.')
  const box = composer(page, ROOMS.blue)
  await expect(box).toBeDisabled()
  await expect(panel(page, ROOMS.blue)).toContainText(
    'You are observing this game: you can read this room but not post in it.',
  )
  await expect(panel(page, ROOMS.blue).getByRole('button', { name: 'Send' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('the composer will not send a message over the size cap (PLY-53)', async ({ page }) => {
  const errors = await open(page, 'blue-co')
  const box = composer(page, ROOMS.blue)
  await expect(box).toBeEnabled()
  await box.fill('x'.repeat(8_001))
  await expect(panel(page, ROOMS.blue)).toContainText('Too long: 8,001 of 8,000 characters')
  await expect(panel(page, ROOMS.blue).getByRole('button', { name: 'Send' })).toBeDisabled()
  await box.press('Enter')
  await expect(box).toHaveValue('x'.repeat(8_001))
  await box.press('Backspace')
  await expect(panel(page, ROOMS.blue).getByRole('button', { name: 'Send' })).toBeEnabled()
  expect(errors).toEqual([])
})

test('scrolling up pages back through the room’s history (PLY-49)', async ({ page }) => {
  const errors = await open(page, 'blue-co')
  await expect(tab(page, ROOMS.blue)).toBeVisible()
  const texts = Array.from(
    { length: 130 },
    (_, i) => `History item ${String(i + 1).padStart(3, '0')}`,
  )
  await asMockAdmin(page, [{ op: 'post', room: 'blue-hq', texts }])
  // A fresh session loads only the latest page, then pages back on scroll.
  await page.reload()
  await logIn(page, 'blue-co', 'demo-blue-co')
  const list = messages(page, ROOMS.blue)
  await expect(list).toContainText('History item 130')
  await expect(list).not.toContainText('Orders for the crossing are out.')
  await expect(async () => {
    await list.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(list).toContainText('Start of the room’s history.', { timeout: 500 })
  }).toPass({ timeout: 15_000 })
  // Each page arrives above the reader, who keeps their place; the top is now the oldest.
  await list.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect(list).toContainText('Orders for the crossing are out.')
  await expect(list).toContainText('History item 001')
  // The virtualised list keeps only what is near the view in the page.
  await expect(list).not.toContainText('History item 130')
  // Back to the newest.
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(list).toContainText('History item 130')
  expect(errors).toEqual([])
})

test('hostile message text stays plain text in a real browser (PLY-14)', async ({ context }) => {
  const sender = await context.newPage()
  const reader = await context.newPage()
  const errors = await open(sender, 'blue-co')
  await open(reader, 'admin')
  const hostile = [
    '<img src=x onerror="window.wrxPwned=1">',
    '<script>window.wrxPwned=2</script>',
    '[click me](javascript:window.wrxPwned=3)',
    '<a href="javascript:window.wrxPwned=4" onclick="window.wrxPwned=5">raw link</a>',
    'javascript:window.wrxPwned=6 **bold?** https://example.org/ok',
  ].join('\n')
  await composer(sender, ROOMS.blue).fill(hostile)
  await composer(sender, ROOMS.blue).press('Enter')
  for (const page of [sender, reader]) {
    const list = messages(page, ROOMS.blue)
    const card = list.getByRole('article').filter({ hasText: 'raw link' })
    await expect(card).toContainText('<script>window.wrxPwned=2</script>')
    await expect(card).toContainText('**bold?**')
    await expect(list.locator('img, script, strong, [onerror], [onclick]')).toHaveCount(0)
    await expect(list.locator('a:not([href^="https://"]):not([href^="http://"])')).toHaveCount(0)
    // Only the real URL is a link.
    await expect(card.getByRole('link')).toHaveCount(1)
    await expect(card.getByRole('link')).toHaveAttribute('href', 'https://example.org/ok')
    await card.getByText(/click me/).click()
    await card.getByText(/raw link/).click()
    expect(await page.evaluate(() => 'wrxPwned' in window)).toBe(false)
  }
  expect(errors).toEqual([])
})
