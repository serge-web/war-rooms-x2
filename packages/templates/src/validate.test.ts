import { describe, expect, it } from 'vitest'
import { ID_PATTERN, templateSchema } from '@wrx/schemas'
import type { Template } from '@wrx/schemas'
import { FORCE, sampleTemplates } from '@wrx/schemas/fixtures'
import { createTemplateValidator, plainValues, validationSchemaOf } from './validate.ts'

const [SITREP, CONTACT, SUPPORT] = sampleTemplates() as [Template, Template, Template]

const GOOD_SITREP = {
  force: FORCE.blue,
  summary: 'Holding the bridge',
  readiness: 75,
  asOf: '2026-10-24',
  threat: 'medium',
}

function fields(result: { errors: readonly { field: string | undefined; message: string }[] }) {
  return result.errors.map((e) => `${e.field ?? '(form)'} ${e.message}`)
}

describe('the template validator (TPL-6)', () => {
  const validator = createTemplateValidator()

  it('accepts values that fit', () => {
    expect(validator.validate(SITREP.schema, GOOD_SITREP)).toEqual({ valid: true, errors: [] })
    expect(
      validator.validate(CONTACT.schema, {
        seenAt: '2026-10-24T09:15:00Z',
        grid: 'NV1234',
        hostile: true,
      }),
    ).toEqual({ valid: true, errors: [] })
  })

  it('names every field that does not fit', () => {
    const result = validator.validate(SITREP.schema, {
      force: 'Blue Force',
      summary: '',
      readiness: 101,
      asOf: '24/10/2026',
      threat: 'extreme',
    })
    expect(result.valid).toBe(false)
    expect(fields(result).sort()).toEqual(
      [
        'asOf is not a valid date or time',
        'force is not in the expected form',
        'readiness is not a whole number of steps',
        'readiness is too large',
        'summary is too short',
        'threat is not one of the options',
      ].sort(),
    )
  })

  it('reports required fields, wrong types, steps and undeclared fields', () => {
    expect(fields(validator.validate(SITREP.schema, {}))).toEqual([
      'force is required',
      'summary is required',
      'readiness is required',
      'asOf is required',
    ])
    expect(fields(validator.validate(SITREP.schema, { ...GOOD_SITREP, readiness: '75' }))).toEqual([
      'readiness has the wrong type',
    ])
    expect(fields(validator.validate(SITREP.schema, { ...GOOD_SITREP, readiness: 72 }))).toEqual([
      'readiness is not a whole number of steps',
    ])
    expect(fields(validator.validate(SITREP.schema, { ...GOOD_SITREP, extra: 'x' }))).toEqual([
      'extra is not a field of this template',
    ])
  })

  it('treats an empty field as unfilled, as RJSF passes it', () => {
    expect(
      fields(validator.validate(SITREP.schema, { ...GOOD_SITREP, threat: undefined })),
    ).toEqual([])
    expect(
      fields(validator.validate(SITREP.schema, { ...GOOD_SITREP, summary: undefined })),
    ).toEqual(['summary is required'])
  })

  it('checks linked drop-downs both ways', () => {
    expect(validator.validate(SUPPORT.schema, { kind: 'air', detail: 'strike' }).valid).toBe(true)
    expect(validator.validate(SUPPORT.schema, { kind: 'logistics', detail: 'fuel' }).valid).toBe(
      true,
    )
    expect(validator.validate(SUPPORT.schema, { kind: 'air', detail: 'fuel' }).valid).toBe(false)
    expect(validator.validate(SUPPORT.schema, { kind: 'logistics', detail: 'recce' }).valid).toBe(
      false,
    )
  })

  it('checks `if`/`then` conditions', () => {
    const template = templateSchema.parse({
      ...SUPPORT,
      schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['air', 'land'] },
          size: { type: 'integer', minimum: 0, maximum: 100 },
        },
        allOf: [
          {
            if: { properties: { kind: { const: 'air' } }, required: ['kind'] },
            then: { properties: { size: { maximum: 4 } } },
          },
        ],
      },
    })
    expect(validator.validate(template.schema, { kind: 'air', size: 4 }).valid).toBe(true)
    expect(validator.validate(template.schema, { kind: 'air', size: 5 }).valid).toBe(false)
    expect(validator.validate(template.schema, { kind: 'land', size: 50 }).valid).toBe(true)
  })

  it('makes a picker value a GUID and adds no undeclared field', () => {
    const schema = validationSchemaOf(SITREP.schema)
    expect(schema.additionalProperties).toBe(false)
    expect((schema.properties as Record<string, { pattern?: string }>).force?.pattern).toBe(
      ID_PATTERN.source,
    )
    // The template itself is not changed.
    expect((SITREP.schema.properties as Record<string, object>).force).not.toHaveProperty('pattern')
  })

  describe('hostile values (T-R1)', () => {
    it('refuses a value far over maxLength quickly', () => {
      const started = performance.now()
      const result = validator.validate(SITREP.schema, {
        ...GOOD_SITREP,
        summary: 'x'.repeat(8_000),
      })
      expect(fields(result)).toEqual(['summary is too long'])
      expect(performance.now() - started).toBeLessThan(500)
    })

    it('runs the template’s pattern only within maxLength’s cost', () => {
      const started = performance.now()
      const result = validator.validate(CONTACT.schema, {
        seenAt: '2026-10-24T09:15:00Z',
        grid: `NV${'1'.repeat(7_000)}!`,
      })
      expect(result.valid).toBe(false)
      expect(performance.now() - started).toBeLessThan(500)
    })

    it('never throws on values JSON can hold and the body refuses, and on prototype names', () => {
      for (const values of [
        { force: { nested: true } },
        { force: [1, 2] },
        { force: null },
        { readiness: Number.NaN },
      ]) {
        expect(validator.validate(SITREP.schema, values).valid).toBe(false)
      }
    })

    it('does not see Object.prototype as fields', () => {
      const template = templateSchema.parse({
        ...SITREP,
        schema: {
          type: 'object',
          properties: {
            toString: { type: 'string', maxLength: 5 },
            hasOwnProperty: { type: 'string', maxLength: 5 },
          },
          required: ['toString', 'hasOwnProperty'],
        },
        uiSchema: undefined,
      })
      expect(fields(validator.validate(template.schema, {}))).toEqual([
        'toString is required',
        'hasOwnProperty is required',
      ])
      expect(
        validator.validate(template.schema, { toString: 'a', hasOwnProperty: 'b' }).valid,
      ).toBe(true)
      expect(Object.getPrototypeOf(plainValues({ a: 1 }))).toBeNull()
    })

    it('handles a deeply nested value without overflowing', () => {
      let deep: unknown = 'x'
      for (let i = 0; i < 5_000; i++) deep = { x: deep }
      expect(validator.validate(SITREP.schema, { ...GOOD_SITREP, summary: deep }).valid).toBe(false)
    })
  })

  it('reuses its interpreter for the same schema object', () => {
    const one = createTemplateValidator()
    const started = performance.now()
    for (let i = 0; i < 1_000; i++) one.validate(SITREP.schema, GOOD_SITREP)
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
