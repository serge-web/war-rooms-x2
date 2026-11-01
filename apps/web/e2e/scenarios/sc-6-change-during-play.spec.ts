// SC-6 Admin changes the game during play (SRD §12). Traces to: ADM-13, ADM-25, PLY-6,
// PLY-28–30, D23.
//
// With Blue CO and Red CO online, the admin moves Blue CO to Red and adds a room for Red. The
// publish view lists the online roles affected; the publish grants Red access before it revokes
// Blue's; Blue CO's client switches to Red in place: force panel, objectives and force colour,
// Blue HQ closed with a notice, Red HQ and the new room added, the rest of the layout (and a
// message being typed) untouched. Then the admin deletes Red CO, who is told and logged out.
// Both backends; on ejabberd the admin first imports the published design (admin.ts).
import type { Page } from '@playwright/test'
import { columns } from '../layout.ts'
import { openAdminOnDemo, openSection, plan, publishPlan } from './admin.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const TALKS = 'Blue–Red negotiation'
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const forcePanel = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Out-of-game column' })
    .getByRole('region', { name: 'Force panel' })

test('SC-6: the admin moves an online role to Red and adds a room, then deletes another online role; both apply live (ADM-13, ADM-25, PLY-6, PLY-28–30, D23)', async ({
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
  await expect.poll(() => columns(blue)).toEqual([['Blue HQ'], [TALKS]])
  // A message half written in the negotiation, which the change must not disturb.
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
  const grant = order.indexOf('grant-room:red-hq')
  const revoke = order.indexOf('revoke-room:blue-hq')
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
  await expect(region.locator('li[data-step="grant-room:red-hq"]')).toHaveAttribute(
    'data-state',
    'done',
  )
  await expect(region.locator('li[data-step="revoke-room:blue-hq"]')).toHaveAttribute(
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
  // Red HQ and the new room appear (PLY-6); Blue HQ closes with a notice.
  await expect(tab(blue, 'Red HQ')).toBeVisible({ timeout: 30_000 })
  await expect(tab(blue, 'Red planning')).toBeVisible({ timeout: 30_000 })
  const toasts = blue.getByRole('region', { name: /^Notifications/ })
  await expect(toasts).toContainText('Blue HQ closed')
  await expect(toasts).toContainText('Your role no longer has access to Blue HQ.')
  await expect(tab(blue, 'Blue HQ')).toHaveCount(0, { timeout: 30_000 })
  // The rest of the layout is as it was: the negotiation where it was, the half-written reply
  // still there.
  await expect.poll(async () => (await columns(blue)).some((c) => c[0] === TALKS)).toBe(true)
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

  // 5. The admin deletes Red CO, who is online: told why, and logged out (PLY-29).
  await openSection(admin, 'Roles')
  await admin.getByRole('button', { name: 'Red CO', exact: true }).click()
  await admin.getByRole('button', { name: 'Delete Red CO' }).click()
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete role' }).click()
  await plan(admin, backend)
  await expect(region.getByLabel('Online roles affected').locator('strong')).toContainText('Red CO')
  await publishPlan(admin, [/Delete Red CO/])
  // The publish removes the role's login with its documents; which of the two the client hears
  // of first decides the wording (PLY-29, PLY-50). Either way it says why, and logs out.
  const notice = red
    .getByRole('alert')
    .filter({ hasText: /Your role was deleted|Your login was removed/ })
  await expect(notice).toBeVisible({ timeout: 30_000 })
  await expect(red.getByRole('heading', { name: 'Log in' })).toBeVisible()
  // Blue CO, still online, is undisturbed.
  await expect(blue.getByLabel('Logged in as Blue CO, Red')).toBeVisible()
  expect(blueErrors).toEqual([])
  expect(redErrors).toEqual([])
})
