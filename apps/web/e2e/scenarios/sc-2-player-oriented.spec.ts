// SC-2 Player arrives and gets oriented (SRD §12). Traces to: PLY-1, PLY-4–5, PLY-24–27, D20.
//
// A Blue role opens the published game: the themed welcome page read before login (D20), then
// exactly its rooms and its force panel in Blue's own theme with Blue's logo; it docks the
// negotiation room into a second tabset, resizes it, and finds the layout restored after a
// reload. Both backends: the mock build, and the real-server build on ejabberd.
import { nodeName } from '@wrx/schemas'
import { FORCE, tid } from '@wrx/schemas/fixtures'
import { drag } from '../layout.ts'
import { expect, logInAs, openApp, test, watchErrors } from './backend.ts'

/** A 1×1 opaque PNG, unlike the game logo, so the force panel shows Blue's own. */
const BLUE_LOGO =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const BLUE_PRIMARY = '#0b3d91'
const ROLES = ['blue-co', 'blue-observer', 'red-co', 'white-observer']

test('SC-2: a Blue role sees the themed welcome page, exactly its rooms and objectives, and keeps its layout (PLY-1, PLY-4, PLY-5, PLY-24–27)', async ({
  page,
  backend,
}) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 1400, height: 900 })
  await openApp(page, backend)
  // The published game gives Blue a theme of its own: a logo and a primary colour, as a publish
  // writes them (§3 rules 11 and 12).
  await backend.asAdmin(page, [
    { op: 'create-node', node: nodeName.asset(tid('blue-logo')), readers: ROLES },
    {
      op: 'publish',
      node: nodeName.asset(tid('blue-logo')),
      payload: JSON.stringify({
        schemaVersion: 1,
        id: tid('blue-logo'),
        mimeType: 'image/png',
        size: Buffer.from(BLUE_LOGO, 'base64').length,
        sha256: '0'.repeat(64),
        data: BLUE_LOGO,
      }),
    },
    {
      op: 'publish',
      node: nodeName.force(FORCE.blue),
      payload: JSON.stringify({
        schemaVersion: 1,
        id: FORCE.blue,
        name: 'Blue',
        colour: '#1d4ed8',
        isUmpire: false,
        order: 0,
        theme: { tokens: { primary: BLUE_PRIMARY }, logoAssetId: tid('blue-logo') },
      }),
    },
  ])

  // 1. The welcome page, in the game theme, read before anyone logs in (D20, PLY-27).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText('A two-sided negotiation exercise.')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Exercise Northern Gate logo' })).toBeVisible()
  const welcome = page.locator('[data-wrx-theme]').filter({
    has: page.getByRole('heading', { name: 'Exercise Northern Gate' }),
  })
  await expect(welcome.first()).toHaveCSS('--wrx-primary', '#1d4ed8')

  // 2. Login with role id and password.
  await logInAs(page, backend, 'blue-co')
  await expect(page.getByLabel('Logged in as Blue CO, Blue')).toBeVisible({ timeout: 20_000 })

  // 3. One tab per permitted room, and the force panel at the bottom of the column: Blue's logo,
  // the role name and Blue's objectives, in Blue's theme (PLY-4, PLY-24, PLY-25).
  const tabs = page.locator('.flexlayout__layout_main').getByRole('tab')
  await expect(tabs).toHaveText(['Blue HQ', 'Blue–Red negotiation', 'Blue Reports'])
  const column = page.getByRole('complementary', { name: 'Out-of-game column' })
  const forcePanel = column.getByRole('region', { name: 'Force panel' })
  await expect(forcePanel.getByRole('heading', { name: 'Blue CO' })).toBeVisible()
  await expect(forcePanel.getByRole('region', { name: 'Objectives' })).toContainText(
    'Secure the crossing.',
  )
  const logo = forcePanel.getByRole('img')
  await expect(logo).toHaveAttribute(
    'src',
    new RegExp(BLUE_LOGO.slice(0, 40).replace(/\+/g, '\\+')),
  )
  await expect(forcePanel).toHaveCSS('--wrx-primary', BLUE_PRIMARY)
  const last = await column.evaluate((el) => {
    const sections = [...el.querySelectorAll('.wrx-column > section')]
    return sections.at(-1)?.getAttribute('aria-label')
  })
  expect(last).toBe('Force panel')

  // 4. The negotiation room into a second tabset, below Blue HQ, then resized.
  const tabsets = page.locator('.flexlayout__layout_main .flexlayout__tabset')
  /** Each docked tabset's tabs and box, top to bottom then left to right. */
  const boxes = () =>
    tabsets.evaluateAll((all) =>
      all
        .map((e) => ({ r: e.getBoundingClientRect(), e }))
        .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x)
        .map(({ r, e }) => ({
          tabs: [...e.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-label')),
          x: Math.round(r.x),
          height: Math.round(r.height),
        })),
    )
  const talksTab = page.getByRole('tab', { name: 'Blue–Red negotiation', exact: true })
  await drag(page, talksTab, page.getByRole('region', { name: 'Blue HQ', exact: true }), {
    x: 0.5,
    y: 0.92,
  })
  await expect
    .poll(async () => (await boxes()).map((b) => [b.tabs, b.x]))
    .toEqual([
      [['Blue HQ'], expect.any(Number)],
      [['Blue Reports'], expect.any(Number)],
      [['Blue–Red negotiation'], expect.any(Number)],
    ])
  const [upper, , lower] = await boxes()
  expect(upper?.x).toBe(lower?.x)
  const heights = async () => (await boxes()).map((b) => b.height)
  const before = await heights()
  const splitter = page.locator('.flexlayout__layout_main .flexlayout__splitter').first()
  const box = await splitter.boundingBox()
  if (box === null) throw new Error('no splitter')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 150, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => ((await heights())[0] ?? 0) < (before[0] ?? 0) - 100).toBe(true)
  const resized = await heights()

  // 5. After a reload, the same layout (PLY-5).
  await page.reload()
  await logInAs(page, backend, 'blue-co')
  await expect(tabs).toHaveCount(3, { timeout: 20_000 })
  await expect
    .poll(async () => (await boxes()).map((b) => b.tabs))
    .toEqual([['Blue HQ'], ['Blue Reports'], ['Blue–Red negotiation']])
  await expect
    .poll(async () => (await heights()).map((h, i) => Math.abs(h - (resized[i] ?? 0)) <= 2))
    .toEqual([true, true, true])
  expect(errors).toEqual([])
})
