// The out-of-game column against the mock (WP 2.7, WP 2.11); the umpire's own walk through it,
// posting as the umpire and editing a force's objectives live, is the SC-5 scenario
// (scenarios/sc-5-umpire-monitors.spec.ts). A White Force observer reads but cannot edit; the
// admin posts an announcement from the game view and players see it arrive highlighted (ADM-29,
// PLY-37, PLY-38); objectives written in the admin editor reach players on publish (ADM-23,
// ADM-24); and the server enforces who may post where (PLY-15, PLY-39). Pages of one browser
// context share the mock, as separate tabs do (D17).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ROOM } from '@wrx/schemas/fixtures'
import { DOMAIN, logIn, roomTabs } from './mock.ts'

const column = (page: Page) => page.getByRole('complementary', { name: 'Out-of-game column' })
const forcePanel = (page: Page) => column(page).getByRole('region', { name: 'Force panel' })
const announcements = (page: Page) => column(page).getByRole('region', { name: 'Announcements' })

async function player(page: Page, roleId: string): Promise<void> {
  await page.goto('./')
  await logIn(page, roleId, `demo-${roleId}`)
  await expect(column(page)).toBeVisible()
}

test('the column sits outside the workspace: turn panel, admin panel, force panel (PLY-36, PLY-55, PLY-25)', async ({
  page,
}) => {
  await player(page, 'blue-co')
  const aside = column(page)
  await expect(aside.getByRole('region', { name: 'Turn' }).getByRole('status')).toHaveText(
    'Turn 1, Planning',
  )
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
  expect(order).toEqual(['Turn', null, 'Force panel'])
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

test('a White Force observer sees every room read only and reads, but cannot edit, objectives (§3 rule 4, PLY-35)', async ({
  page,
}) => {
  await player(page, 'white-observer')
  await expect(roomTabs(page)).toHaveText([
    'Blue HQ',
    'Red HQ',
    'Blue–Red negotiation',
    'Blue Reports',
    'Map',
  ])
  // The composers start collapsed for a read-only role (PLY-54); expanded, it says why.
  await page.getByRole('button', { name: 'Show message entry' }).first().click()
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
  await expect(roomTabs(page)).toHaveText([
    'Blue HQ',
    'Red HQ',
    'Blue–Red negotiation',
    'Blue Reports',
    'Map',
  ])
  // ...and the server, which enforces it (PLY-39), lets the umpire post in each, makes the White
  // observer a visitor in each, and keeps Blue out of Red HQ.
  const posted = await page.evaluate(
    async ({ domain, room }) => {
      const host = window.wrxMock
      if (host === undefined) return ['no mock host']
      const results: string[] = []
      // Rooms by GUID (§3 rule 1), with the short names the results use.
      const every: (readonly [string, string])[] = [
        [room.blueHq, 'blue-hq'],
        [room.redHq, 'red-hq'],
        [room.negotiation, 'negotiation'],
      ]
      for (const [user, rooms] of [
        ['admin', every],
        ['white-observer', every],
        ['blue-co', [[room.redHq, 'red-hq'] as const]],
      ] as const) {
        const login = await host.connect({
          endpoint: { websocketUrl: '', domain },
          credentials: { kind: 'password', username: user, password: `demo-${user}` },
          resource: `e2e-${user}`,
        })
        if (!login.ok) return [`${user} login: ${login.error.condition}`]
        const session = login.value
        for (const [id, name] of rooms) {
          const jid = `${id}@${session.services.muc}`
          const joined = await session.muc.join(jid, `${user}-check`)
          if (!joined.ok) {
            results.push(`${user} ${name}: ${joined.error.condition}`)
            continue
          }
          const sent = await session.muc.send(
            jid,
            JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text: 'Access check' } }),
          )
          results.push(`${user} ${name}: ${joined.value.role} ${sent.ok ? 'posted' : 'refused'}`)
        }
        await session.disconnect()
      }
      return results
    },
    { domain: DOMAIN, room: ROOM },
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
