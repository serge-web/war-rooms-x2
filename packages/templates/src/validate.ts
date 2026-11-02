// Validating field values against a template (TPL-6), shared by the composer (through the RJSF
// adapter, `./rjsf.ts`) and the receiver (`check.ts`), so sender and receiver agree (T-R1).
//
// `@cfworker/json-schema` interprets the schema: it never compiles code, so it runs under the
// client's Content-Security-Policy, which has no 'unsafe-eval' (security review F7). Ajv, RJSF's
// usual validator, compiles every schema with `new Function` and cannot.
import { Validator } from '@cfworker/json-schema'
import type { OutputUnit, Schema } from '@cfworker/json-schema'
import { ID_PATTERN, templateFields } from '@wrx/schemas'
import type { Template, TemplateValue } from '@wrx/schemas'

/** One reason values do not fit a template. */
export interface TemplateError {
  /** The field it concerns; `undefined` for the form as a whole. */
  readonly field: string | undefined
  /** The JSON Schema keyword that failed, e.g. `maxLength`, `required`, `enum`. */
  readonly keyword: string
  /** Plain text for the user. */
  readonly message: string
  /** JSON pointer into the schema, e.g. `#/properties/speed/maximum`. */
  readonly schemaPath: string
}

export interface ValuesCheck {
  readonly valid: boolean
  readonly errors: readonly TemplateError[]
}

/** Values as RJSF and the message body hold them; `undefined` is an empty field. */
export type FormValues = Readonly<Record<string, TemplateValue | undefined>>

/**
 * The schema a template's values are validated against: the template's own, with what the
 * profile implies made explicit. The root takes no undeclared field (`additionalProperties:
 * false`), and a force or role picker's value must be a GUID (TPL-8). WRX keywords are left in:
 * the validator ignores unknown keywords.
 */
export function validationSchemaOf(schema: Template['schema']): Schema {
  const properties: Record<string, unknown> =
    typeof schema.properties === 'object' && schema.properties !== null
      ? { ...(schema.properties as Record<string, unknown>) }
      : {}
  for (const field of templateFields(schema)) {
    if (field.picker === undefined) continue
    const declared = properties[field.name]
    properties[field.name] = {
      ...(typeof declared === 'object' && declared !== null ? declared : {}),
      pattern: ID_PATTERN.source,
    }
  }
  // Profile-checked JSON, so every value is a JSON Schema the validator can read.
  const validation = { ...schema, properties, additionalProperties: false }
  return validation as Schema
}

/**
 * A copy of the values with no prototype and no empty fields. The validator tests fields with
 * `in`, which on a plain object also finds `toString` and the rest of `Object.prototype`: a
 * required field named `toString` would pass unfilled, and one present would be validated as a
 * function and throw. Empty (`undefined`) fields are what RJSF passes for unfilled ones.
 */
export function plainValues(
  values: FormValues | Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const copy = Object.create(null) as Record<string, unknown>
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) copy[key] = value
  }
  return copy
}

/** Wrapper errors the validator adds above the error that says what is wrong. */
const WRAPPERS: readonly string[] = Object.freeze([
  'properties',
  'allOf',
  'anyOf',
  'oneOf',
  'if',
  'then',
  'else',
  'dependencies',
  'dependentSchemas',
  '$ref',
])

/** The field an error is about: from its instance location, or a `required` error's text. */
function fieldOf(unit: OutputUnit): string | undefined {
  const location = unit.instanceLocation.replace(/^#\/?/, '')
  if (location !== '')
    return decodeURIComponent(location.split('/')[0] ?? '')
      .replace(/~1/g, '/')
      .replace(/~0/g, '~')
  const named =
    /property "([^"]+)"/.exec(unit.error) ?? /but does not have "([^"]+)"/.exec(unit.error)
  return named?.[1]
}

function messageOf(unit: OutputUnit, field: string | undefined): string {
  switch (unit.keyword) {
    case 'required':
    case 'dependencies':
    case 'dependentRequired':
      return 'is required'
    case 'additionalProperties':
    case 'false':
      return field === undefined
        ? 'has a field the template does not have'
        : 'is not a field of this template'
    case 'type':
      return 'has the wrong type'
    case 'maxLength':
      return 'is too long'
    case 'minLength':
      return 'is too short'
    case 'pattern':
      return 'is not in the expected form'
    case 'format':
      return 'is not a valid date or time'
    case 'enum':
    case 'const':
      return 'is not one of the options'
    case 'minimum':
    case 'exclusiveMinimum':
      return 'is too small'
    case 'maximum':
    case 'exclusiveMaximum':
      return 'is too large'
    case 'multipleOf':
      return 'is not a whole number of steps'
    default:
      return 'is not valid'
  }
}

/** Errors that say what is wrong, without the validator's wrappers and with no repeats. */
export function templateErrors(
  units: readonly OutputUnit[],
  declared: ReadonlySet<string> = new Set(),
): TemplateError[] {
  // An undeclared field is reported twice, as `additionalProperties` on the form and `false` on
  // the field; a declared field that fails is also reported as undeclared, since the validator
  // counts only valid fields as evaluated. Keep the field's `false`, and only if undeclared.
  const leaves = units.filter(
    (u) =>
      !WRAPPERS.includes(u.keyword) &&
      u.keyword !== 'additionalProperties' &&
      !(u.keyword === 'false' && declared.has(fieldOf(u) ?? '')),
  )
  const chosen = leaves.length > 0 ? leaves : units
  const seen = new Set<string>()
  const errors: TemplateError[] = []
  for (const unit of chosen) {
    const field = fieldOf(unit)
    const message = messageOf(unit, field)
    const key = `${field ?? ''}|${message}`
    if (seen.has(key)) continue
    seen.add(key)
    errors.push({ field, keyword: unit.keyword, message, schemaPath: unit.keywordLocation })
  }
  return errors
}

/**
 * Validates values against schemas, keeping one interpreter per schema object it has seen. Make
 * one per store or form (client code keeps no module state, ARC-2).
 */
export interface TemplateValidator {
  /** Values against a template's schema (`validationSchemaOf`). */
  validate(
    schema: Template['schema'],
    values: FormValues | Readonly<Record<string, unknown>>,
  ): ValuesCheck
  /** Any value against any schema, as given: what the RJSF adapter's `isValid` needs. */
  validateRaw(schema: Schema | boolean, value: unknown): ValuesCheck
}

/** Each declared text field's `maxLength` (the profile requires one on every text field). */
export function textLimits(schema: Template['schema']): ReadonlyMap<string, number> {
  const properties: unknown = schema.properties
  const limits = new Map<string, number>()
  if (typeof properties !== 'object' || properties === null) return limits
  for (const field of templateFields(schema)) {
    if (field.type !== 'string') continue
    const declared: unknown = (properties as Record<string, unknown>)[field.name]
    const max: unknown =
      typeof declared === 'object' && declared !== null && 'maxLength' in declared
        ? declared.maxLength
        : undefined
    if (typeof max === 'number' && Number.isFinite(max)) limits.set(field.name, max)
  }
  return limits
}

/** A string's length as JSON Schema counts it: in code points, not UTF-16 units. */
function codePoints(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) i++
    n++
  }
  return n
}

export function createTemplateValidator(): TemplateValidator {
  const forTemplate = new WeakMap<
    object,
    { validator: Validator; declared: Set<string>; limits: ReadonlyMap<string, number> }
  >()
  const forRaw = new WeakMap<object, Validator>()
  const run = (
    validator: Validator,
    value: unknown,
    declared?: ReadonlySet<string>,
  ): ValuesCheck => {
    try {
      const result = validator.validate(value)
      return {
        valid: result.valid,
        errors: result.valid ? [] : templateErrors(result.errors, declared),
      }
    } catch (e) {
      // The validator throws for values JSON cannot hold (functions, undefined); network data
      // never throws (NFR-5).
      return {
        valid: false,
        errors: [
          {
            field: undefined,
            keyword: 'type',
            message: e instanceof Error ? e.message : 'not valid',
            schemaPath: '#',
          },
        ],
      }
    }
  }
  return {
    validate(schema, values) {
      let compiled = forTemplate.get(schema)
      if (compiled === undefined) {
        compiled = {
          // shortCircuit false: every error, so the composer can mark every field at once.
          validator: new Validator(validationSchemaOf(schema), '2020-12', false),
          declared: new Set(templateFields(schema).map((f) => f.name)),
          limits: textLimits(schema),
        }
        forTemplate.set(schema, compiled)
      }
      const { validator, declared, limits } = compiled
      const plain = plainValues(values)
      // A text over its maxLength is refused before the validator sees it: the validator runs
      // every keyword (shortCircuit false), so it would test the field's `pattern` or `format`
      // on the whole value. The profile bounds a pattern's cost only up to the field's maxLength
      // (200 with a pattern); a modified client's 8,000 characters took minutes (security
      // review, phase 4, H1).
      const tooLong: TemplateError[] = []
      for (const [name, max] of limits) {
        const value = plain[name]
        if (typeof value !== 'string' || value.length <= max || codePoints(value) <= max) continue
        tooLong.push({
          field: name,
          keyword: 'maxLength',
          message: 'is too long',
          schemaPath: `#/properties/${name}/maxLength`,
        })
      }
      if (tooLong.length === 0) return run(validator, plain, declared)
      const cut = new Set(tooLong.map((e) => e.field))
      const rest = plainValues(
        Object.fromEntries(Object.entries(plain).filter(([n]) => !cut.has(n))),
      )
      const result = run(validator, rest, declared)
      return {
        valid: false,
        errors: [...tooLong, ...result.errors.filter((e) => !cut.has(e.field))],
      }
    },
    validateRaw(schema, value) {
      if (typeof schema === 'boolean') return run(new Validator(schema, '2020-12', false), value)
      let validator = forRaw.get(schema)
      if (validator === undefined) {
        validator = new Validator(schema, '2020-12', false)
        forRaw.set(schema, validator)
      }
      const plain =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? plainValues(value as Record<string, unknown>)
          : value
      return run(validator, plain)
    },
  }
}
