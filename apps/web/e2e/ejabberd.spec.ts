// Login against the reference ejabberd (deploy/ejabberd), when one is running: the contract CI
// job sets WRX_XMPP_WS. The stack has only the bootstrap admin account and no published game,
// so this checks the real path end to end: anonymous welcome read (D20), password login,
// the shell's no-game state (PLY-32), and logout (PLY-3).
import { expect, test } from '@playwright/test'
import { logIn } from './mock.ts'

const websocketUrl = process.env.WRX_XMPP_WS
const domain = process.env.WRX_XMPP_DOMAIN ?? 'localhost'
const adminPassword = process.env.WRX_XMPP_ADMIN_PASSWORD ?? 'spike-password'

test.skip(websocketUrl === undefined, 'needs WRX_XMPP_WS: start the stack with pnpm stack:up')

test('logs in to ejabberd from the real-server build, and out again (PLY-1, PLY-3)', async ({
  page,
}) => {
  await page.route('**/config.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ server: { websocketUrl, domain, label: 'Reference ejabberd' } }),
    }),
  )
  await page.goto('./')
  await expect(page.getByLabel('Backend: Reference ejabberd')).toBeVisible()
  await expect(page.getByText('No game has been published yet. You can still log in.')).toBeVisible(
    { timeout: 20_000 },
  )
  await logIn(page, 'admin', adminPassword)
  await expect(page.getByLabel('Logged in as Admin')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'No game yet' })).toBeVisible()
  await expect(page.getByLabel('Backend: Reference ejabberd')).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})

test('a wrong password is refused by ejabberd', async ({ page }) => {
  await page.route('**/config.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ server: { websocketUrl, domain } }),
    }),
  )
  await page.goto('./')
  await logIn(page, 'admin', 'not-the-password')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Wrong role id or password.' }),
  ).toBeVisible({ timeout: 20_000 })
})
