// @vitest-environment happy-dom
// The template editor's live preview (WP 4.4): the player's own form (WP 4.2's `TemplateForm`),
// so what the admin sees is what players fill. Drop-downs, linked ones included, start with
// nothing chosen (RJSF takes no `const` as a default, as in the composer); yes/no fields start
// at no; pickers offer the draft's forces and roles; problems show once "Check" is pressed.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { sampleDesign, sampleTemplates, TEMPLATE } from '@wrx/schemas/fixtures'
import type { Template } from '@wrx/schemas'
import { afterEach, describe, expect, it } from 'vitest'
import { addField, newField, writeTemplate } from './builder.ts'
import type { BuilderModel } from './builder.ts'
import { TemplatePreview } from './TemplatePreview.tsx'

afterEach(cleanup)

const design = sampleDesign()

function built(): Template {
  let model: BuilderModel = { fields: [], root: {} }
  for (const kind of ['dropDown', 'linked', 'yesNo', 'role'] as const) {
    model = addField(model, newField(model, kind))
  }
  const { schema, uiSchema } = writeTemplate(model)
  return {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-0000000000aa',
    name: 'Built',
    schema,
    ...(uiSchema === undefined ? {} : { uiSchema }),
    createdAt: '2026-11-01T00:00:00.000Z',
  }
}

const select = (name: RegExp) => screen.getByRole<HTMLSelectElement>('combobox', { name })

describe('TemplatePreview', () => {
  it('is the player’s themed form, with its widgets', () => {
    const { container } = render(<TemplatePreview template={built()} design={design} />)
    expect(container.querySelector('form.wrx-tform')).not.toBeNull()
    expect(container.querySelector('.wrx-tfield')).not.toBeNull()
  })

  it('starts drop-downs and linked drop-downs with nothing chosen, and yes/no at no', () => {
    render(<TemplatePreview template={built()} design={design} />)
    expect(select(/^Drop-down/).value).toBe('')
    expect(select(/^Drop-down/).selectedOptions[0]?.textContent).toBe('Choose…')
    expect(select(/^Linked drop-down/).value).toBe('')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Yes\/no/ }).checked).toBe(false)
    // The demo's support request: its linked pair is written by hand, not by the builder.
    cleanup()
    const support = sampleTemplates().find((t) => t.id === TEMPLATE.support)
    if (support === undefined) throw new Error('no support request')
    render(<TemplatePreview template={support} design={design} />)
    expect(select(/^Support/).selectedOptions[0]?.textContent).toBe('Choose…')
    expect(select(/^Detail/).selectedOptions[0]?.textContent).toBe('Choose…')
  })

  it('offers the draft’s roles in a role picker, by name, storing the GUID', () => {
    render(<TemplatePreview template={built()} design={design} />)
    const picker = select(/^Role picker/)
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      'Choose a role…',
      'Blue CO (Blue)',
      'Blue Observer (Blue)',
      'Red CO (Red)',
      'White Observer (White)',
    ])
    const blueCo = design.roles.find((r) => r.name === 'Blue CO')?.id ?? ''
    fireEvent.change(picker, { target: { value: blueCo } })
    expect(picker.value).toBe(blueCo)
  })

  it('shows problems as the composer does: on Check, then live', async () => {
    const sitrep = sampleTemplates().find((t) => t.id === TEMPLATE.sitrep)
    if (sitrep === undefined) throw new Error('no situation report')
    const { container } = render(<TemplatePreview template={sitrep} design={design} />)
    expect(container.querySelectorAll('.wrx-tfield__errors')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => {
      expect(container.querySelectorAll('.wrx-tfield__errors').length).toBeGreaterThan(0)
    })
    expect(screen.getByRole('status').textContent).toMatch(/fields? needs? attention/)
    const summary = screen.getByRole('textbox', { name: /Summary/ })
    fireEvent.change(summary, { target: { value: 'Holding.' } })
    const field = summary.closest('.wrx-tfield')
    if (!(field instanceof HTMLElement)) throw new Error('no field')
    await waitFor(() => {
      expect(within(field).queryByRole('list')).toBeNull()
    })
  })

  it('says when the values fit, and sends nothing', async () => {
    const contact = sampleTemplates().find((t) => t.id === TEMPLATE.contact)
    if (contact === undefined) throw new Error('no contact report')
    render(<TemplatePreview template={contact} design={design} />)
    fireEvent.change(screen.getByLabelText(/Seen at/), { target: { value: '2026-10-24T08:40' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Grid reference/ }), {
      target: { value: 'NV1234' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'These values fit the template: a player could send them.',
      )
    })
  })

  it('waits for a template inside the profile', () => {
    const bad = { ...built(), schema: { type: 'object', properties: { x: { type: 'string' } } } }
    render(<TemplatePreview template={bad} design={design} />)
    expect(screen.getByText(/The preview shows once the template is inside/)).toBeTruthy()
  })
})
