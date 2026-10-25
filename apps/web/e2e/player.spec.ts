// The player shell against the mock (WP 2.4): welcome page, login, the session lifecycle and
// the empty states.
import { expect, test } from '@playwright/test'
import { DOMAIN, asMockAdmin, logIn, roomTabs } from './mock.ts'

const rooms = roomTabs

test('welcome page, login as blue-co with its demo password, rooms, logout (PLY-1, PLY-3, PLY-46, NFR-6)', async ({
  page,
}) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
  await expect(page.getByText('A two-sided negotiation exercise.')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Exercise Northern Gate logo' })).toBeVisible()
  const briefing = page.getByRole('region', { name: 'Briefing' })
  await expect(briefing.getByRole('heading', { name: 'Briefing' })).toBeVisible()
  await expect(briefing).toContainText('The exercise starts at 09:00.')

  // The demo logins are listed and labelled as demo passwords (NFR-6).
  const demo = page.getByRole('row', { name: /Blue CO/ })
  await expect(demo).toContainText('blue-co')
  await expect(page.getByRole('columnheader', { name: 'Demo password' })).toBeVisible()
  await expect(demo).toContainText('demo-blue-co')

  await logIn(page, 'blue-co', 'demo-blue-co')
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  await expect(page.getByLabel('Backend: MOCK')).toBeVisible()
  await expect(rooms(page)).toHaveText(['Blue HQ', 'Blue–Red negotiation'])
  await expect(page.getByRole('complementary', { name: 'Out-of-game column' })).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toHaveCount(0)
})

test('a demo login fills in the form', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Use the demo login for Red CO (Red)' }).click()
  await expect(page.getByLabel('Role id')).toHaveValue('red-co')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(rooms(page)).toHaveText(['Red HQ', 'Blue–Red negotiation'])
})

test('a wrong password is refused with a message', async ({ page }) => {
  await page.goto('./')
  await logIn(page, 'blue-co', 'not-the-password')
  await expect(page.getByRole('alert')).toHaveText('Wrong role id or password.')
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})

const FORCED: readonly {
  readonly name: string
  readonly op: Parameters<typeof asMockAdmin>[1][number]
  readonly title: string
}[] = [
  {
    name: 'the admin ends the session (PLY-50)',
    op: { op: 'end-sessions', jid: `blue-co@${DOMAIN}` },
    title: 'Your session was ended',
  },
  {
    name: 'the account is removed (PLY-50)',
    op: { op: 'delete-user', jid: `blue-co@${DOMAIN}` },
    title: 'Your login was removed',
  },
  {
    name: 'the role is deleted (PLY-29)',
    op: { op: 'delete-node', node: 'roles:blue-co' },
    title: 'Your role was deleted',
  },
]

for (const { name, op, title } of FORCED) {
  test(`forced logout with an explanation when ${name}`, async ({ page }) => {
    await page.goto('./')
    await logIn(page, 'blue-co', 'demo-blue-co')
    await expect(rooms(page)).toHaveCount(2)
    await asMockAdmin(page, [op])
    const notice = page.getByRole('alert').filter({ hasText: title })
    await expect(notice).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await notice.getByRole('button', { name: 'Dismiss' }).click()
    await expect(notice).toHaveCount(0)
  })
}

test('with no published game the welcome page falls back and login still works (PLY-27, PLY-32)', async ({
  page,
}) => {
  await page.goto('./')
  await asMockAdmin(page, [{ op: 'delete-node', node: 'game-setup' }])
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
  await expect(
    page.getByText('No game has been published yet. You can still log in.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toHaveCount(0)
  await logIn(page, 'blue-co', 'demo-blue-co')
  await expect(page.getByRole('heading', { name: 'No game yet' })).toBeVisible()
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
})

test('a role with no rooms sees an empty state (PLY-32)', async ({ page }) => {
  await page.goto('./')
  await asMockAdmin(page, [
    { op: 'delete-node', node: 'rooms:blue-hq' },
    { op: 'delete-node', node: 'rooms:negotiation' },
  ])
  await logIn(page, 'blue-co', 'demo-blue-co')
  await expect(page.getByText('Your role has no rooms yet.')).toBeVisible()
})

test('the admin route needs an admin login; multi-client has its placeholder (ADM-1, NFR-8)', async ({
  page,
}) => {
  await page.goto('./#/admin')
  await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible()
  await expect(page.getByLabel('Backend: MOCK')).toBeVisible()
  await logIn(page, 'blue-co', 'demo-blue-co')
  await expect(page.getByRole('alert')).toHaveText(
    'Only the admin account can open the admin backend.',
  )
  await logIn(page, 'admin', 'demo-admin')
  // The design editor (WP 2.2), starting from the demo design on the mock.
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible()

  await page.getByRole('link', { name: 'Multi-client' }).click()
  await expect(page.getByRole('heading', { name: 'Multi-client view' })).toBeVisible()
  await expect(page).toHaveURL(/#\/multi$/)
  await page.getByRole('link', { name: 'Player' }).click()
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible()
})

test('the briefing is sanitised in a real browser: no script, handler or javascript: link survives', async ({
  page,
}) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
  const briefing = [
    '## Hostile briefing',
    '',
    'Image: <img src=x onerror="window.wrxPwned=1">',
    '',
    '<script>window.wrxPwned=2</script>',
    '',
    '[click me](javascript:window.wrxPwned=3)',
    '',
    '<a href="javascript:window.wrxPwned=4" onclick="window.wrxPwned=5">raw link</a>',
    '',
    '![remote](https://example.com/x.png)',
  ].join('\n')
  await asMockAdmin(page, [
    {
      op: 'publish',
      node: 'game-setup',
      payload: JSON.stringify({
        schemaVersion: 1,
        name: 'Exercise Northern Gate',
        description: 'A two-sided negotiation exercise.',
        briefing,
        designVersion: 2,
        theme: { tokens: {} },
        roomTypeDefaults: {},
      }),
    },
  ])
  await page.reload()
  const region = page.getByRole('region', { name: 'Briefing' })
  await expect(region.getByRole('heading', { name: 'Hostile briefing' })).toBeVisible()
  // Raw HTML is shown as text, never parsed.
  await expect(region).toContainText('<script>window.wrxPwned=2</script>')
  await expect(region.locator('img, script, [onerror], [onclick]')).toHaveCount(0)
  await expect(region.locator('a[href^="javascript:" i]')).toHaveCount(0)
  await region.getByText('click me').click()
  await region.getByText('raw link').click()
  expect(await page.evaluate(() => 'wrxPwned' in window)).toBe(false)
})
