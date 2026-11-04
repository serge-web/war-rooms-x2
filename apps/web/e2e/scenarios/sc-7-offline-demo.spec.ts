// SC-7 Stakeholder demo on the mock, offline (SRD §12). Traces to: PLY-16–22, PLY-34, D14–17,
// NFR-7.
//
// A presenter opens the mock-only build from a static host with no network: the seed scenario
// loads with its history; the multi-client view logs Blue, Red and the umpire into three panes;
// Blue's message arrives in the other two; a second window as a fourth role shares the same mock;
// and the mock resets to the seed afterwards. Moved here from multi.spec.ts. Mock only, by its
// nature: there is no server, and the ejabberd project skips it.
import { expect, test } from '@playwright/test'
import { logIn } from '../mock.ts'
import {
  editObjectives,
  forcePanel,
  paneForce,
  mockStatus,
  openMulti,
  pane,
  quickLogIn,
  tabsIn,
} from '../multi.ts'

test('SC-7: a stakeholder demo on the mock, offline: three panes and a second window share one mock, then reset (PLY-16–22, PLY-34, NFR-7)', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mock-build',
    'SC-7 is the mock-only demo, run offline from a static host: the mock-build project runs it',
  )
  // Three sessions, a second window and a round of chat: longer than the default on a busy runner.
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1800, height: 900 })
  await openMulti(page)
  const second = await context.newPage()
  await second.goto('./')
  await expect(second.getByLabel('Backend: MOCK')).toBeVisible()
  // From here on, no network: the mock runs in this browser (NFR-7, D14).
  await context.setOffline(true)

  // Three panes side by side by default.
  await expect(page.getByRole('radio', { name: '3' })).toBeChecked()
  await expect(page.getByRole('region', { name: /^Pane \d$/ })).toHaveCount(3)
  const boxes = await Promise.all([1, 2, 3].map((n) => pane(page, n).boundingBox()))
  expect(boxes.every((b) => b !== null && Math.abs(b.y - (boxes[0]?.y ?? 0)) < 1)).toBe(true)

  await quickLogIn(pane(page, 1), 'Blue CO (Blue)')
  await quickLogIn(pane(page, 2), 'Red CO (Red)')
  await quickLogIn(pane(page, 3), 'Umpire (White, admin)')
  // Each pane's header: role, force colour and backend (PLY-18).
  await expect(pane(page, 1).getByLabel('Logged in as Blue CO, Blue')).toBeVisible()
  await expect(pane(page, 2).getByLabel('Logged in as Red CO, Red')).toBeVisible()
  await expect(pane(page, 3).getByLabel('Logged in as Umpire, White')).toBeVisible()
  await expect(pane(page, 2).locator('.wrx-shell__swatch')).toHaveCSS(
    'background-color',
    'rgb(185, 28, 28)',
  )
  for (const n of [1, 2, 3]) await expect(pane(page, n).getByLabel('Backend: MOCK')).toBeVisible()
  // Each pane its own session, rooms and layout (PLY-17).
  await expect(tabsIn(pane(page, 1))).toHaveText([
    'Blue HQ',
    'Blue–Red negotiation',
    'Blue Reports',
    'Map',
  ])
  await expect(tabsIn(pane(page, 2))).toHaveText(['Red HQ', 'Blue–Red negotiation', 'Map'])
  await expect(tabsIn(pane(page, 3))).toHaveText([
    'Blue HQ',
    'Red HQ',
    'Blue–Red negotiation',
    'Blue Reports',
    'Map',
  ])

  // The umpire's change (the admin login, SC-5) reaches Red's pane live.
  await editObjectives(page, pane(page, 3), 'Red', '1. Delay Blue until noon.')
  await expect(await paneForce(pane(page, 2))).toContainText('Delay Blue until noon.')
  await expect(await paneForce(pane(page, 1))).toContainText('Secure the crossing.')

  // A message Blue sends in the shared room arrives in Red's and the umpire's panes (SC-7).
  const talks = 'Blue–Red negotiation'
  for (const n of [1, 2, 3]) {
    await tabsIn(pane(page, n)).filter({ hasText: talks }).click()
  }
  // The seed scenario came with its message history (PLY-34).
  await expect(
    pane(page, 1).getByRole('region', { name: `Messages in ${talks}`, exact: true }),
  ).toContainText('Blue proposes a ceasefire at the crossing until noon.')
  const box = pane(page, 1).getByRole('textbox', { name: `Message ${talks}`, exact: true })
  // In a narrow pane the field keeps a usable width, with Send below it rather than squeezing it.
  expect((await box.boundingBox())?.width ?? 0).toBeGreaterThan(150)
  await box.fill('Blue proposes a ceasefire at 10:00.')
  await box.press('Enter')
  for (const n of [2, 3]) {
    await expect(
      pane(page, n).getByRole('region', { name: `Messages in ${talks}`, exact: true }),
    ).toContainText('Blue proposes a ceasefire at 10:00.')
  }

  // The second window, as a fourth role, shares the game (PLY-22).
  await logIn(second, 'blue-observer', 'demo-blue-observer')
  await expect(second.getByLabel('Logged in as Blue Observer, Blue')).toBeVisible()
  await editObjectives(page, pane(page, 3), 'Blue', '1. Hold the crossing.')
  await expect(forcePanel(second)).toContainText('Hold the crossing.')
  await expect(await paneForce(pane(page, 1))).toContainText('Hold the crossing.')

  // After the demo: reset to the seed. Every pane and tab reconnects to it (PLY-21, PLY-2).
  await page.getByRole('button', { name: 'Reset to seed…' }).click()
  await page
    .getByRole('dialog', { name: 'Reset the mock to its seed?' })
    .getByRole('button', { name: 'Reset' })
    .click()
  await expect(mockStatus(page).filter({ hasText: 'back at its seed' })).toBeVisible()
  await expect(await paneForce(pane(page, 1))).toContainText('Secure the crossing.')
  await expect(await paneForce(pane(page, 2))).toContainText('Delay Blue.')
  await expect(forcePanel(second)).toContainText('Secure the crossing.')
})
