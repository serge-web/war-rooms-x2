// SC-6 Admin changes the game during play (SRD §12). Traces to: ADM-13, ADM-25, PLY-5, PLY-28–30, D23.
//
// With Blue CO and Red CO online, the admin moves Blue CO to Red and adds a room for Red. The
// publish view lists the online roles affected; the publish grants Red access before it revokes
// Blue's; Blue CO's client switches to Red in place: force panel, objectives and force colour,
// Blue HQ and Blue Reports closed with a notice. The change is structural (§3 rule 8), so the
// layout resets to the default with Red's rooms and the new one, with a notice (PLY-5, PLY-30);
// a message being typed survives it. Renaming the new room and moving it up the list is not
// structural (Nov 4, 2026): the layout stays. Then the admin deletes Red CO, who is told and
// logged out; a role removed is not structural either (WP 5.9), so Blue CO keeps its layout.
// Both backends; on ejabberd the admin first imports the published design (admin.ts).
import type { Page } from '@playwright/test'
import { ROOM } from '@wrx/schemas/fixtures'
import { columns } from '../layout.ts'
import { openAdminOnDemo, openSection, plan, publishPlan } from './admin.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const TALKS = 'Blue–Red negotiation'
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const forcePanel = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Out-of-game column' })
    .getByRole('region', { name: 'Force panel' })

test('SC-6: the admin moves an online role to Red and adds a room, then deletes another online role; both apply live (ADM-13, ADM-25, PLY-5, PLY-28–30, D23)', async ({
  context,
  backend,
}, testInfo) => {
  test.setTimeout(240_000)
  const player = async (id: string) => {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1400, height: 900 })
    const errors = watchErrors(page)
    await openApp(page, backend)
    await logInAs(page, backend, id)
    await expect(tab(page, TALKS)).toBeVisible({ timeout: 20_000 })
    return { page, errors }
  }
  const { page: blue, errors: blueErrors } = await player('blue-co')
  const { page: red, errors: redErrors } = await player('red-co')
  // Four rooms in three columns: the negotiation shares the first with Blue HQ, on show.
  await tab(blue, TALKS).click()
  await expect.poll(() => columns(blue)).toEqual([['Blue HQ', TALKS], ['Blue Reports'], ['Map']])
  // A message half written in the negotiation, which the reset must not lose.
  const draft = blue.getByRole('textbox', { name: `Message ${TALKS}`, exact: true })
  await draft.fill('Half-written reply to Red')

  const admin = await context.newPage()
  await admin.setViewportSize({ width: 1400, height: 1000 })
  await openAdminOnDemo(admin, backend, testInfo)

  // 1. Blue CO moves to Red, and Red gets a new room.
  await openSection(admin, 'Roles')
  await admin.getByRole('button', { name: 'Blue CO', exact: true }).click()
  await admin.getByRole('form', { name: 'Role: Blue CO' }).getByLabel('Force').selectOption({
    label: 'Red',
  })
  await openSection(admin, 'Rooms')
  await admin.getByLabel('New room name').fill('Red planning')
  await admin.getByRole('button', { name: 'Add room' }).click()
  await admin.getByLabel('Add participant').selectOption({ label: 'Force: Red' })
  await admin.getByLabel('With access').selectOption('write')
  await admin.getByRole('button', { name: 'Add participant' }).click()
  await expect(admin.getByLabel('Access for Force: Red')).toHaveValue('write')

  // 2. Before anything is applied, the plan names the online roles it affects.
  await plan(admin, backend)
  const region = admin.getByRole('region', { name: 'Publish plan' })
  const online = region.getByLabel('Online roles affected')
  await expect(online).toContainText('Affected while online:')
  await expect(online.locator('strong')).toContainText('Blue CO')
  // The order it will run in: Red access granted before Blue access is revoked (ADM-25).
  await region.getByRole('button', { name: 'Show every step' }).click()
  const order = await region
    .locator('li[data-step]')
    .evaluateAll((all) => all.map((li) => li.getAttribute('data-step')))
  const grant = order.indexOf(`grant-room:${ROOM.redHq}`)
  const revoke = order.indexOf(`revoke-room:${ROOM.blueHq}`)
  expect(grant, order.join(' ')).toBeGreaterThanOrEqual(0)
  expect(revoke, order.join(' ')).toBeGreaterThan(grant)

  // 3. Publish, watching Blue CO's room tabs throughout: the negotiation, which Blue CO keeps,
  // never goes, and there is never a moment with no room at all.
  await blue.evaluate(() => {
    const seen: string[][] = []
    const record = () => {
      const tabs = [...document.querySelectorAll('.flexlayout__layout_main [role="tab"]')].map(
        (t) => t.getAttribute('aria-label') ?? '',
      )
      const last = seen.at(-1)
      if (last?.join('|') !== tabs.join('|')) seen.push(tabs)
    }
    record()
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true })
    Object.assign(window, { wrxTabsSeen: seen })
  })
  await publishPlan(admin)
  await expect(region.locator(`li[data-step="grant-room:${ROOM.redHq}"]`)).toHaveAttribute(
    'data-state',
    'done',
  )
  await expect(region.locator(`li[data-step="revoke-room:${ROOM.blueHq}"]`)).toHaveAttribute(
    'data-state',
    'done',
  )

  // 4. Blue CO's client is Red's now, in place: header, force panel, objectives (PLY-30).
  await expect(blue.getByLabel('Logged in as Blue CO, Red')).toBeVisible({ timeout: 30_000 })
  await expect(blue.locator('.wrx-shell__swatch')).toHaveCSS('background-color', 'rgb(185, 28, 28)')
  await expect(forcePanel(blue).getByRole('heading', { name: 'Blue CO' })).toBeVisible()
  await expect(forcePanel(blue)).toContainText('Red')
  await expect(forcePanel(blue).getByRole('region', { name: 'Objectives' })).toContainText(
    'Delay Blue.',
  )
  await expect(forcePanel(blue).getByRole('region', { name: 'Objectives' })).not.toContainText(
    'Secure the crossing.',
  )
  // Red HQ and the new room appear, found from the directory (PLY-60); Blue HQ and Blue Reports
  // close with one notice (PLY-30).
  await expect(tab(blue, 'Red HQ')).toBeVisible({ timeout: 30_000 })
  await expect(tab(blue, 'Red planning')).toBeVisible({ timeout: 30_000 })
  const toasts = blue.getByRole('region', { name: /^Notifications/ })
  await expect(toasts).toContainText('2 rooms closed')
  await expect(toasts).toContainText('Your role no longer has access to Blue HQ, Blue Reports.')
  await expect(tab(blue, 'Blue HQ')).toHaveCount(0, { timeout: 30_000 })
  await expect(tab(blue, 'Blue Reports')).toHaveCount(0, { timeout: 30_000 })
  // A structural change: the layout is the default for Red's rooms and the new one, with a
  // notice (PLY-5, R28); the half-written reply is still there.
  await expect(toasts).toContainText('Layout reset', { timeout: 30_000 })
  await expect(toasts).toContainText('so your workspace is back to the default layout')
  await expect
    .poll(() => columns(blue), { timeout: 30_000 })
    .toEqual([['Red HQ', TALKS], ['Map'], ['Red planning']])
  // Each column shows its first room; the negotiation, behind Red HQ, kept the reply.
  await expect(tab(blue, 'Red HQ')).toHaveAttribute('aria-selected', 'true')
  await tab(blue, TALKS).click()
  await expect(draft).toHaveValue('Half-written reply to Red')
  const seen = await blue.evaluate(
    () => (window as unknown as { wrxTabsSeen: string[][] }).wrxTabsSeen,
  )
  expect(seen.length, JSON.stringify(seen)).toBeGreaterThan(1)
  for (const tabs of seen) expect(tabs, JSON.stringify(seen)).toContain(TALKS)
  // Red access arrived before Blue access went: no snapshot holds neither HQ.
  for (const tabs of seen) {
    expect(
      tabs.includes('Blue HQ') || tabs.includes('Red HQ'),
      `a moment without either HQ: ${JSON.stringify(seen)}`,
    ).toBe(true)
  }

  // 4b. Not structural (§3 rule 8, Nov 4, 2026): the admin renames the new room and moves it to
  // the top of the list. No role's access changes, so the version stays and Blue CO keeps its
  // layout; a reset would put the room first, as the default follows room order (PLY-40).
  await openSection(admin, 'Rooms')
  await admin.getByRole('button', { name: 'Red planning', exact: true }).click()
  await admin.getByLabel('Name', { exact: true }).fill('Red plans')
  // The Move up button, not dnd-kit's keyboard sensor: that is covered by the admin editor and
  // a11y specs, and under this scenario's live traffic its measured steps can drop a key press.
  const rooms = admin.getByRole('list', { name: 'Rooms' })
  const labels = rooms.locator('.wrx-admin-list-label')
  await expect(labels.filter({ hasText: 'Red plans' })).toHaveCount(1)
  const names = await labels.allTextContents()
  for (let at = names.indexOf('Red plans'); at > 0; at--) {
    await admin.getByRole('button', { name: 'Move Red plans up' }).click()
    await expect(labels.nth(at - 1)).toHaveText('Red plans')
  }
  await expect(labels.first()).toHaveText('Red plans')
  await plan(admin, backend)
  await expect(region).toContainText('no structural change')
  await publishPlan(admin)
  await expect(tab(blue, 'Red plans')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => columns(blue)).toEqual([['Red HQ', TALKS], ['Map'], ['Red plans']])

  // 5. The admin deletes Red CO, who is online: told why, and logged out (PLY-29).
  await openSection(admin, 'Roles')
  await admin.getByRole('button', { name: 'Red CO', exact: true }).click()
  await admin.getByRole('button', { name: 'Delete Red CO' }).click()
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete role' }).click()
  await plan(admin, backend)
  await expect(region.getByLabel('Online roles affected').locator('strong')).toContainText('Red CO')
  // A role removed is not structural (§3 rule 8, WP 5.9): no other role's access changes.
  await expect(region).toContainText('no structural change')
  await publishPlan(admin, [/Delete Red CO/])
  // The publish removes the role's login with its documents; which of the two the client hears
  // of first decides the wording (PLY-29, PLY-50). Either way it says why, and logs out.
  const notice = red
    .getByRole('alert')
    .filter({ hasText: /Your role was deleted|Your login was removed/ })
  await expect(notice).toBeVisible({ timeout: 30_000 })
  await expect(red.getByRole('heading', { name: 'Log in' })).toBeVisible()
  // Blue CO, still online, is undisturbed, its layout included.
  await expect(blue.getByLabel('Logged in as Blue CO, Red')).toBeVisible()
  await expect.poll(() => columns(blue)).toEqual([['Red HQ', TALKS], ['Map'], ['Red plans']])
  expect(blueErrors).toEqual([])
  expect(redErrors).toEqual([])
})
