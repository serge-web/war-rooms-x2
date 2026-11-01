import { FORCE, sampleTemplates } from '@wrx/schemas/fixtures'
import { checkTemplateProfile } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
import {
  FIELD_KINDS,
  addField,
  fieldNameFrom,
  fieldOrder,
  moveField,
  newField,
  readTemplate,
  removeField,
  sameTemplate,
  updateField,
  writeTemplate,
} from './builder.ts'
import type { BuilderModel } from './builder.ts'

const EMPTY: BuilderModel = { fields: [], root: {} }

function withEveryKind(): BuilderModel {
  let model = EMPTY
  for (const kind of FIELD_KINDS) model = addField(model, newField(model, kind))
  return model
}

describe('the template builder', () => {
  it('reads every sample template and writes it back unchanged', () => {
    for (const template of sampleTemplates()) {
      const read = readTemplate(template.schema, template.uiSchema)
      expect(read.ok, template.name).toBe(true)
      if (!read.ok) continue
      const written = writeTemplate(read.model)
      expect(sameTemplate(written, template)).toBe(true)
      expect(checkTemplateProfile(written.schema, written.uiSchema)).toEqual([])
    }
  })

  it('reads the linked drop-downs and the role filter of the support request', () => {
    const support = sampleTemplates()[2]!
    const read = readTemplate(support.schema, support.uiSchema)
    if (!read.ok) throw new Error(read.reason)
    const kinds = read.model.fields.map((f) => [f.name, f.kind])
    expect(kinds).toEqual([
      ['kind', 'dropDown'],
      ['detail', 'linked'],
      ['to', 'role'],
      ['urgent', 'yesNo'],
    ])
    const detail = read.model.fields[1]
    expect(detail?.kind === 'linked' && detail.parentKey).toBe(read.model.fields[0]?.key)
    const to = read.model.fields[2]
    expect(to?.kind === 'role' && to.forceFilter).toBe(FORCE.blue)
  })

  it('writes a template with every field type inside the profile, and reads it back', () => {
    const model = withEveryKind()
    expect(model.fields.map((f) => f.kind)).toEqual([...FIELD_KINDS])
    const written = writeTemplate(model)
    expect(checkTemplateProfile(written.schema, written.uiSchema)).toEqual([])
    const read = readTemplate(written.schema, written.uiSchema)
    if (!read.ok) throw new Error(read.reason)
    expect(read.model.fields.map((f) => [f.name, f.kind])).toEqual(
      model.fields.map((f) => [f.name, f.kind]),
    )
    expect(sameTemplate(writeTemplate(read.model), written)).toBe(true)
  })

  it('opens what it cannot show in the raw editor only', () => {
    const base = { type: 'object', properties: { a: { type: 'integer', exclusiveMinimum: 0 } } }
    expect(readTemplate(base, undefined)).toMatchObject({ ok: false })
    const conditional = {
      type: 'object',
      properties: { a: { type: 'boolean' }, b: { type: 'string', maxLength: 5 } },
      if: { properties: { a: { const: true } } },
      then: { required: ['b'] },
    }
    expect(readTemplate(conditional, undefined)).toMatchObject({ ok: false })
    const help = {
      type: 'object',
      properties: { a: { type: 'string', maxLength: 5 } },
    }
    expect(readTemplate(help, { a: { 'ui:help': 'Hint' } })).toMatchObject({ ok: false })
    expect(readTemplate(help, { a: { 'ui:widget': 'text' } })).toMatchObject({ ok: false })
    expect(readTemplate([], undefined)).toMatchObject({ ok: false })
    expect(readTemplate(help, undefined)).toMatchObject({ ok: true })
  })

  it('reads an empty template as no fields', () => {
    const read = readTemplate({ type: 'object', properties: {} }, undefined)
    expect(read).toEqual({ ok: true, model: EMPTY })
  })

  it('keeps root keywords it does not edit', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Report',
      additionalProperties: false,
      type: 'object',
      properties: { a: { type: 'boolean' } },
    }
    const read = readTemplate(schema, undefined)
    if (!read.ok) throw new Error(read.reason)
    expect(writeTemplate(read.model).schema).toMatchObject({ title: 'Report' })
  })

  it('names fields from labels, uniquely', () => {
    expect(fieldNameFrom('Grid reference', new Set())).toBe('gridReference')
    expect(fieldNameFrom('Grid reference', new Set(['gridReference']))).toBe('gridReference2')
    expect(fieldNameFrom('2nd line', new Set())).toBe('field2ndLine')
    expect(fieldNameFrom('---', new Set())).toBe('field')
  })

  it('follows ui:order, with * standing for the rest', () => {
    const schema = { type: 'object', properties: { a: {}, b: {}, c: {} } }
    expect(fieldOrder(schema, undefined)).toEqual(['a', 'b', 'c'])
    expect(fieldOrder(schema, { 'ui:order': ['c', '*'] })).toEqual(['c', 'a', 'b'])
    expect(fieldOrder(schema, { 'ui:order': ['*', 'a'] })).toEqual(['b', 'c', 'a'])
    expect(fieldOrder(schema, { 'ui:order': ['b'] })).toEqual(['b', 'a', 'c'])
  })

  it('moves, renames and removes fields; a removed parent leaves a plain drop-down', () => {
    const model = withEveryKind()
    const dropDown = model.fields.find((f) => f.kind === 'dropDown')!
    const moved = moveField(model, dropDown.key, 0)
    expect(moved.fields[0]?.key).toBe(dropDown.key)
    const renamed = updateField(moved, dropDown.key, { ...dropDown, name: 'parent' })
    const written = writeTemplate(renamed)
    expect(Object.keys(written.schema.dependencies as object)).toEqual(['parent'])
    const removed = removeField(renamed, dropDown.key)
    expect(removed.fields.some((f) => f.kind === 'linked')).toBe(false)
    expect(writeTemplate(removed).schema.dependencies).toBeUndefined()
    expect(checkTemplateProfile(writeTemplate(removed).schema)).toEqual([])
  })
})
