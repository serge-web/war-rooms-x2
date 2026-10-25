// The out-of-game column against the mock (WP 2.7, WP 2.11): the admin, as umpire, sees every
// room, posts as the umpire and edits a force's objectives, which that force's player sees live
// (SC-5, PLY-15, PLY-35); a White Force observer reads but cannot edit; the admin posts an
// announcement from the game view and players see it arrive highlighted (ADM-29, PLY-37,
// PLY-38); objectives written in the admin editor reach players on publish (ADM-23, ADM-24); and
// the server enforces who may post where (PLY-15, PLY-39). Pages of one browser context share
// the mock, as separate tabs do (D17).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { DOMAIN, logIn, roomTabs } from './mock.ts'

const column = (page: Page) => page.getByRole('complementary', { name: 'Out-of-game column' })
const forcePanel = (page: Page) => column(page).getByRole('region', { name: 'Force panel' })
const announcements = (page: Page) => column(page).getByRole('region', { name: 'Announcements' })

async function player(page: Page, roleId: string): Promise<void> {
  await page.goto('./')
  await logIn(page, roleId, `demo-${roleId}`)
  await expect(column(page)).toBeVisible()
}

test('the column sits outside the workspace: game time, admin panel, force panel (PLY-36, PLY-25)', async ({
  page,
}) => {
  await player(page, 'blue-co')
  const aside = column(page)
  await expect(aside.getByRole('region', { name: 'Game time' })).toContainText('not used')
  await expect(announcements(page)).toContainText('None yet')
  await expect(forcePanel(page).getByRole('heading', { name: 'Blue CO' })).toBeVisible()
  await expect(forcePanel(page)).toContainText('Blue')
  await expect(forcePanel(page).getByRole('region', { name: 'Objectives' })).toContainText(
    'Secure the crossing.',
  )
  // Top to bottom, and not inside the workspace.
  const order = await aside.evaluate((el) =>
    [...el.querySelectorAll('.wrx-column > section')].map((s) => s.getAttribute('aria-label')),
  )
  expect(order).toEqual(['Game time', null, 'Force panel'])
  expect(
    await page
      .getByRole('main', { name: 'Workspace' })
      .locator('[aria-label="Out-of-game column"]')
      .count(),
  ).toBe(0)
  // A fixed width, which a narrower window does not change.
  const width = await aside.evaluate((el) => el.getBoundingClientRect().width)
  await page.setViewportSize({ width: 1000, height: 800 })
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(width)
  // Players are offered neither the post box nor the objectives editor.
  await expect(announcements(page).getByRole('textbox')).toHaveCount(0)
  await expect(forcePanel(page).getByRole('button', { name: /Edit/ })).toHaveCount(0)
})

test('SC-5: the admin, as umpire, sees every room, posts as the umpire and amends Red’s objectives live (PLY-15, PLY-35)', async ({
  context,
}) => {
  const red = await context.newPage()
  await player(red, 'red-co')
  const redObjectives = forcePanel(red).getByRole('region', { name: 'Objectives' })
  await expect(redObjectives).toContainText('Delay Blue.')

  // 1. The admin login is the umpire, in the White Force, and sees every room.
  const umpire = await context.newPage()
  await umpire.setViewportSize({ width: 1400, height: 900 })
  await player(umpire, 'admin')
  await expect(umpire.getByLabel('Logged in as Umpire, White')).toBeVisible()
  await expect(roomTabs(umpire)).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation'])
  await expect(forcePanel(umpire).getByRole('heading', { name: 'Umpire' })).toBeVisible()

  // 3. A clarification in Red HQ, which Red sees from the umpire, in White.
  await umpire.getByRole('tab', { name: 'Red HQ', exact: true }).click()
  const box = umpire.getByRole('textbox', { name: 'Message Red HQ', exact: true })
  await box.fill('Clarification: the bridge is passable on foot only.')
  await box.press('Enter')
  await expect(box).toHaveValue('')
  const card = red
    .getByRole('region', { name: 'Messages in Red HQ', exact: true })
    .getByRole('article')
    .filter({ hasText: 'passable on foot only' })
  await expect(card).toContainText('Umpire')
  await expect(card).toContainText('White')

  // 4. Red's objectives, amended with a preview; Red's force panel updates live.
  await forcePanel(umpire).getByLabel('Show objectives for').selectOption({ label: 'Red' })
  await expect(forcePanel(umpire).getByRole('region', { name: 'Red objectives' })).toContainText(
    'Delay Blue.',
  )
  await forcePanel(umpire).getByRole('button', { name: 'Edit Red objectives' }).click()
  const dialog = umpire.getByRole('dialog', { name: 'Edit Red objectives' })
  await dialog
    .getByRole('textbox', { name: 'Objectives (Markdown)' })
    .fill('1. Delay Blue.\n2. **Hold** the east bank until noon.')
  await expect(
    dialog.getByRole('region', { name: 'Objectives preview' }).locator('strong'),
  ).toHaveText('Hold')
  await dialog.getByRole('button', { name: 'Publish objectives' }).click()
  await expect(dialog).toHaveCount(0)

  // Live on Red's page, with no reload (PLY-28).
  await expect(redObjectives).toContainText('Hold the east bank until noon.')
  await expect(redObjectives.locator('strong')).toHaveText('Hold')
  await expect(forcePanel(umpire).getByRole('region', { name: 'Red objectives' })).toContainText(
    'Hold the east bank until noon.',
  )
})

test('a White Force observer sees every room read only and reads, but cannot edit, objectives (§3 rule 4, PLY-35)', async ({
  page,
}) => {
  await player(page, 'white-observer')
  await expect(roomTabs(page)).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation'])
  await expect(page.getByText(/You are observing this game/).first()).toBeVisible()
  await forcePanel(page).getByLabel('Show objectives for').selectOption({ label: 'Blue' })
  await expect(forcePanel(page).getByRole('region', { name: 'Blue objectives' })).toContainText(
    'Secure the crossing.',
  )
  await expect(forcePanel(page).getByRole('button', { name: /Edit/ })).toHaveCount(0)
})

test('the admin posts an announcement from the game view; players see it arrive highlighted (ADM-29, PLY-37, PLY-38)', async ({
  context,
}) => {
  const red = await context.newPage()
  await player(red, 'red-co')
  await expect(announcements(red)).toContainText('None yet')

  const admin = await context.newPage()
  await admin.goto('./')
  await logIn(admin, 'admin', 'demo-admin')
  await expect(admin.getByLabel('Logged in as Umpire, White')).toBeVisible()
  const box = announcements(admin).getByRole('textbox', { name: 'New announcement' })
  await box.fill('Break until 10:30.')
  await box.press('Enter')
  await expect(box).toHaveValue('')
  await box.fill('Back in your rooms, please.')
  await announcements(admin).getByRole('button', { name: 'Post announcement' }).click()
  await expect(box).toHaveValue('')

  // Oldest first, newest at the bottom; the newest is highlighted, then not.
  const items = announcements(red).getByRole('log').getByRole('listitem')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Break until 10:30.')
  await expect(items.nth(1)).toContainText('Back in your rooms, please.')
  await expect(items.nth(1)).toHaveAttribute('data-new', 'true')
  await expect(items.nth(0)).not.toHaveAttribute('data-new', 'true')
  await expect(items.nth(1)).not.toHaveAttribute('data-new', 'true', { timeout: 10_000 })

  // After a reload they are history: in order, none highlighted.
  await red.reload()
  await logIn(red, 'red-co', 'demo-red-co')
  await expect(items).toHaveCount(2)
  await expect(announcements(red).locator('[data-new]')).toHaveCount(0)
})

test('objectives the admin writes in the editor reach the player live on publish (ADM-23, ADM-24)', async ({
  context,
}) => {
  test.setTimeout(120_000)
  const blue = await context.newPage()
  await player(blue, 'blue-co')
  const blueObjectives = forcePanel(blue).getByRole('region', { name: 'Objectives' })
  await expect(blueObjectives).toContainText('Secure the crossing.')

  const admin = await context.newPage()
  await admin.goto('./#/admin')
  await logIn(admin, 'admin', 'demo-admin')
  const nav = admin.getByRole('navigation', { name: 'Admin sections' })
  await nav.getByRole('button', { name: 'Forces' }).first().click()
  await admin
    .getByRole('list', { name: 'Forces' })
    .getByRole('button', { name: 'Blue', exact: true })
    .click()
  await admin.getByRole('textbox', { name: 'Objectives' }).fill('1. Take the bridge by noon.')

  await nav.getByRole('button', { name: 'Publish' }).first().click()
  await admin.getByRole('button', { name: /Check the server and plan|Plan again/ }).click()
  const plan = admin.getByRole('region', { name: 'Publish plan' })
  await plan.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
  const confirm = admin.getByRole('alertdialog', { name: 'Publish these changes?' })
  await confirm.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(admin.getByText(/Publish complete: \d+ steps applied/)).toBeVisible({
    timeout: 60_000,
  })

  await expect(blueObjectives).toContainText('Take the bridge by noon.')
  await expect(blueObjectives).not.toContainText('Secure the crossing.')
})

test('the umpire posts in every room; a White observer reads every room and posts in none; others only in theirs (PLY-15, F5)', async ({
  page,
}) => {
  await player(page, 'admin')
  // Every room...
  await expect(roomTabs(page)).toHaveText(['Blue HQ', 'Red HQ', 'Blue–Red negotiation'])
  // ...and the server, which enforces it (PLY-39), lets the umpire post in each, makes the White
  // observer a visitor in each, and keeps Blue out of Red HQ.
  const posted = await page.evaluate(
    async ({ domain }) => {
      const host = window.wrxMock
      if (host === undefined) return ['no mock host']
      const results: string[] = []
      for (const [user, rooms] of [
        ['admin', ['blue-hq', 'red-hq', 'negotiation']],
        ['white-observer', ['blue-hq', 'red-hq', 'negotiation']],
        ['blue-co', ['red-hq']],
      ] as const) {
        const login = await host.connect({
          endpoint: { websocketUrl: '', domain },
          credentials: { kind: 'password', username: user, password: `demo-${user}` },
          resource: `e2e-${user}`,
        })
        if (!login.ok) return [`${user} login: ${login.error.condition}`]
        const session = login.value
        for (const room of rooms) {
          const jid = `${room}@${session.services.muc}`
          const joined = await session.muc.join(jid, `${user}-check`)
          if (!joined.ok) {
            results.push(`${user} ${room}: ${joined.error.condition}`)
            continue
          }
          const sent = await session.muc.send(
            jid,
            JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text: 'Access check' } }),
          )
          results.push(`${user} ${room}: ${joined.value.role} ${sent.ok ? 'posted' : 'refused'}`)
        }
        await session.disconnect()
      }
      return results
    },
    { domain: DOMAIN },
  )
  expect(posted.slice(0, 6)).toEqual([
    'admin blue-hq: moderator posted',
    'admin red-hq: moderator posted',
    'admin negotiation: moderator posted',
    'white-observer blue-hq: visitor refused',
    'white-observer red-hq: visitor refused',
    'white-observer negotiation: visitor refused',
  ])
  expect(posted[6]).toMatch(/^blue-co red-hq: (?!.*posted)/)
})
