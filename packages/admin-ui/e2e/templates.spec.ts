// The template editor in Chromium, on the dev page against its in-page mock server (WP 4.3, TD5,
// TD6, TPL-2, TPL-4, TPL-7, ADM-9): a template with every field type from the builder's palette,
// a raw edit with its problems marked in place, the live preview, offering it to a force in a
// room, publishing it, and finding it locked with "Copy to new template"; keyboard-only field
// reordering; a schema the builder cannot show opening raw only; axe on each screen.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

const DRAFT_KEY = 'wrx1-mock:/:admin-draft'
const PALETTE = [
  'Text',
  'Long text',
  'Number',
  'Slider',
  'Yes/no',
  'Date',
  'Date and time',
  'Drop-down',
  'Linked drop-down',
  'Force picker',
  'Role picker',
]

const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' })

async function open(page: Page, section: string) {
  await nav(page).getByRole('button', { name: section, exact: false }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
}

async function axe(page: Page, testInfo: TestInfo, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const found = results.violations.map((v) => ({
    rule: v.id,
    nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
  }))
  await testInfo.attach(`axe: ${screen}`, {
    body: JSON.stringify(found, null, 2),
    contentType: 'application/json',
  })
  expect(found, `axe violations on ${screen}`).toEqual([])
}

/** A design with Blue, Blue CO and Blue HQ (Blue writes), from an empty one. */
async function smallDesign(page: Page) {
  await page.goto('./?seed=empty')
  await expect(page.getByRole('heading', { level: 1, name: 'New exercise' })).toBeVisible()
  await open(page, 'Forces')
  await page.getByLabel('New force name').fill('Blue')
  await page.getByRole('button', { name: 'Add force' }).click()
  await open(page, 'Roles')
  await page.getByLabel('New role name').fill('Blue CO')
  await page.getByLabel('In force').selectOption({ label: 'Blue' })
  await page.getByRole('button', { name: 'Add role' }).click()
  await open(page, 'Rooms')
  await page.getByLabel('New room name').fill('Blue HQ')
  await page.getByRole('button', { name: 'Add room' }).click()
  await page.getByLabel('Add participant').selectOption({ label: 'Force: Blue' })
  await page.getByRole('button', { name: 'Add participant' }).click()
  await expect(page.getByLabel('Access for Force: Blue')).toHaveValue('write')
}

async function addTemplate(page: Page, name: string) {
  await open(page, 'Templates')
  await page.getByLabel('New template name').fill(name)
  await page.getByRole('button', { name: 'Add template' }).click()
  await expect(page.getByRole('heading', { level: 3, name: `Template: ${name}` })).toBeVisible()
}

const fields = (page: Page) => page.getByRole('list', { name: 'Fields' })
const palette = (page: Page) => page.getByRole('group', { name: 'Field palette' })
const preview = (page: Page, name: string) =>
  page.getByRole('region', { name: `Preview of ${name}` })
const rawEditor = (page: Page, name: string) =>
  page.getByRole('textbox', { name: `JSON Schema of ${name}` })

/** The stored draft's template, read from the page's storage. */
async function storedTemplate(page: Page, name: string): Promise<Record<string, unknown>> {
  return page.evaluate(
    ([key, wanted]) => {
      const draft = JSON.parse(localStorage.getItem(key) ?? '{}') as {
        design: { templates: { name: string }[] }
      }
      return draft.design.templates.find((t) => t.name === wanted) as unknown as Record<
        string,
        unknown
      >
    },
    [DRAFT_KEY, name] as const,
  )
}

/** Replaces the raw editor's text, as a paste would. */
async function replaceRaw(editor: Locator, text: string) {
  await editor.click()
  await editor.page().keyboard.press('ControlOrMeta+a')
  await editor.page().keyboard.insertText(text)
}

test(
  'builds a template with every field type, edits it raw, previews it, offers it and publishes it locked',
  { tag: '@screenshot' },
  async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1400, height: 1000 })
    await smallDesign(page)
    await addTemplate(page, 'Patrol report')

    // Every field type from the palette (TD5, Annex A special fields).
    for (const kind of PALETTE)
      await palette(page).getByRole('button', { name: kind, exact: true }).click()
    await expect(fields(page).getByRole('listitem')).toHaveCount(PALETTE.length)
    await expect(fields(page).locator('.wrx-admin-tag:not(:text("Required"))')).toHaveText(PALETTE)

    // Field settings: the text field becomes a required callsign with a pattern.
    await fields(page)
      .getByRole('button', { name: /^Text\s+Text$/ })
      .click()
    const settings = page.getByRole('group', { name: /^Text: / })
    await settings.getByLabel('Label').fill('Callsign')
    await settings.getByLabel('Required').check()
    await settings.getByLabel('Pattern (regular expression)').fill('(a+)+')
    await expect(settings.getByText('a group may not repeat')).toBeVisible()
    await settings.getByLabel('Pattern (regular expression)').fill('^[A-Z]{2}[0-9]{1,3}$')
    await settings.getByLabel('Most characters').fill('5')
    // The number field: at most 10.
    await fields(page)
      .getByRole('button', { name: /^Number\s+Number$/ })
      .click()
    await page
      .getByRole('group', { name: /^Number: / })
      .getByLabel('Maximum')
      .fill('10')
    // The linked drop-down depends on the drop-down.
    await fields(page)
      .getByRole('button', { name: /^Linked drop-down/ })
      .click()
    const linked = page.getByRole('group', { name: /^Linked drop-down: / })
    await expect(linked.getByLabel('Depends on')).toHaveValue(/.+/)
    await expect(linked.getByRole('group', { name: 'When Drop-down is Option 1' })).toBeVisible()

    const written = await storedTemplate(page, 'Patrol report')
    const schema = written.schema as { properties: Record<string, Record<string, unknown>> }
    expect(Object.keys(schema.properties)).toEqual([
      'callsign',
      'longText',
      'number',
      'slider',
      'yesNo',
      'date',
      'dateAndTime',
      'dropDown',
      'linkedDropDown',
      'forcePicker',
      'rolePicker',
    ])
    expect(schema.properties.callsign).toMatchObject({
      maxLength: 5,
      pattern: '^[A-Z]{2}[0-9]{1,3}$',
    })
    expect(schema.properties.forcePicker).toMatchObject({ 'x-wrx-picker': 'force' })
    expect(written.schema).toHaveProperty('dependencies.dropDown.oneOf')
    await expect(page.getByText('No problems', { exact: false })).toHaveCount(0)

    // The live preview, checked by the template validator.
    const shown = preview(page, 'Patrol report')
    await expect(shown.getByLabel(/^Callsign/)).toBeVisible()
    await shown.getByLabel(/^Callsign/).fill('blue')
    await expect(shown.getByText(/is not in the expected form/)).toBeVisible()
    await shown.getByLabel(/^Callsign/).fill('BL12')
    await expect(shown.getByText(/is not in the expected form/)).toBeHidden()
    await shown.getByLabel(/^Number/).fill('50')
    await expect(shown.getByText('is too large')).toBeVisible()
    await shown.getByLabel(/^Force picker/).selectOption({ label: 'Blue' })
    await shown.getByLabel(/^Role picker/).selectOption({ label: 'Blue CO' })
    await page.mouse.move(0, 0)
    await page.screenshot({ path: testInfo.outputPath('template-builder.png'), fullPage: true })
    await axe(page, testInfo, 'template builder and preview')

    // The raw editor on the same template: a value outside the profile is marked in place.
    await page.getByRole('tab', { name: 'Raw JSON Schema' }).click()
    const editor = rawEditor(page, 'Patrol report')
    await expect(editor).toBeVisible()
    await expect(page.getByText('No problems: the template is inside the profile.')).toBeVisible()
    const raw = (await storedTemplate(page, 'Patrol report')) as {
      schema: { properties: Record<string, Record<string, unknown>> }
      uiSchema: Record<string, unknown>
    }
    raw.schema.properties.longText = { ...raw.schema.properties.longText, maxLength: 99_999 }
    await replaceRaw(
      editor,
      JSON.stringify({ schema: raw.schema, uiSchema: raw.uiSchema }, null, 2),
    )
    await expect(
      page.getByText(
        'schema.properties.longText.maxLength: a text field needs a maxLength from 1 to 8000',
      ),
    ).toBeVisible()
    await expect(page.locator('.cm-lintRange-error').first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('template-raw.png'), fullPage: true })
    // Fixed, with a new label: the builder shows the raw edit.
    raw.schema.properties.longText = {
      ...raw.schema.properties.longText,
      maxLength: 1000,
      title: 'Situation',
    }
    await replaceRaw(
      editor,
      JSON.stringify({ schema: raw.schema, uiSchema: raw.uiSchema }, null, 2),
    )
    await expect(page.getByText('No problems: the template is inside the profile.')).toBeVisible()
    await axe(page, testInfo, 'template raw editor')
    await page.getByRole('tab', { name: 'Builder' }).click()
    await expect(fields(page).getByRole('button', { name: /^Situation\s+Long text/ })).toBeVisible()
    await expect(preview(page, 'Patrol report').getByLabel(/^Situation/)).toBeVisible()

    // Offered to Blue in Blue HQ (TD4), and in the access matrix (ADM-9).
    await open(page, 'Rooms')
    await page.getByRole('button', { name: 'Blue HQ', exact: true }).click()
    const offers = page.getByRole('group', { name: 'Templates' })
    await expect(offers.getByLabel('Free text allowed')).toBeChecked()
    await offers.getByLabel('Force: Blue may use Patrol report').check()
    await page.screenshot({ path: testInfo.outputPath('room-templates.png'), fullPage: true })
    await axe(page, testInfo, 'room templates')
    await open(page, 'Templates')
    await expect(page.getByText('Offered in Blue HQ.')).toBeVisible()
    // Not deletable while a room offers it.
    await page.getByRole('button', { name: 'Delete Patrol report' }).click()
    const refuse = page.getByRole('alertdialog', { name: 'Delete Patrol report?' })
    await expect(
      refuse.getByText(/cannot be deleted: Patrol report is offered in Blue HQ/),
    ).toBeVisible()
    await refuse.getByRole('button', { name: 'Close' }).click()
    await open(page, 'Access matrix')
    const matrix = page.getByRole('table', { name: /Templates each role may use/ })
    await expect(matrix.getByRole('row', { name: /Blue HQ/ })).toContainText('Patrol report')

    // Publishing locks it (TD6, TPL-4).
    await open(page, 'Publish')
    await expect(page.getByText('Mock server.')).toBeVisible()
    await page.getByRole('button', { name: /Check the server and plan|Plan again/ }).click()
    const plan = page.getByRole('region', { name: 'Publish plan' })
    await expect(plan).toBeVisible()
    await plan.getByRole('region', { name: 'Documents' }).getByRole('button').first().click()
    await expect(plan.getByText('Publish the template Patrol report')).toBeVisible()
    await expect(plan.getByText(/A room offers it, so it locks/)).toBeVisible()
    await plan.getByRole('button', { name: /^Publish \d+ changes?…$/ }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Publish these changes?' })
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByText(/Publish complete: \d+ steps applied/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText('Checked again: nothing is left to publish.')).toBeVisible()

    await open(page, 'Templates')
    await expect(page.getByRole('list', { name: 'Templates' })).toContainText('Locked')
    await expect(page.getByText(/A published room has offered this template/)).toBeVisible()
    await expect(
      page.getByRole('group', { name: /^Text: Callsign/ }).getByLabel('Label'),
    ).toBeDisabled()
    await expect(palette(page).getByRole('button', { name: 'Text', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Reorder Callsign' })).toBeDisabled()
    await page.getByRole('tab', { name: 'Raw JSON Schema' }).click()
    await expect(rawEditor(page, 'Patrol report')).toHaveAttribute('aria-readonly', 'true')
    // Typing changes nothing.
    const before = await storedTemplate(page, 'Patrol report')
    await rawEditor(page, 'Patrol report').click()
    await page.keyboard.type('xyz')
    await expect(rawEditor(page, 'Patrol report')).not.toContainText('xyz')
    expect(await storedTemplate(page, 'Patrol report')).toEqual(before)
    // Copy to a new template: unlocked, editable.
    await page.getByRole('button', { name: 'Copy to new template' }).first().click()
    await expect(
      page.getByRole('heading', { level: 3, name: 'Template: Copy of Patrol report' }),
    ).toBeVisible()
    await expect(page.getByText(/A published room has offered this template/)).toBeHidden()
    await page.getByRole('tab', { name: 'Builder' }).click()
    await expect(palette(page).getByRole('button', { name: 'Text', exact: true })).toBeEnabled()
  },
)

test('reorders fields with the keyboard alone', async ({ page }) => {
  await page.goto('./?server=none')
  await open(page, 'Templates')
  await page.getByRole('button', { name: 'Contact report', exact: true }).click()
  const labels = fields(page).locator('.wrx-admin-list-label')
  await expect(labels).toHaveText(['Seen at', 'Grid reference', 'Strength', 'Hostile'])
  const announced = (text: string) => expect(page.getByText(text)).toBeAttached()
  const handle = page.getByRole('button', { name: 'Reorder Seen at' })
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowDown')
  await announced('Seen at is over position 2 of 4.')
  await page.keyboard.press('ArrowDown')
  await announced('Seen at is over position 3 of 4.')
  await page.keyboard.press('Space')
  await expect(labels).toHaveText(['Grid reference', 'Strength', 'Seen at', 'Hostile'])
  // The Move buttons, from the keyboard.
  await page.getByRole('button', { name: 'Move Hostile up' }).focus()
  await page.keyboard.press('Enter')
  await expect(labels).toHaveText(['Grid reference', 'Strength', 'Hostile', 'Seen at'])
  // Escape cancels.
  const grid = page.getByRole('button', { name: 'Reorder Grid reference' })
  await grid.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await announced('Moving Grid reference cancelled.')
  await expect(labels).toHaveText(['Grid reference', 'Strength', 'Hostile', 'Seen at'])
  const stored = await storedTemplate(page, 'Contact report')
  expect((stored.uiSchema as Record<string, unknown>)['ui:order']).toEqual([
    'grid',
    'strength',
    'hostile',
    'seenAt',
  ])
})

test('a schema the builder cannot show opens in the raw editor only', async ({
  page,
}, testInfo) => {
  await page.goto('./?server=none')
  await addTemplate(page, 'Conditional')
  await page.getByRole('tab', { name: 'Raw JSON Schema' }).click()
  const editor = rawEditor(page, 'Conditional')
  await replaceRaw(
    editor,
    JSON.stringify({
      schema: {
        type: 'object',
        properties: {
          armed: { type: 'boolean', title: 'Armed' },
          detail: { type: 'string', title: 'Detail', maxLength: 50 },
        },
        if: { properties: { armed: { const: true } } },
        then: { required: ['detail'] },
      },
    }),
  )
  await expect(page.getByText('No problems: the template is inside the profile.')).toBeVisible()
  await page.getByRole('tab', { name: 'Builder' }).click()
  await expect(page.getByText('This template opens in the raw editor only.')).toBeVisible()
  await page.getByRole('button', { name: 'Open the raw editor' }).click()
  await expect(editor).toBeVisible()
  // The preview follows the raw schema: Detail is required once Armed is ticked.
  const shown = preview(page, 'Conditional')
  await shown.getByLabel('Armed').check()
  await expect(shown.getByText(/required/i)).toBeVisible()
  // Not JSON: the draft keeps the last valid text.
  await replaceRaw(editor, '{"schema": ')
  await expect(page.getByText(/the draft keeps the last valid JSON/)).toBeVisible()
  await axe(page, testInfo, 'raw editor with problems')
  await page.reload()
  await open(page, 'Templates')
  await page.getByRole('button', { name: 'Conditional', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Raw JSON Schema' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})
