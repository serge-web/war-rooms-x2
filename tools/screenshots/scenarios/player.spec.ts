// The player client on the mock (WP 2.4, 2.5, 2.6, DOC-20): the welcome page with the demo game, the
// shell after logging in as Blue CO with its demo password (NFR-6), the umpire's workspace
// (the admin login, in the White Force), the chat panel, and a room with its composer collapsed
// to a bar holding a draft (PLY-54).
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { freezeClock, mapSettled, shoot } from '../lib/shoot.ts'
import { hostMockInLeaderTab, roomTabs, welcomeLoaded } from './mock-app.ts'

test('player welcome page', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await expect(page.getByRole('region', { name: 'Briefing' })).toContainText('09:00')
  await expect(page.getByRole('img', { name: 'Exercise Northern Gate logo' })).toBeVisible()
  await shoot(page, 'player-welcome')
})

test('player shell, logged in', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('blue-co')
  await page.getByLabel('Password', { exact: true }).fill('demo-blue-co')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(roomTabs(page)).toHaveText([
    'Blue HQ',
    'Blue–Red negotiation',
    'Blue Reports',
    'Map',
  ])
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  await shoot(page, 'player-shell')
})

test('player workspace, umpire', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('demo-admin')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  // PLY-40: up to three columns of rooms; the game info panel opened from the strip (PLY-8).
  await expect(roomTabs(page)).toHaveText([
    'Blue HQ',
    'Red HQ',
    'Blue–Red negotiation',
    'Blue Reports',
    'Map',
    'Umpires',
  ])
  await expect(page.getByLabel('Logged in as Umpire, White')).toBeVisible()
  await page.getByRole('tab', { name: 'Game info', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Game briefing' })).toContainText('09:00')
  await page.mouse.move(0, 0)
  await shoot(page, 'player-workspace')
})

test('player chat panel', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('blue-co')
  await page.getByLabel('Password', { exact: true }).fill('demo-blue-co')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  // WP 2.6: the seeded history as cards with shared headers under a date divider (PLY-43,
  // PLY-45), who is online (PLY-13) and the composer (PLY-44), in the room's theme (PLY-24).
  const room = page.getByRole('region', { name: 'Blue HQ', exact: true })
  const list = room.getByRole('region', { name: 'Messages in Blue HQ' })
  await expect(list).toContainText('Recce team moving to the bridge.')
  await expect(list).toContainText('Start of the room’s history.')
  await expect(room.getByRole('list', { name: 'Online in this room' })).toContainText('Blue CO')
  // The composer is left empty: typing just before the shot switches the Send button from
  // disabled to enabled, and its antialiased corners then rendered differently from run to run.
  await expect(room.getByRole('textbox', { name: 'Message Blue HQ' })).toBeEnabled()
  await page.mouse.move(0, 0)
  await shoot(page, 'player-chat')
})

test('player chat panel, composer collapsed', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('blue-co')
  await page.getByLabel('Password', { exact: true }).fill('demo-blue-co')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  // PLY-54: Blue HQ's composer collapsed to a bar, a draft waiting; the list takes the space.
  const room = page.getByRole('region', { name: 'Blue HQ', exact: true })
  const list = room.getByRole('region', { name: 'Messages in Blue HQ' })
  await expect(list).toContainText('Recce team moving to the bridge.')
  await expect(list).toContainText('Start of the room’s history.')
  await expect(room.getByRole('list', { name: 'Online in this room' })).toContainText('Blue CO')
  await room.getByRole('textbox', { name: 'Message Blue HQ' }).fill('Hold at the bridge')
  await room.getByRole('button', { name: 'Hide message entry' }).click()
  await expect(room.getByText('Draft not sent')).toBeVisible()
  // No focus ring on the toggle in the shot.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.mouse.move(0, 0)
  await shoot(page, 'player-chat-collapsed')
})

test('player map room, an asset selected', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('blue-co')
  await page.getByLabel('Password', { exact: true }).fill('demo-blue-co')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  // WP 5.5: the admin's newest world state on the map, one symbol per asset (PLY-57, PLY-59),
  // over a local tile, with an asset's details.
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  const room = page.getByRole('group', { name: 'Map: world state', exact: true })
  await expect(room.getByText('World state for turn 1: 6 assets')).toBeVisible()
  await expect(room.locator('img.wrx-map__symbol')).toHaveCount(6)
  await room.locator('img.wrx-map__symbol[alt="A Squadron"]').click()
  await expect(room.getByRole('region', { name: 'Asset details' })).toContainText('A Squadron')
  await mapSettled(page)
  await page.mouse.move(0, 0)
  await shoot(page, 'player-map')
})

test('player map room, the table of assets', { tag: '@screenshot' }, async ({ page }) => {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('red-co')
  await page.getByLabel('Password', { exact: true }).fill('demo-red-co')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  const room = page.getByRole('group', { name: 'Map: world state', exact: true })
  await expect(room.locator('img.wrx-map__symbol')).toHaveCount(6)
  await room.getByRole('button', { name: 'Table' }).click()
  await room.getByRole('button', { name: 'Tank Company' }).click()
  await expect(room.getByRole('region', { name: 'Asset details' })).toContainText('Tank Company')
  await page.mouse.move(0, 0)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await shoot(page, 'player-map-table')
})

/** The umpire's map room with two unpublished edits (WP 5.6): a moved asset and a health cut. */
async function umpireDraft(page: Page): Promise<Locator> {
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('demo-admin')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  const room = page.getByRole('group', { name: 'Map: world state', exact: true })
  await expect(room.locator('img.wrx-map__symbol')).toHaveCount(6)
  await room.getByRole('button', { name: 'Table' }).click()
  await room.getByRole('button', { name: 'Tank Company' }).click()
  await room.getByRole('button', { name: 'Edit…' }).click()
  const form = room.getByRole('form', { name: 'Edit Tank Company' })
  await form.getByLabel('Health (%)', { exact: true }).fill('40')
  await form.getByLabel('State', { exact: true }).fill('damaged')
  await form.getByRole('button', { name: 'Save to the draft' }).click()
  await room.getByRole('button', { name: 'Recce Troop' }).click()
  await room.getByRole('button', { name: 'Edit…' }).click()
  const recce = room.getByRole('form', { name: 'Edit Recce Troop' })
  await recce.getByLabel('Latitude', { exact: true }).fill('51.99')
  await recce.getByRole('button', { name: 'Save to the draft' }).click()
  await expect(room.getByText('Unpublished edits: 2 assets changed')).toBeVisible()
  await room.getByRole('button', { name: 'Map', exact: true }).click()
  // The map's tabset maximised, so the editor has the room it would have in its own window.
  await page
    .locator('.flexlayout__tabset_container, .flexlayout__tabset')
    .filter({ has: page.getByRole('tab', { name: 'Map', exact: true }) })
    .getByTitle('Maximize tabset')
    .first()
    .click()
  await room.getByRole('button', { name: 'Show all assets' }).click()
  return room
}

test('umpire world-state editor, unpublished edits', { tag: '@screenshot' }, async ({ page }) => {
  // WP 5.6: the admin's draft on the map with the asset form open, held only in this browser
  // (ADM-44, ADM-45, R25).
  const room = await umpireDraft(page)
  await room.locator('img.wrx-map__symbol[alt="Tank Company"]').click()
  await room.getByRole('button', { name: 'Edit…' }).click()
  await expect(room.getByRole('img', { name: /Symbol preview/ })).toBeVisible()
  await mapSettled(page)
  await page.mouse.move(0, 0)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await shoot(page, 'umpire-world-editor')
})

test('umpire world-state change summary', { tag: '@screenshot' }, async ({ page }) => {
  // WP 5.6: the change summary before a publish on its own (ADM-46), with the message's size (R26).
  const room = await umpireDraft(page)
  await room.getByRole('button', { name: 'Publish world state…' }).click()
  await expect(room.getByRole('group', { name: 'World-state changes' })).toContainText(
    '2 assets: 0 added, 0 removed, 2 changed',
  )
  await mapSettled(page)
  await page.mouse.move(0, 0)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await shoot(page, 'umpire-world-summary')
})

test('umpire script panel', { tag: '@screenshot' }, async ({ page }) => {
  // WP 6.3: the Scripts panel (PY-6, PY-7), docked beside the rooms, with a script in the editor
  // and Python started. No run is shown: its times would differ between captures.
  await freezeClock(page)
  await hostMockInLeaderTab(page)
  await page.goto('./app/')
  await welcomeLoaded(page)
  await page.getByLabel('Login name').fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('demo-admin')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(roomTabs(page)).toHaveCount(6)
  // Dragged from the strip onto the first column of rooms, as a tab of its own there.
  const from = await page.getByRole('tab', { name: 'Scripts', exact: true }).boundingBox()
  const to = await page.getByRole('region', { name: 'Blue HQ', exact: true }).boundingBox()
  if (from === null || to === null) throw new Error('no tab or panel to drag between')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 3, { steps: 12 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 })
  await page.mouse.up()
  const tab = page.getByRole('tab', { name: 'Scripts', exact: true })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  const panel = page.getByRole('region', { name: 'Scripts', exact: true })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'New script' }).click()
  await panel.getByRole('button', { name: 'Rename…' }).click()
  await panel.getByLabel('New name').fill('Resupply the tanks')
  await panel.getByRole('button', { name: 'Rename', exact: true }).click()
  await panel
    .getByRole('textbox', { name: 'Code of Resupply the tanks' })
    .fill(
      [
        'import wrx',
        '',
        'game = wrx.Game()',
        'state = await game.draft()',
        'for asset in state.assets.values():',
        '    if asset.fuel < 50:',
        '        state.assets[asset.id] = asset.model_copy(update={"fuel": 100})',
        '        print("Resupplied", asset.title)',
        'await game.write_draft(state)',
        '',
      ].join('\n'),
    )
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(panel.getByText('(unsaved)')).toHaveCount(0)
  // A PR preview built without Python (WP 6.4) shows the panel saying so instead.
  await expect(
    panel.getByText(/^Python is ready\. |^Python scripts are not available in this build$/),
  ).toBeVisible({ timeout: 60_000 })
  // Its tabset maximised, and scrolled to the top, so the list and the editor both show.
  await page
    .locator('.flexlayout__tabset_container, .flexlayout__tabset')
    .filter({ has: page.getByRole('tab', { name: 'Scripts', exact: true }) })
    .getByTitle('Maximize tabset')
    .first()
    .click()
  await panel.evaluate((element) => {
    element.closest('.flexlayout__tab')?.scrollTo(0, 0)
  })
  await page.mouse.move(0, 0)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await shoot(page, 'umpire-scripts')
})
