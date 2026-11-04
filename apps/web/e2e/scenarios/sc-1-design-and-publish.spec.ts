// SC-1 Admin designs and publishes a game (SRD §12). Traces to: ADM-1–16, ADM-18–24, ADM-26.
//
// The admin designs a new game on the mock from nothing: name, description, a game theme with a
// logo; Blue, Red and White, each with a theme and colour, and objectives for Blue and Red;
// roles with generated passwords, one Blue observer; three rooms with mixed force and role
// entries. Reviews the access matrix, publishes and watches every step complete, then exports
// the design, imports it into the server as the admin there and publishes again, and prints
// the credentials sheet. Outcome: the same game on the mock and the server.
//
// Step 7 needs two backends. In the ejabberd project the design is made on the mock of the
// real-server build (PLY-20) and goes to the reference ejabberd, emptied for this scenario. In
// the mock-build project there is no server: a second browser, with a fresh mock of its own,
// stands in for it, so the export and import still go through a file.
import { readFileSync } from 'node:fs'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { adminNav, importDesign, openSection, unlockVault } from './admin.ts'
import { expect, test, useEjabberd, watchErrors } from './backend.ts'
import { ejabberdServer } from './ejabberd-game.ts'

test.use({ startWith: 'empty' })

const GAME = 'Exercise Eastern Shield'
/** A 1×1 PNG, the game logo uploaded in the theme editor. */
const LOGO_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const VAULT_PASSPHRASE = 'eastern shield observer vault passphrase'
const ROLES = [
  { name: 'Blue Lead', id: 'blue-lead', force: 'Blue', observer: false },
  { name: 'Blue Watch', id: 'blue-watch', force: 'Blue', observer: true },
  { name: 'Red Lead', id: 'red-lead', force: 'Red', observer: false },
] as const
const NEGOTIATION = 'Blue–Red negotiation'

async function adminLogin(page: Page, password: string): Promise<void> {
  await page.goto('./#/admin')
  await page.getByLabel('Login name').fill('admin')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(adminNav(page)).toBeVisible({ timeout: 20_000 })
}

/** The access in a matrix cell, found by its room row header and role column header. */
async function access(table: Locator, room: string, role: string): Promise<string | null> {
  const names = await table
    .locator('thead tr')
    .last()
    .locator('th')
    .evaluateAll((ths) => ths.map((th) => th.firstChild?.textContent))
  const column = names.indexOf(role)
  expect(column, `role column "${role}"`).toBeGreaterThanOrEqual(0)
  return table
    .locator('tbody tr')
    .filter({ has: table.page().getByRole('rowheader', { name: room }) })
    .locator('td')
    .nth(column)
    .getAttribute('data-access')
}

async function addParticipant(page: Page, label: string, level: 'write' | 'read') {
  await page.getByLabel('Add participant').selectOption({ label })
  await page.getByLabel('With access').selectOption(level)
  await page.getByRole('button', { name: 'Add participant' }).click()
  await expect(page.getByLabel(`Access for ${label}`)).toHaveValue(level)
}

async function setTheme(page: Page, target: string, primary: string, logo?: string) {
  await openSection(page, 'Themes')
  await page.getByLabel('Theme for').selectOption({ label: target })
  await page.getByLabel('Primary', { exact: true }).fill(primary)
  if (logo !== undefined) {
    await page.getByLabel('Logo').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(logo, 'base64'),
    })
    await expect(page.getByRole('img', { name: 'Current logo' })).toBeVisible()
  }
}

/** Plans; creates the vault (a fresh server) or unlocks it (the mock's demo vault) if asked. */
async function planWithVault(page: Page, passphrase: string): Promise<void> {
  await openSection(page, 'Publish')
  const planButton = page.getByRole('button', { name: /Check the server and plan|Plan again/ })
  await planButton.click()
  const region = page.getByRole('region', { name: 'Publish plan' })
  await expect(region).toBeVisible({ timeout: 30_000 })
  if (await page.getByRole('button', { name: 'Create the vault' }).isVisible()) {
    await page.getByRole('button', { name: 'Create the vault' }).click()
    const vault = page.getByRole('alertdialog', { name: 'Create the observer-password vault' })
    await vault.getByLabel('Passphrase', { exact: true }).fill(passphrase)
    await vault.getByLabel('Passphrase again').fill(passphrase)
    await vault.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText('Vault unlocked.')).toBeVisible({ timeout: 30_000 })
    await planButton.click()
  } else if (await page.getByRole('button', { name: 'Unlock the vault' }).isVisible()) {
    await unlockVault(page, passphrase)
    await planButton.click()
  }
  await expect(page.getByText('Reading the server…')).toBeHidden({ timeout: 30_000 })
  await expect(region).toBeVisible()
}

/** Publishes, ticking every warning the plan asks to confirm, and checks every step is done. */
async function publishAll(page: Page): Promise<void> {
  const region = page.getByRole('region', { name: 'Publish plan' })
  await region.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Publish these changes?' })
  for (const box of await dialog.getByRole('checkbox').all()) await box.check()
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText(/Publish complete: \d+ steps applied/)).toBeVisible({
    timeout: 120_000,
  })
  // 6. Per-item progress, each step done.
  await expect(
    region.getByRole('status').filter({ hasText: /^All \d+ steps done\.$/ }),
  ).toBeVisible()
  await expect(region.locator('section[data-group]:not([data-state="done"])')).toHaveCount(0)
  await region.getByRole('button', { name: 'Show every step' }).click()
  await expect(region.locator('li[data-step]:not([data-state="done"])')).toHaveCount(0)
  await expect(page.getByText('Checked again: nothing is left to publish.')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
}

/** The credentials sheet's password for each role, read off the page (ADM-26). */
async function credentials(page: Page): Promise<Record<string, string>> {
  await openSection(page, 'Publish')
  await page.getByRole('button', { name: 'Show the credentials sheet' }).click()
  const sheet = page.getByRole('table', { name: 'Role credentials' })
  const found: Record<string, string> = {}
  for (const role of ROLES) {
    const row = sheet.getByRole('row', { name: new RegExp(role.name) })
    await expect(row).toContainText(role.id)
    await expect(row).toContainText(role.force)
    const cells = await row.getByRole('cell').allTextContents()
    // A demo password carries a "demo" tag in its cell (NFR-6).
    const password = cells
      .map((c) => /^(demo-[a-z-]+|[a-z2-9]{4}(?:-[a-z2-9]{4}){3})(?:\s*demo)?$/.exec(c.trim())?.[1])
      .find((p) => p !== undefined)
    expect(password, cells.join(' | ')).toBeDefined()
    found[role.id] = password ?? ''
  }
  return found
}

/** What a player sees of the game: its name on the welcome page, then a role's rooms and objectives. */
async function playerView(page: Page, roleId: string, password: string) {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: GAME })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Login name').fill(roleId)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  const tabs = page.locator('.flexlayout__layout_main').getByRole('tab')
  await expect(tabs.first()).toBeVisible({ timeout: 20_000 })
  const objectives = page
    .getByRole('complementary', { name: 'Out-of-game column' })
    .getByRole('region', { name: 'Objectives' })
  await expect(objectives).not.toContainText('Loading')
  return { tabs: await tabs.allTextContents(), objectives: (await objectives.innerText()).trim() }
}

test('SC-1: the admin designs a game on the mock, publishes it, moves it to the server by file and publishes it there (ADM-1–16, ADM-18–24, ADM-26)', async ({
  browser,
  context,
  backend,
  baseURL,
}, testInfo) => {
  test.setTimeout(360_000)
  const page = await context.newPage()
  await page.setViewportSize({ width: 1400, height: 1000 })
  const errors = watchErrors(page)

  // 1. The app, the mock backend, the admin login. On the real-server build the mock is chosen
  // on the welcome page (PLY-20); the mock-only build has nothing else.
  await page.goto('./')
  if (backend.kind === 'ejabberd') await page.getByRole('radio', { name: /Mock/ }).check()
  await expect(page.getByLabel('Backend: MOCK')).toBeVisible()
  await adminLogin(page, 'demo-admin')
  // The mock's draft starts as its demo game; this design starts from nothing.
  await openSection(page, 'Publish')
  await page.getByRole('button', { name: 'Start a new design…' }).click()
  await page.getByRole('button', { name: 'Start a new design', exact: true }).click()
  await expect(page.getByText('Started a new design.')).toBeVisible()

  // 2. Name, description, and the game theme with a logo (ADM-3, ADM-18).
  await openSection(page, 'Game')
  await page.getByLabel('Name', { exact: true }).fill(GAME)
  await page.getByLabel('Description').fill('A coastal defence exercise for two forces.')
  await setTheme(page, 'Game theme (welcome page and default)', '#14532d', LOGO_PNG)

  // 3. Forces: White is there, with the umpire flag; Blue and Red added, each with a colour,
  // a theme and objectives (ADM-4, ADM-23).
  await openSection(page, 'Forces')
  await expect(page.getByLabel('Umpire flag (White Force)')).toBeChecked()
  for (const [name, colour, objectives] of [
    ['Blue', '#1d4ed8', '1. Hold the harbour.'],
    ['Red', '#b91c1c', '1. Land at the north beach.'],
  ] as const) {
    await page.getByLabel('New force name').fill(name)
    await page.getByRole('button', { name: 'Add force' }).click()
    const form = page.getByRole('form', { name: `Force: ${name}` })
    await expect(form).toBeVisible()
    await form.getByLabel('Colour', { exact: true }).fill(colour)
    await form.getByRole('textbox', { name: 'Objectives' }).fill(objectives)
  }
  await setTheme(page, 'Force: Blue', '#1e3a8a')
  await setTheme(page, 'Force: Red', '#7f1d1d')
  await setTheme(page, 'Force: White', '#374151')

  // 4. Roles in each force; Blue Watch is the observer (ADM-5). Passwords are generated on
  // publish, never typed (ADM-26).
  await openSection(page, 'Roles')
  for (const role of ROLES) {
    await page.getByLabel('New role name').fill(role.name)
    await page.getByLabel('In force').selectOption({ label: role.force })
    await page.getByRole('button', { name: 'Add role' }).click()
    const form = page.getByRole('form', { name: `Role: ${role.name}` })
    await expect(form).toBeVisible()
    await expect(form.getByLabel('Login name')).toHaveValue(role.id)
    if (role.observer) await form.getByLabel('Observer').check()
  }

  // 5. Rooms with mixed force and role entries (ADM-6).
  await openSection(page, 'Rooms')
  for (const [room, entries] of [
    ['Blue HQ', [['Force: Blue', 'write']]],
    ['Red HQ', [['Force: Red', 'write']]],
    [
      NEGOTIATION,
      [
        ['Role: Blue Lead (Blue)', 'write'],
        ['Role: Red Lead (Red)', 'write'],
        ['Force: Blue', 'read'],
      ],
    ],
  ] as const) {
    await page.getByLabel('New room name').fill(room)
    await page.getByRole('button', { name: 'Add room' }).click()
    for (const [entry, level] of entries) await addParticipant(page, entry, level)
  }

  // 6. The access matrix (ADM-9): role entries win over force entries; the observer reads.
  await openSection(page, 'Access matrix')
  const matrix = page.getByRole('table', { name: /Effective access/ })
  expect(await access(matrix, 'Blue HQ', 'Blue Lead')).toBe('write')
  expect(await access(matrix, 'Blue HQ', 'Blue Watch')).toBe('read')
  expect(await access(matrix, 'Blue HQ', 'Red Lead')).toBe('none')
  expect(await access(matrix, NEGOTIATION, 'Blue Lead')).toBe('write')
  expect(await access(matrix, NEGOTIATION, 'Blue Watch')).toBe('read')
  expect(await access(matrix, NEGOTIATION, 'Red Lead')).toBe('write')
  await expect(page.getByText('No problems: the design can be published.')).toBeVisible()

  // ...publish on the mock, and watch each step complete (ADM-10, ADM-11). The mock's demo
  // game goes: its roles deleted and its old rooms replaced, each confirmed.
  await planWithVault(page, 'demo-observer-vault')
  await publishAll(page)
  const onMock = await credentials(page)
  for (const role of ROLES) expect(onMock[role.id]).toBe(`demo-${role.id}`)

  // 7. Export the design (ADM-16): a file without passwords.
  await openSection(page, 'Publish')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export the design' }).click()
  const file = testInfo.outputPath('eastern-shield-design.json')
  await (await download).saveAs(file)
  const exported = readFileSync(file, 'utf8')
  expect(exported).toContain(GAME)
  expect(exported).not.toMatch(/password/i)

  // ...then the admin on the server imports it and publishes again.
  let serverContext: BrowserContext
  let adminPassword: string
  const server = ejabberdServer()
  if (backend.kind === 'ejabberd' && server !== undefined) {
    serverContext = await browser.newContext(baseURL === undefined ? {} : { baseURL })
    await useEjabberd(serverContext, server)
    adminPassword = server.adminPassword
  } else {
    // No server in this project: a second browser, whose fresh mock stands in for it.
    serverContext = await browser.newContext(baseURL === undefined ? {} : { baseURL })
    adminPassword = 'demo-admin'
  }
  const onServer = await serverContext.newPage()
  await onServer.setViewportSize({ width: 1400, height: 1000 })
  const serverErrors = watchErrors(onServer)
  await onServer.goto('./')
  await expect(onServer.getByLabel(backend.badge)).toBeVisible()
  await adminLogin(onServer, adminPassword)
  await importDesign(onServer, file)
  await openSection(onServer, 'Game')
  await expect(onServer.getByLabel('Name', { exact: true })).toHaveValue(GAME)
  await planWithVault(
    onServer,
    backend.kind === 'ejabberd' ? VAULT_PASSPHRASE : 'demo-observer-vault',
  )
  await publishAll(onServer)

  // 8. The credentials sheet: random passwords on a real server, demo ones on a mock; it prints
  // alone (ADM-26).
  const sheet = await credentials(onServer)
  for (const role of ROLES) {
    if (backend.kind === 'ejabberd')
      expect(sheet[role.id]).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/)
    else expect(sheet[role.id]).toBe(`demo-${role.id}`)
  }
  await onServer.emulateMedia({ media: 'print' })
  await expect(onServer.getByRole('table', { name: 'Role credentials' })).toBeVisible()
  await expect(adminNav(onServer)).toBeHidden()
  await onServer.emulateMedia({ media: 'screen' })

  // Outcome: the same game on both. Blue Lead, with the sheet's password, sees the same rooms
  // and objectives on each.
  const mockPlayer = await context.newPage()
  const serverPlayer = await serverContext.newPage()
  const seenOnMock = await playerView(mockPlayer, 'blue-lead', onMock['blue-lead'] ?? '')
  const seenOnServer = await playerView(serverPlayer, 'blue-lead', sheet['blue-lead'] ?? '')
  // The map room came with the new design, first, and every role sees it (§3 rule 18).
  expect(seenOnMock.tabs).toEqual(['Map', 'Blue HQ', NEGOTIATION])
  expect(seenOnServer).toEqual(seenOnMock)
  expect(seenOnServer.objectives).toContain('Hold the harbour.')
  expect(errors).toEqual([])
  expect(serverErrors).toEqual([])
  await serverContext.close()
})
