// The map room for players (WP 5.5): PLY-57, PLY-58, PLY-59, D25, R23. Both backends.
//
// Red CO opens the map room and sees the admin's turn-1 world state, one symbol per asset. A
// modified client with Red CO's own credentials posts a world state of its own: members have
// voice (S13), so the server takes it, and the client ignores it (PLY-58). The admin publishes
// turn 2 with one more asset, and the map follows live; a later forged state changes nothing.
// After a reload the client pages back through MAM past the forged state to the admin's newest
// (PLY-59). On ejabberd the tiles come from config.json (NFR-9); every tile is local.
import type { Page } from '@playwright/test'
import { LIMITS } from '@wrx/schemas'
import { ROOM, sampleWorldState } from '@wrx/schemas/fixtures'
import type { WorldState } from '@wrx/schemas'
import { mapPanel, openMap, symbols, tilesLoaded } from '../map.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

const body = (state: WorldState) =>
  JSON.stringify({ type: 'world-state', schemaVersion: 1, content: state })

/** The admin's turn 2: the sample state, one asset moved and one added. */
function turnTwo(): WorldState {
  const state = sampleWorldState()
  state.turn = 2
  const id = 'a5500000-0000-4000-8000-000000000001'
  const [first] = Object.values(state.assets)
  if (first === undefined) throw new Error('fixture')
  state.assets[id] = { ...first, id, title: 'Bridging Troop', category: 'engineers', lat: 51.99 }
  first.lat = 51.995
  return state
}

/** A forged state: one asset, a turn far ahead. */
function forged(turn: number): WorldState {
  const [first] = Object.values(sampleWorldState().assets)
  if (first === undefined) throw new Error('fixture')
  return { turn, assets: { [first.id]: { ...first, title: 'Forged unit' } } }
}

const turnText = (page: Page) => mapPanel(page).getByText(/^World state for turn/)

test('the map room shows the admin’s newest world state, live and after a reload, and ignores anyone else’s (PLY-57–59, D25, R23)', async ({
  context,
  backend,
}) => {
  test.setTimeout(120_000)
  const page = await context.newPage()
  await page.setViewportSize({ width: 1400, height: 900 })
  const errors = watchErrors(page)
  await openApp(page, backend)
  await logInAs(page, backend, 'red-co')

  // 1. The admin's turn-1 state, with the base map.
  const panel = await openMap(page, 6)
  await expect(turnText(page)).toHaveText('World state for turn 1: 6 assets')
  await tilesLoaded(panel)
  await expect(panel.getByRole('textbox')).toHaveCount(0)

  // 2. A modified client posts a world state as Red CO: the server takes it, the map ignores it.
  const posted = await backend.raw(page, 'red-co', [
    {
      op: 'post-body',
      room: ROOM.map,
      bodies: [body(forged(9))],
      maxBytes: LIMITS.worldStateStanzaBytes,
    },
  ])
  expect(posted).toEqual(['ok'])

  // 3. The admin publishes turn 2: it replaces turn 1 live. Messages reach an occupant in order,
  // so the forged one has arrived by now, and was not taken.
  await backend.asAdmin(page, [
    {
      op: 'post-body',
      room: ROOM.map,
      bodies: [body(turnTwo())],
      maxBytes: LIMITS.worldStateStanzaBytes,
    },
  ])
  await expect(turnText(page)).toHaveText('World state for turn 2: 7 assets', { timeout: 20_000 })
  await expect(symbols(panel)).toHaveCount(7)
  await expect(panel.locator('img.wrx-map__symbol[alt="Bridging Troop"]')).toHaveCount(1)
  await expect(panel.locator('img.wrx-map__symbol[alt="Forged unit"]')).toHaveCount(0)

  // 4. Another forged state, now the newest message in the room.
  expect(
    await backend.raw(page, 'red-co', [
      {
        op: 'post-body',
        room: ROOM.map,
        bodies: [body(forged(10))],
        maxBytes: LIMITS.worldStateStanzaBytes,
      },
    ]),
  ).toEqual(['ok'])

  // 5. A reload: the client pages back through MAM past the forged state to the admin's turn 2.
  await page.reload()
  await logInAs(page, backend, 'red-co')
  const again = await openMap(page, 7)
  await expect(turnText(page)).toHaveText('World state for turn 2: 7 assets')
  await expect(again.locator('img.wrx-map__symbol[alt="Forged unit"]')).toHaveCount(0)
  await again.locator('img.wrx-map__symbol[alt="Bridging Troop"]').click()
  await expect(again.getByRole('region', { name: 'Asset details' })).toContainText(
    'Categoryengineers',
  )
  expect(errors).toEqual([])
})

// WP 5.7 review: members have voice, so a modified client can bury the admin's state behind
// many posts. Past the search's page limit the map says the state is further back and looks
// again on request, rather than saying none was published (which would let the admin's editor
// start from an empty map).
test('a world state behind many other map-room posts is found by looking further back, never shown as none (PLY-59, WP 5.7)', async ({
  context,
  backend,
}) => {
  test.setTimeout(180_000)
  const page = await context.newPage()
  await page.setViewportSize({ width: 1400, height: 900 })
  const errors = watchErrors(page)
  await openApp(page, backend)
  await logInAs(page, backend, 'red-co')
  await openMap(page, 6)
  const noise = Array.from({ length: 230 }, (_, i) =>
    JSON.stringify({ type: 'chat', schemaVersion: 1, content: `noise ${i}` }),
  )
  expect(
    await backend.raw(page, 'red-co', [{ op: 'post-body', room: ROOM.map, bodies: noise }]),
  ).toEqual(noise.map(() => 'ok'))
  await page.reload()
  await logInAs(page, backend, 'red-co')
  await page
    .locator('.flexlayout__layout_main')
    .getByRole('tab', { name: 'Map', exact: true })
    .click()
  const panel = mapPanel(page)
  await expect(panel.getByText(/was not among this room’s recent messages/)).toBeVisible({
    timeout: 60_000,
  })
  await expect(panel.getByText(/has not published a world state yet/)).toHaveCount(0)
  await panel.getByRole('button', { name: 'Look further back' }).click()
  await expect(symbols(panel)).toHaveCount(6, { timeout: 60_000 })
  await expect(turnText(page)).toHaveText('World state for turn 1: 6 assets')
  expect(errors).toEqual([])
})
