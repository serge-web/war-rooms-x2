// The admin design editor in Chromium, on the dev page (WP 2.2): building a design from
// nothing, the live access matrix, keyboard reordering with real layout, sanitised Markdown,
// and the draft surviving a reload.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' })

async function open(page: Page, section: string) {
  await nav(page).getByRole('button', { name: section, exact: false }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
}

async function addForce(page: Page, name: string) {
  await page.getByLabel('New force name').fill(name)
  await page.getByRole('button', { name: 'Add force' }).click()
  await expect(page.getByRole('form', { name: `Force: ${name}` })).toBeVisible()
}

async function addRole(page: Page, name: string, force: string) {
  await page.getByLabel('New role name').fill(name)
  await page.getByLabel('In force').selectOption({ label: force })
  await page.getByRole('button', { name: 'Add role' }).click()
  await expect(page.getByRole('form', { name: `Role: ${name}` })).toBeVisible()
}

/** The access in a matrix cell, found by its room row header and role column header. */
async function access(table: Locator, room: string, role: string): Promise<string | null> {
  const roleHeaders = table.locator('thead tr').last().locator('th')
  const names = await roleHeaders.evaluateAll((ths) => ths.map((th) => th.firstChild?.textContent))
  const column = names.indexOf(role)
  expect(column, `role column "${role}"`).toBeGreaterThanOrEqual(0)
  const row = table
    .locator('tbody tr')
    .filter({ has: table.page().getByRole('rowheader', { name: room }) })
  return row.locator('td').nth(column).getAttribute('data-access')
}

test(
  'builds a design from nothing and checks the access matrix',
  { tag: '@screenshot' },
  async ({ page }, testInfo) => {
    await page.goto('./?seed=empty')
    await expect(page.getByRole('heading', { level: 1, name: 'New exercise' })).toBeVisible()

    await open(page, 'Forces')
    await addForce(page, 'Blue')
    await page.getByLabel('Colour', { exact: true }).fill('#1d4ed8')
    await addForce(page, 'Umpire')
    await page.getByLabel('Umpire force').check()
    await expect(page.getByRole('list', { name: 'Forces' }).getByRole('listitem')).toHaveCount(2)

    await open(page, 'Roles')
    await addRole(page, 'Blue CO', 'Blue')
    await addRole(page, 'Blue Watcher', 'Blue')
    await page.getByLabel('Observer').check()
    await addRole(page, 'Chief Umpire', 'Umpire')
    await expect(
      page.getByRole('list', { name: 'Roles in Blue' }).getByRole('listitem'),
    ).toHaveCount(2)

    await open(page, 'Rooms')
    await page.getByLabel('New room name').fill('Blue HQ')
    await page.getByRole('button', { name: 'Add room' }).click()
    await page.getByLabel('Add participant').selectOption({ label: 'Force: Blue' })
    await page.getByLabel('With access').selectOption('write')
    await page.getByRole('button', { name: 'Add participant' }).click()
    await expect(page.getByLabel('Access for Force: Blue')).toHaveValue('write')
    await expect(page.getByText('No settings for this room type.')).toBeVisible()

    await open(page, 'Access matrix')
    const table = page.getByRole('table', { name: /Effective access/ })
    expect(await access(table, 'Blue HQ', 'Blue CO')).toBe('write')
    expect(await access(table, 'Blue HQ', 'Blue Watcher')).toBe('read')
    expect(await access(table, 'Blue HQ', 'Chief Umpire')).toBe('write')
    await expect(page.getByText('No problems: the design can be published.')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('access-matrix.png'), fullPage: true })

    // The ids were generated from the names, and the draft is kept across a reload.
    await page.reload()
    await open(page, 'Roles')
    await page.getByRole('button', { name: 'Chief Umpire', exact: true }).click()
    await expect(page.getByLabel('Login id')).toHaveValue('chief-umpire')
    const stored = await page.evaluate(() => Object.keys(localStorage))
    expect(stored).toEqual(['wrx1-mock:/:admin-draft'])
  },
)

test('reorders forces with the keyboard', { tag: '@screenshot' }, async ({ page }, testInfo) => {
  await page.goto('./')
  await open(page, 'Forces')
  const list = page.getByRole('list', { name: 'Forces' })
  await expect(list.locator('.wrx-admin-list-label')).toHaveText(['Blue', 'Red', 'Umpire'])
  // Wait for each step to register before the next key, as a keyboard user would: dnd-kit
  // measures the list between steps, and CI runners can be slower than the keys. The pick-up
  // shows as the handle being pressed; its announcement is replaced at once by a "moved" one.
  const announced = (text: string) => expect(page.getByText(text)).toBeAttached()
  const blue = page.getByRole('button', { name: 'Reorder Blue' })
  await blue.focus()
  await page.keyboard.press('Space')
  await expect(blue).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowDown')
  await announced('Blue moved to position 2 of 3.')
  await page.keyboard.press('ArrowDown')
  await announced('Blue moved to position 3 of 3.')
  await page.screenshot({ path: testInfo.outputPath('reorder-keyboard.png') })
  await page.keyboard.press('Space')
  await expect(list.locator('.wrx-admin-list-label')).toHaveText(['Red', 'Umpire', 'Blue'])
  await expect(page.getByText('Blue dropped in position 3 of 3.')).toBeAttached()

  // Escape cancels.
  const red = page.getByRole('button', { name: 'Reorder Red' })
  await red.focus()
  await page.keyboard.press('Space')
  await expect(red).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowDown')
  await announced('Red moved to position 2 of 3.')
  await page.keyboard.press('Escape')
  await announced('Moving Red cancelled.')
  await expect(list.locator('.wrx-admin-list-label')).toHaveText(['Red', 'Umpire', 'Blue'])
})

test('reorders rooms by dragging', async ({ page }) => {
  await page.goto('./')
  await open(page, 'Rooms')
  const list = page.getByRole('list', { name: 'Rooms' })
  const handle = page.getByRole('button', { name: 'Reorder Blue–Red negotiation' })
  const target = page.getByRole('button', { name: 'Reorder Blue HQ' })
  const from = await handle.boundingBox()
  const to = await target.boundingBox()
  if (from === null || to === null) throw new Error('no layout')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 10 })
  await page.mouse.up()
  await expect(list.locator('.wrx-admin-list-label')).toHaveText([
    'Blue–Red negotiation',
    'Blue HQ',
    'Red HQ',
  ])
})

test('previews the briefing sanitised, and warns that it is public', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  await page.goto('./')
  await expect(page.getByText('The briefing is public.')).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Briefing' })
    .fill('# Welcome\n\n<img src="x" onerror="alert(1)"><script>alert(2)</script>')
  await page.getByRole('tab', { name: 'Preview' }).click()
  const preview = page.getByRole('tabpanel', { name: 'Preview' })
  await expect(preview.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible()
  const html = await preview.innerHTML()
  expect(html).not.toContain('onerror')
  expect(html).not.toContain('<script')
  expect(dialogs).toEqual([])
})

test('toggles between the admin backend and the game view', async ({ page }) => {
  await page.goto('./')
  const toggle = page.getByRole('group', { name: 'View' })
  await expect(toggle.getByRole('button', { name: 'Admin' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await toggle.getByRole('button', { name: 'Game' }).click()
  await expect(page.getByRole('heading', { name: 'Game view' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to admin' }).click()
  await expect(nav(page)).toBeVisible()
})
