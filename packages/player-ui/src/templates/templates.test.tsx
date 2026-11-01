// @vitest-environment happy-dom
// The template form's widgets and the card (WP 4.2): every field type of the sample templates,
// labelled and filled from the keyboard's events, validated inline with the receivers'
// validator; pickers fed from documents, storing GUIDs, showing names and deleted names; and the
// card's order, labels and values, as plain text (PLY-14).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { force, role } from '@wrx/domain/fixtures'
import type { Retired, Template, TemplateMessageBody } from '@wrx/schemas'
import { FORCE, ROLE, TEMPLATE, sampleTemplates, tid } from '@wrx/schemas/fixtures'
import type { FormValues } from '@wrx/templates'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardClock, cardValueText, orderedFieldNames, templateCard } from './card.ts'
import { TemplateCard } from './card-view.tsx'
import { TemplateForm, formUiSchema } from './form.tsx'
import { entityLabel, pickerOptions } from './pickers.ts'
import type { PickerSource } from './pickers.ts'
import { isoToLocalInput, localInputToIso } from './theme.tsx'

afterEach(cleanup)

function template(id: string): Template {
  const found = sampleTemplates().find((t) => t.id === id)
  if (found === undefined) throw new Error(id)
  return found
}

const RETIRED_FORCE: Retired = {
  schemaVersion: 1,
  id: tid('green'),
  kind: 'force',
  name: 'Green Force',
  colour: '#15803d',
  deletedAt: '2026-10-30T10:00:00.000Z',
}

function source(extra: Partial<PickerSource> = {}): PickerSource {
  return {
    forces: [
      force('blue', { name: 'Blue Force' }),
      force('red', { name: 'Red Force', order: 1 }),
      force('white', { name: 'White Force', order: 2, isUmpire: true }),
    ],
    roles: [
      role('blue-co', 'blue', { name: 'Blue CO' }),
      role('blue-observer', 'blue', { name: 'Blue Observer', order: 1, isObserver: true }),
      role('red-co', 'red', { name: 'Red CO' }),
    ],
    retired: [RETIRED_FORCE],
    ...extra,
  }
}

function Harness({
  id,
  initial = {},
  pickers = source(),
  onSubmit,
}: {
  id: string
  initial?: FormValues
  pickers?: PickerSource
  onSubmit: (values: FormValues) => void
}) {
  const [values, setValues] = useState<FormValues>(initial)
  return (
    <TemplateForm
      template={template(id)}
      values={values}
      onChange={setValues}
      onSubmit={onSubmit}
      pickers={pickers}
      idPrefix="t1"
    >
      <button type="submit">Send</button>
    </TemplateForm>
  )
}

describe('the fixtures', () => {
  it('use the ids the tests name', () => {
    expect(FORCE.blue).toBe(tid('blue'))
    expect(ROLE.blueCo).toBe(tid('blue-co'))
  })
})

describe('TemplateForm', () => {
  it('labels every field and sends a situation report: picker, text, slider, drop-down, date', async () => {
    const onSubmit = vi.fn()
    render(<Harness id={TEMPLATE.sitrep} onSubmit={onSubmit} />)
    const force = screen.getByRole<HTMLSelectElement>('combobox', { name: /Reporting force/ })
    // Names shown, GUIDs stored (TPL-8), in display order; a deleted force is not offered.
    expect([...force.options].map((o) => o.textContent)).toEqual([
      'Choose a force…',
      'Blue Force',
      'Red Force',
      'White Force',
    ])
    fireEvent.change(force, { target: { value: tid('red') } })
    const summary = screen.getByRole('textbox', { name: /Summary/ })
    expect(summary.tagName).toBe('TEXTAREA')
    fireEvent.change(summary, { target: { value: 'Holding the bridge.' } })
    // The counter for maxLength, linked to the field.
    expect(screen.getByText('19 of 500 characters')).toBeTruthy()
    expect(summary.getAttribute('aria-describedby')).toContain('__count')
    const slider = screen.getByRole('slider', { name: /Readiness/ })
    fireEvent.change(slider, { target: { value: '75' } })
    // The number field beside the slider shows the same value.
    expect(
      screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Readiness (%), exact value' })
        .value,
    ).toBe('75')
    fireEvent.change(screen.getByRole('combobox', { name: /Threat level/ }), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText(/As of/), { target: { value: '2026-10-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      force: tid('red'),
      summary: 'Holding the bridge.',
      readiness: 75,
      threat: 'high',
      asOf: '2026-10-24',
    })
  })

  it('shows each field’s error inline and does not send until it fits', async () => {
    const onSubmit = vi.fn()
    render(<Harness id={TEMPLATE.contact} initial={{ hostile: false }} onSubmit={onSubmit} />)
    const grid = screen.getByRole('textbox', { name: /Grid reference/ })
    fireEvent.change(grid, { target: { value: 'not a grid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      expect(grid.getAttribute('aria-invalid')).toBe('true')
    })
    expect(onSubmit).not.toHaveBeenCalled()
    const describedBy = grid.getAttribute('aria-describedby') ?? ''
    const errorList = describedBy
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((el) => el?.classList.contains('wrx-tfield__errors'))
    expect(errorList?.textContent).toBe('is not in the expected form')
    // The required date-time field says so too.
    expect(screen.getByLabelText(/Seen at/).getAttribute('aria-invalid')).toBe('true')
    // Fixed, the errors go as the values change, and the form sends.
    fireEvent.change(grid, { target: { value: 'NV1234' } })
    fireEvent.change(screen.getByLabelText(/Seen at/), { target: { value: '2026-10-24T08:40' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Strength/ }), {
      target: { value: '12' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hostile' }))
    await waitFor(() => {
      expect(grid.getAttribute('aria-invalid')).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const sent = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>
    expect(sent).toMatchObject({ grid: 'NV1234', strength: 12, hostile: true })
    // Local wall-clock time in the field, an ISO instant in the value (PLY-45).
    expect(sent.seenAt).toBe(new Date('2026-10-24T08:40').toISOString())
  })

  it('narrows a linked drop-down, and filters a role picker to its force', async () => {
    const onSubmit = vi.fn()
    render(<Harness id={TEMPLATE.support} initial={{ urgent: false }} onSubmit={onSubmit} />)
    const kind = screen.getByRole<HTMLSelectElement>('combobox', { name: /Support/ })
    fireEvent.change(kind, { target: { value: '1' } })
    await waitFor(() => {
      const detail = screen.getByRole<HTMLSelectElement>('combobox', { name: /Detail/ })
      expect([...detail.options].map((o) => o.textContent)).toEqual([
        'Choose…',
        'fuel',
        'ammunition',
      ])
    })
    const to = screen.getByRole<HTMLSelectElement>('combobox', { name: /Addressed to/ })
    // x-wrx-force: Blue's roles only, so no force name is needed beside them.
    expect([...to.options].map((o) => o.textContent)).toEqual([
      'Choose a role…',
      'Blue CO',
      'Blue Observer',
    ])
    fireEvent.change(screen.getByRole('combobox', { name: /Detail/ }), { target: { value: '0' } })
    fireEvent.change(to, { target: { value: tid('blue-co') } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      kind: 'logistics',
      detail: 'fuel',
      to: tid('blue-co'),
      urgent: false,
    })
  })

  it('keeps a held value a picker no longer offers, under its deleted name (TPL-9)', () => {
    render(
      <Harness id={TEMPLATE.sitrep} initial={{ force: tid('green') }} onSubmit={() => undefined} />,
    )
    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: /Reporting force/ })
    expect(picker.value).toBe(tid('green'))
    expect(picker.selectedOptions[0]?.textContent).toBe('Green Force (deleted)')
  })

  it('renders titles and hints as text, never HTML (PLY-14)', () => {
    const hostile: Template = {
      ...template(TEMPLATE.contact),
      schema: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            title: '<img src=x onerror="window.pwned=1"> **Note**',
            description: '<b>bold</b> _hint_',
            maxLength: 20,
          },
        },
      },
      uiSchema: {},
    }
    const view = render(
      <TemplateForm
        template={hostile}
        values={{}}
        onChange={() => undefined}
        onSubmit={() => undefined}
        pickers={source()}
        idPrefix="t2"
      />,
    )
    expect(screen.getByText('<img src=x onerror="window.pwned=1"> **Note**')).toBeTruthy()
    expect(screen.getByText('<b>bold</b> _hint_')).toBeTruthy()
    expect(view.container.querySelector('img, b, strong, em')).toBeNull()
  })

  it('keeps every field in the form, whatever the UI schema’s order leaves out', () => {
    const t: Template = { ...template(TEMPLATE.sitrep), uiSchema: { 'ui:order': ['threat'] } }
    expect(orderedFieldNames(t)).toEqual(['threat', 'force', 'summary', 'readiness', 'asOf'])
    expect(formUiSchema(t)).toMatchObject({
      'ui:order': ['threat', 'force', 'summary', 'readiness', 'asOf'],
      force: { 'ui:widget': 'wrxPicker' },
    })
    const starred: Template = { ...t, uiSchema: { 'ui:order': ['summary', '*', 'force'] } }
    expect(orderedFieldNames(starred)).toEqual(['summary', 'readiness', 'asOf', 'threat', 'force'])
  })
})

describe('pickers (TPL-8)', () => {
  it('offers only the forces with players in this room, for x-wrx-scope: room', () => {
    const options = pickerOptions(
      { picker: 'force', scope: 'room', forceFilter: undefined },
      source({ roomRoleIds: new Set([tid('red-co')]) }),
    )
    expect(options.map((o) => o.label)).toEqual(['Red Force'])
    const roles = pickerOptions(
      { picker: 'role', scope: 'room', forceFilter: undefined },
      source({ roomRoleIds: new Set([tid('red-co'), tid('blue-co')]) }),
    )
    expect(roles.map((o) => o.label)).toEqual(['Blue CO (Blue Force)', 'Red CO (Red Force)'])
  })

  it('names a GUID now, or by its last name when deleted', () => {
    expect(entityLabel('force', tid('blue'), source())).toBe('Blue Force')
    expect(entityLabel('force', tid('green'), source())).toBe('Green Force (deleted)')
    expect(entityLabel('role', tid('green'), source())).toBeUndefined()
  })
})

describe('the date-time widget’s conversion (PLY-45)', () => {
  it('shows an instant in local time and stores it as ISO', () => {
    const iso = new Date(2026, 9, 24, 8, 40).toISOString()
    expect(isoToLocalInput(iso)).toBe('2026-10-24T08:40')
    expect(localInputToIso('2026-10-24T08:40')).toBe(iso)
    expect(localInputToIso('')).toBeUndefined()
    expect(isoToLocalInput('not a date')).toBe('')
  })
})

describe('the card (TD7, TPL-5)', () => {
  const sitrep: TemplateMessageBody = {
    type: 'template',
    schemaVersion: 1,
    content: {
      templateId: TEMPLATE.sitrep,
      values: {
        asOf: '2026-10-24',
        force: tid('green'),
        readiness: 75,
        summary: 'Holding.',
        threat: 'high',
      },
    },
  }

  it('lists label and value in the form’s order, pickers as names, options by title', () => {
    const card = templateCard(sitrep, template(TEMPLATE.sitrep), source())
    expect(card.templateName).toBe('Situation report')
    const clock = cardClock({ locale: 'en-GB', timeZone: 'Pacific/Kiritimati' })
    expect(card.fields.map((f) => [f.label, cardValueText(f.value, clock)])).toEqual([
      ['Reporting force', 'Green Force (deleted)'],
      ['Summary', 'Holding.'],
      ['Readiness (%)', '75'],
      ['Threat level', 'High'],
      // A calendar day is not moved by the reader's zone.
      ['As of', '24 Oct 2026'],
    ])
  })

  it('renders as a description list of text, with yes/no and local times', () => {
    const body: TemplateMessageBody = {
      type: 'template',
      schemaVersion: 1,
      content: {
        templateId: TEMPLATE.contact,
        values: {
          seenAt: '2026-10-24T08:40:00.000Z',
          grid: 'NV1234',
          hostile: false,
        },
      },
    }
    const card = templateCard(body, template(TEMPLATE.contact), source())
    const view = render(
      <TemplateCard card={card} clock={cardClock({ locale: 'en-GB', timeZone: 'UTC' })} />,
    )
    expect(screen.getByText('Contact report')).toBeTruthy()
    const list = view.container.querySelector('dl')
    if (list === null) throw new Error('no list')
    const terms = within(list)
      .getAllByRole('term')
      .map((el) => el.textContent)
    const values = within(list)
      .getAllByRole('definition')
      .map((el) => el.textContent)
    expect(terms).toEqual(['Seen at', 'Grid reference', 'Hostile'])
    expect(values).toEqual(['24 Oct 2026, 08:40', 'NV1234', 'No'])
  })
})
