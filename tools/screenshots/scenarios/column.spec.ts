// The out-of-game column on the mock (WP 2.7, DOC-20): a player's column with the admin's
// announcements and the force's objectives, and the umpire editing another force's objectives
// with the preview. Announcements are published before login with fixed times, so none is
// highlighted as new and every run renders the same.
import { expect, test } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'
import { demoLogIn, hostMockInLeaderTab, publishAsMockAdmin, welcomeLoaded } from './mock-app.ts'

const ANNOUNCEMENTS = [
  { id: 'a1', text: 'Welcome to Exercise Northern Gate.', postedAt: '2026-01-15T08:30:00.000Z' },
  { id: 'a2', text: 'Break until 10:30. Rooms stay open.', postedAt: '2026-01-15T09:15:00.000Z' },
].map(({ id, text, postedAt }) => ({
  node: 'announcements',
  id,
  payload: { schemaVersion: 1, text, postedAt },
}))

test('player out-of-game column', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await publishAsMockAdmin(page, ANNOUNCEMENTS)
  await demoLogIn(page, 'blue-co')
  const column = page.getByRole('complementary', { name: 'Out-of-game column' })
  await expect(column.getByRole('log').getByRole('listitem')).toHaveCount(2)
  await expect(column.getByRole('region', { name: 'Objectives' })).toContainText('crossing')
  await expect(column.getByRole('img', { name: 'Blue logo' })).toBeVisible()
  await page.mouse.move(0, 0)
  await shoot(page, 'player-column')
})

test('umpire editing objectives', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await publishAsMockAdmin(page, ANNOUNCEMENTS)
  await demoLogIn(page, 'umpire-1')
  const panel = page.getByRole('region', { name: 'Force panel' })
  await panel.getByLabel('Show objectives for').selectOption({ label: 'Red' })
  await expect(panel.getByRole('region', { name: 'Red objectives' })).toContainText('Delay Blue')
  await panel.getByRole('button', { name: 'Edit Red objectives' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Red objectives' })
  await dialog
    .getByRole('textbox', { name: 'Objectives (Markdown)' })
    .fill('1. Delay Blue.\n2. **Hold** the east bank until noon.')
  await expect(dialog.getByRole('region', { name: 'Objectives preview' })).toContainText('noon')
  // No focus ring or caret on the text box, whose repaint is not repeatable (DOC-20).
  await dialog.getByRole('textbox').evaluate((el) => {
    el.blur()
  })
  // The dialog is centred with a transform, which the compositor may rasterise a level apart
  // between runs on anti-aliased edges; pinned to whole pixels it repeats.
  await page.addStyleTag({
    content: '.wrx-dialog { transform: none; top: 64px; left: calc(50% - 256px); }',
  })
  await page.mouse.move(0, 0)
  await shoot(page, 'player-objectives-editor')
})
