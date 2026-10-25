// The mock host in a real browser (WP 1.5, D17, ARC-7, DOC-10, DOC-17, PLY-21, PLY-22, R7).
// Each test gets a fresh browser context: its own storage, locks, channels and workers. Tabs of
// one context are the tabs of one browser profile.
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import './app/hooks.ts'

type Mode = 'shared-worker' | 'leader'
const MODES: readonly Mode[] = ['shared-worker', 'leader']
const ROOM = 'negotiation'

async function openTab(context: BrowserContext, mode: Mode, deployment = '/dep-a/') {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[${deployment}] ${message.text()}`)
  })
  await page.goto(`${deployment}?hosting=${mode}`)
  await page.waitForFunction(() => 'wrx' in window)
  return page
}

async function player(page: Page, role: string) {
  await page.evaluate((r) => window.wrx.login(r), role)
  await page.evaluate((room) => window.wrx.join(room), ROOM)
}

/** Sends, retrying while the session reconnects to a new host. */
async function send(page: Page, text: string) {
  await expect
    .poll(() => page.evaluate(([room, t]) => window.wrx.send(room, t), [ROOM, text] as const), {
      timeout: 15_000,
    })
    .toBeUndefined()
}

function texts(page: Page) {
  return page.evaluate((room) => window.wrx.texts(room), ROOM)
}

for (const mode of MODES) {
  test.describe(`hosted in a ${mode}`, () => {
    test('two tabs act as two players (PLY-22)', async ({ context }) => {
      const blue = await openTab(context, mode)
      const red = await openTab(context, mode)
      expect(await blue.evaluate(() => window.wrx.hosting)).toBe(mode)
      await player(blue, 'blue-co')
      await player(red, 'red-co')
      await send(blue, 'Blue to Red, over.')
      await expect.poll(() => texts(red)).toContain('Blue to Red, over.')
      await send(red, 'Red to Blue, out.')
      await expect.poll(() => texts(blue)).toContain('Red to Blue, out.')
      await expect(red.locator('#messages')).toContainText('blue-co: Blue to Red, over.')
    })

    test('reset to seed reaches every tab (PLY-21)', async ({ context }) => {
      const blue = await openTab(context, mode)
      const red = await openTab(context, mode)
      await player(blue, 'blue-co')
      await player(red, 'red-co')
      const seed = await texts(red)
      expect(seed.length).toBeGreaterThan(0)
      await send(blue, 'Wiped by the reset.')
      await expect.poll(() => texts(red)).toContain('Wiped by the reset.')

      expect(await red.evaluate(() => window.wrx.reset())).toBeUndefined()
      for (const page of [blue, red]) {
        await expect.poll(() => page.evaluate(() => window.wrx.recoveries())).toBe(1)
        await expect.poll(() => texts(page)).toEqual(seed)
        await expect.poll(() => page.evaluate(() => window.wrx.notices())).toContain('reset')
      }
    })

    test('export and import apply to every tab (PLY-21)', async ({ context }) => {
      const blue = await openTab(context, mode)
      const red = await openTab(context, mode)
      await player(blue, 'blue-co')
      await player(red, 'red-co')
      await send(blue, 'In the export.')
      await expect.poll(() => texts(red)).toContain('In the export.')
      const exported = await red.evaluate(() => window.wrx.exportDb())
      expect(await blue.evaluate(() => window.wrx.reset())).toBeUndefined()
      await expect.poll(() => texts(red)).not.toContain('In the export.')
      expect(await blue.evaluate((json) => window.wrx.importDb(json), exported)).toBeUndefined()
      await expect.poll(() => texts(red)).toContain('In the export.')
      const bad = await blue.evaluate(() => window.wrx.importDb('{"format":"other"}'))
      expect(bad).toBeTruthy()
    })

    test('state survives reloading all tabs', async ({ context }) => {
      const blue = await openTab(context, mode)
      const red = await openTab(context, mode)
      await player(blue, 'blue-co')
      await player(red, 'red-co')
      await send(blue, 'Still here after the reload.')
      await expect.poll(() => texts(red)).toContain('Still here after the reload.')
      for (const page of [blue, red]) {
        await page.reload()
        await page.waitForFunction(() => 'wrx' in window)
      }
      await player(blue, 'blue-co')
      await player(red, 'red-co')
      for (const page of [blue, red]) {
        await expect.poll(() => texts(page)).toContain('Still here after the reload.')
      }
    })

    test('state survives closing every tab', async ({ context }) => {
      const blue = await openTab(context, mode)
      await player(blue, 'blue-co')
      await send(blue, 'Kept after every tab closed.')
      // Let the debounced save land before the only host goes.
      await blue.waitForTimeout(500)
      await blue.close()
      const red = await openTab(context, mode)
      await player(red, 'red-co')
      await expect.poll(() => texts(red)).toContain('Kept after every tab closed.')
    })

    test('deployments under different base paths do not share data (DOC-10)', async ({
      context,
    }) => {
      const a = await openTab(context, mode, '/dep-a/')
      const b = await openTab(context, mode, '/dep-b/')
      await player(a, 'blue-co')
      await player(b, 'red-co')
      const seed = await texts(b)
      await send(a, 'Only deployment A sees this.')
      await expect.poll(() => texts(a)).toContain('Only deployment A sees this.')
      await b.waitForTimeout(500)
      expect(await texts(b)).toEqual(seed)

      // A second tab of B joins B's game, not A's.
      const b2 = await openTab(context, mode, '/dep-b/')
      await player(b2, 'blue-co')
      expect(await texts(b2)).not.toContain('Only deployment A sees this.')
      await send(b2, 'Only deployment B sees this.')
      await expect.poll(() => texts(b)).toContain('Only deployment B sees this.')
      await a.waitForTimeout(500)
      expect(await texts(a)).not.toContain('Only deployment B sees this.')

      const databases = await a.evaluate(async () =>
        (await indexedDB.databases()).map((d) => d.name ?? ''),
      )
      expect(databases.sort()).toEqual(['wrx1-mock:/dep-a/:db', 'wrx1-mock:/dep-b/:db'])
    })

    test('a corrupted stored state resets with a notice, and the page loads (DOC-17)', async ({
      context,
    }) => {
      const tool = await context.newPage()
      await tool.goto('/dep-a/?nohost')
      await tool.waitForFunction(() => 'wrxStorage' in window)
      await tool.evaluate(() =>
        window.wrxStorage.write('{"format":"wrx1-mock-state","version":1,"rooms":[{"jid":'),
      )
      await tool.close()

      const page = await openTab(context, mode)
      expect(await page.evaluate(() => window.wrx.notices())).toEqual(['reset-unreadable'])
      await expect(page.locator('#notices')).toContainText('reset-unreadable')
      await player(page, 'blue-co')
      expect((await texts(page)).length).toBeGreaterThan(0)

      // The seed replaced the bad data in storage.
      const check = await context.newPage()
      await check.goto('/dep-a/?nohost')
      await check.waitForFunction(() => 'wrxStorage' in window)
      const stored = await check.evaluate(() => window.wrxStorage.read())
      expect(typeof stored === 'string' && JSON.parse(stored)).toMatchObject({ version: 1 })
    })

    test('a database from a newer release resets with a notice', async ({ context }) => {
      const tool = await context.newPage()
      await tool.goto('/dep-a/?nohost')
      await tool.waitForFunction(() => 'wrxStorage' in window)
      await tool.evaluate(() =>
        window.wrxStorage.write(JSON.stringify({ format: 'wrx1-mock-state', version: 99 })),
      )
      await tool.close()
      const page = await openTab(context, mode)
      expect(await page.evaluate(() => window.wrx.notices())).toEqual(['reset-unreadable'])
      await player(page, 'red-co')
    })
  })
}

test('Chromium hosts the server in a SharedWorker', async ({ context }) => {
  const page = await context.newPage()
  await page.goto('/dep-a/')
  await page.waitForFunction(() => 'wrx' in window)
  expect(await page.evaluate(() => window.wrx.hosting)).toBe('shared-worker')
  expect(await page.evaluate(() => window.wrx.isHosting())).toBe(false)
  await expect(page.locator('#hosting')).toHaveText('shared-worker')
  await player(page, 'blue-co')
})

test('the leader tab closes mid-conversation and messages keep flowing (R7)', async ({
  context,
}) => {
  const umpire = await openTab(context, 'leader')
  expect(await umpire.evaluate(() => window.wrx.isHosting())).toBe(true)
  const blue = await openTab(context, 'leader')
  const red = await openTab(context, 'leader')
  for (const page of [blue, red])
    expect(await page.evaluate(() => window.wrx.isHosting())).toBe(false)
  await player(umpire, 'admin')
  await player(blue, 'blue-co')
  await player(red, 'red-co')
  await send(blue, 'Blue: crossing at dawn.')
  await expect.poll(() => texts(red)).toContain('Blue: crossing at dawn.')
  await send(red, 'Red: we will be waiting.')
  await expect.poll(() => texts(blue)).toContain('Red: we will be waiting.')
  await expect.poll(() => texts(umpire)).toContain('Red: we will be waiting.')

  await umpire.close()

  // One of the others is elected and takes over from IndexedDB.
  await expect
    .poll(async () =>
      (await Promise.all([blue, red].map((p) => p.evaluate(() => window.wrx.isHosting())))).filter(
        Boolean,
      ),
    )
    .toEqual([true])
  await send(blue, 'Blue: the umpire has left.')
  await expect.poll(() => texts(red)).toContain('Blue: the umpire has left.')
  await send(red, 'Red: carry on.')
  await expect.poll(() => texts(blue)).toContain('Red: carry on.')
  // Nothing said before the leader closed was lost.
  for (const page of [blue, red]) {
    const seen = await texts(page)
    expect(seen).toContain('Blue: crossing at dawn.')
    expect(seen).toContain('Red: we will be waiting.')
  }

  // And again: the new leader closes too.
  const leader = (await blue.evaluate(() => window.wrx.isHosting())) ? blue : red
  const survivor = leader === blue ? red : blue
  await leader.close()
  await expect.poll(() => survivor.evaluate(() => window.wrx.isHosting())).toBe(true)
  await send(survivor, 'Last one standing.')
  await expect.poll(() => texts(survivor)).toContain('Last one standing.')
  expect(await texts(survivor)).toContain('Red: carry on.')
})
