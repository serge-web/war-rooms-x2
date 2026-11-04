import { describe, expect, it } from 'vitest'
import { retrieveSchema } from '@rjsf/utils'
import type { RJSFSchema } from '@rjsf/utils'
import type { Template } from '@wrx/schemas'
import { FORCE, sampleTemplates } from '@wrx/schemas/fixtures'
import { createTemplateFormValidator } from './rjsf.ts'
import { createTemplateValidator } from './validate.ts'

const [SITREP, , SUPPORT] = sampleTemplates() as [Template, Template, Template]
const schemaOf = (t: Template): RJSFSchema => t.schema

describe('the RJSF validator adapter (WP 4.2, 4.3)', () => {
  const validator = createTemplateFormValidator()

  it('validates a form as the receiver does', () => {
    const good = { force: FORCE.blue, summary: 'ok', readiness: 50, asOf: '2026-10-24' }
    expect(validator.validateFormData(good, schemaOf(SITREP))).toEqual({
      errors: [],
      errorSchema: {},
    })
    const bad = validator.validateFormData(
      { ...good, readiness: 101, summary: undefined },
      schemaOf(SITREP),
    )
    expect(bad.errors.map((e) => [e.property, e.message])).toEqual(
      expect.arrayContaining([
        ['.summary', 'is required'],
        ['.readiness', 'is too large'],
      ]),
    )
    expect(bad.errorSchema).toMatchObject({
      summary: { __errors: ['is required'] },
      readiness: { __errors: expect.arrayContaining(['is too large']) as unknown },
    })
    const receiver = createTemplateValidator().validate(SITREP.schema, { ...good, readiness: 101 })
    expect(receiver.valid).toBe(false)
  })

  it('refuses a picker value that is not a GUID, as the receiver does', () => {
    const form = { force: 'Blue', summary: 'ok', readiness: 50, asOf: '2026-10-24' }
    expect(
      validator.validateFormData(form, schemaOf(SITREP)).errors.map((e) => e.property),
    ).toEqual(['.force'])
  })

  it('runs custom validation and error transforms', () => {
    const form = { force: FORCE.blue, summary: 'ok', readiness: 50, asOf: '2026-10-24' }
    const result = validator.validateFormData(
      form,
      schemaOf(SITREP),
      (data, errors) => {
        if (data?.summary === 'ok') errors.summary?.addError('say more')
        return errors
      },
      (errors) => errors,
    )
    expect(result.errorSchema).toMatchObject({ summary: { __errors: ['say more'] } })
    expect(result.errors.map((e) => e.stack)).toEqual(['.summary say more'])
  })

  it('lets RJSF resolve linked drop-downs with it (isValid)', () => {
    const air = retrieveSchema(validator, schemaOf(SUPPORT), schemaOf(SUPPORT), { kind: 'air' })
    expect((air.properties?.detail as RJSFSchema).enum).toEqual(['strike', 'recce'])
    const logistics = retrieveSchema(validator, schemaOf(SUPPORT), schemaOf(SUPPORT), {
      kind: 'logistics',
    })
    expect((logistics.properties?.detail as RJSFSchema).enum).toEqual(['fuel', 'ammunition'])
    expect(validator.isValid({ type: 'string', maxLength: 2 }, undefined, schemaOf(SUPPORT))).toBe(
      false,
    )
  })

  it('reports raw validation without throwing', () => {
    expect(validator.rawValidation(schemaOf(SITREP), {}).errors).toHaveLength(4)
  })
})
