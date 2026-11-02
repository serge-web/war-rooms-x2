// Message templates (SRD Annex A, WP 4.1): the template document, the WRX template profile (the
// subset of JSON Schema 2020-12 a template may use, plus WRX keywords), the `chat` room config
// version 2 that says who may use which template, and the `template` message body.
//
// The profile is deliberately small. Every template is written by the admin (TD2) but read and
// enforced by every client (TPL-6), so a template must be cheap to validate against whatever a
// modified client sends (T-R1): text has a required `maxLength`, `pattern` passes a safe-regex
// check, and nothing nests. Anything outside the profile is refused, with a message saying where.
import { z } from 'zod'
import { ID_PATTERN, LIMITS, idSchema, isoDateTimeSchema, nameSchema } from './common.ts'
import { jsonByteLength } from './size.ts'

/** Limits of the template profile. */
export const TEMPLATE_LIMITS = Object.freeze({
  /** Templates in a game: one item each on the `templates` node. */
  templates: 500,
  /** Fields in one template. */
  fields: 100,
  titleChars: 200,
  descriptionChars: 1_000,
  /** Largest `maxLength` of a text field: a chat message's limit. */
  stringMaxLength: LIMITS.messageTextChars,
  /** Options in one drop-down. */
  options: 500,
  optionChars: 200,
  /** Conditions (`allOf` entries, `dependencies` keys, `oneOf` branches) in one template. */
  conditions: 100,
  patternChars: 200,
  /** A text field with a `pattern` keeps `maxLength` at or below this. */
  patternMaxLength: 200,
  /** Quantifiers that repeat a variable number of times (`*`, `+`, `{n,}`, `{n,m}`) in one pattern. */
  patternVariableQuantifiers: 3,
  uiTextChars: 1_000,
  textareaRows: 30,
})

/** The JSON Schema dialect templates declare, when they declare one. */
export const TEMPLATE_DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/** A field name: a property of the template's object and a key of a message's `values`. */
export const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/** Names never used for a field, so no code that indexes by field name meets them. */
const FORBIDDEN_FIELD_NAMES: readonly string[] = Object.freeze(['constructor', 'prototype'])

export function isFieldName(name: string): boolean {
  return FIELD_NAME_PATTERN.test(name) && !FORBIDDEN_FIELD_NAMES.includes(name)
}

export const fieldNameSchema = z
  .string()
  .refine(isFieldName, 'must be a field name: a letter, then letters, digits or underscores')
  .describe('A template field name')

/** `x-wrx-picker`: the field holds the GUID of a force or a role (TPL-8). */
export const PICKER_KINDS = Object.freeze(['force', 'role'] as const)
export type PickerKind = (typeof PICKER_KINDS)[number]

/**
 * `x-wrx-scope`: what the composer offers, `game` (every force or role, the default) or `room`
 * (only those in this room). The composer's restriction: the receiver checks only that the GUID
 * is a known or deleted force or role, since room participants change after a message is sent.
 */
export const PICKER_SCOPES = Object.freeze(['game', 'room'] as const)
export type PickerScope = (typeof PICKER_SCOPES)[number]

/** RJSF widget names a template's UI schema may ask for (`ui:widget`). */
export const UI_WIDGETS = Object.freeze([
  'text',
  'textarea',
  'updown',
  'range',
  'select',
  'radio',
  'checkbox',
  'date',
  'datetime',
] as const)
export type UiWidget = (typeof UI_WIDGETS)[number]

export interface ProfileIssue {
  /** Where, from the template document: `['schema', 'properties', 'speed', 'maxLength']`. */
  readonly path: readonly (string | number)[]
  readonly message: string
}

/** A profile issue's path as text, `schema.properties.speed.maxLength`. */
export function profilePath(issue: ProfileIssue): string {
  return issue.path.map(String).join('.')
}

type Json = Readonly<Record<string, unknown>>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function own(object: Json, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined
}

/** A field as declared in the template's `properties`, after the profile check. */
export interface FieldInfo {
  readonly name: string
  readonly type: 'string' | 'number' | 'integer' | 'boolean'
  readonly picker: PickerKind | undefined
  /** Has `enum` or `oneOf`: a drop-down. */
  readonly options: boolean
  /** A picker's `x-wrx-scope`; `game` when left out. */
  readonly scope: PickerScope | undefined
  /** A role picker's `x-wrx-force` filter. */
  readonly forceFilter: string | undefined
}

const ROOT_KEYS: readonly string[] = Object.freeze([
  '$schema',
  'type',
  'title',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'dependencies',
  'allOf',
  'if',
  'then',
  'else',
])

const COMMON_FIELD_KEYS: readonly string[] = Object.freeze([
  'type',
  'title',
  'description',
  'default',
])
const STRING_KEYS: readonly string[] = Object.freeze([
  ...COMMON_FIELD_KEYS,
  'maxLength',
  'minLength',
  'pattern',
  'format',
  'enum',
  'oneOf',
  'x-wrx-picker',
  'x-wrx-scope',
  'x-wrx-force',
])
const NUMBER_KEYS: readonly string[] = Object.freeze([
  ...COMMON_FIELD_KEYS,
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'enum',
  'oneOf',
])
const BOOLEAN_KEYS: readonly string[] = COMMON_FIELD_KEYS
/** What a condition's branch may say about a declared field: narrow its options or range. */
const NARROWING_KEYS: readonly string[] = Object.freeze([
  'type',
  'title',
  'description',
  'const',
  'enum',
  'oneOf',
  'minimum',
  'maximum',
])
const IF_KEYS: readonly string[] = Object.freeze(['const', 'enum'])

/**
 * Checks a template's JSON Schema, and its UI schema if any, against the WRX template profile.
 * Empty when it conforms. The profile:
 *
 * - The root is `{type: 'object', properties, required?, title?, description?}`, optionally with
 *   `$schema` (2020-12), `additionalProperties: false`, and conditions for linked drop-downs:
 *   `dependencies` (a field's list of required fields, or `{oneOf: [branch…]}`), and `if`/`then`/
 *   `else`, at the root or as `allOf` entries. A branch is `{properties, required?}` naming
 *   declared fields only, each narrowed by `const`, `enum`, `oneOf`, `minimum` or `maximum`.
 * - Each field is one of: text (`type: 'string'` with a required `maxLength`, and optional
 *   `minLength`, a safe `pattern`, `format: 'date' | 'date-time'`); a drop-down (`enum`, or
 *   `oneOf` of `{const, title}`); a number or integer (`minimum`, `maximum`, the exclusive
 *   forms, `multipleOf`); a yes/no (`boolean`); a force or role picker (`type: 'string'` with
 *   `x-wrx-picker`, `x-wrx-scope`, and for roles `x-wrx-force`, a force GUID).
 * - No `$ref`, arrays, nested objects or other keywords.
 */
export function checkTemplateProfile(schema: unknown, uiSchema?: unknown): ProfileIssue[] {
  const issues: ProfileIssue[] = []
  const fields = checkRoot(schema, issues)
  if (uiSchema !== undefined) checkUiSchema(uiSchema, fields, issues)
  return issues
}

/** The fields a profile-conforming schema declares, in declaration order. */
export function templateFields(schema: unknown): FieldInfo[] {
  return [...checkRoot(schema, []).values()]
}

function checkRoot(schema: unknown, issues: ProfileIssue[]): Map<string, FieldInfo> {
  const fields = new Map<string, FieldInfo>()
  const at = (path: (string | number)[], message: string) =>
    issues.push({ path: ['schema', ...path], message })
  if (!isObject(schema)) {
    at([], 'must be a JSON Schema object')
    return fields
  }
  for (const key of Object.keys(schema)) {
    if (!ROOT_KEYS.includes(key)) at([key], `"${key}" is not in the WRX template profile`)
  }
  const dialect = own(schema, '$schema')
  if (dialect !== undefined && dialect !== TEMPLATE_DIALECT) {
    at(['$schema'], `must be "${TEMPLATE_DIALECT}" or left out`)
  }
  if (own(schema, 'type') !== 'object') at(['type'], 'must be "object"')
  checkLabel(schema, [], at)
  const extra = own(schema, 'additionalProperties')
  if (extra !== undefined && extra !== false) {
    at(['additionalProperties'], 'must be false or left out: a message holds declared fields only')
  }

  const properties = own(schema, 'properties')
  if (!isObject(properties)) {
    at(['properties'], 'must be an object of fields')
    return fields
  }
  const names = Object.keys(properties)
  if (names.length === 0) at(['properties'], 'a template needs at least one field')
  if (names.length > TEMPLATE_LIMITS.fields) {
    at(['properties'], `has ${names.length} fields; the limit is ${TEMPLATE_LIMITS.fields}`)
  }
  for (const name of names) {
    if (!isFieldName(name)) {
      at(
        ['properties', name],
        `"${name}" is not a field name (a letter, then letters, digits or _)`,
      )
      continue
    }
    const field = checkField(properties[name], ['properties', name], at)
    if (field !== undefined) fields.set(name, { ...field, name })
  }

  checkNameList(own(schema, 'required'), ['required'], fields, at)

  let conditions = 0
  const count = (path: (string | number)[]) => {
    conditions++
    if (conditions === TEMPLATE_LIMITS.conditions + 1) {
      at(path, `more than ${TEMPLATE_LIMITS.conditions} conditions`)
    }
  }
  const dependencies = own(schema, 'dependencies')
  if (dependencies !== undefined) {
    if (!isObject(dependencies)) at(['dependencies'], 'must be an object')
    else {
      for (const [name, dependency] of Object.entries(dependencies)) {
        const path = ['dependencies', name]
        count(path)
        if (!fields.has(name)) at(path, `"${name}" is not a declared field`)
        if (Array.isArray(dependency)) {
          checkNameList(dependency, path, fields, at)
          continue
        }
        if (!isObject(dependency)) {
          at(path, 'must be a list of field names or a branch')
          continue
        }
        const oneOf = own(dependency, 'oneOf')
        if (oneOf === undefined) {
          checkBranch(dependency, path, fields, at, NARROWING_KEYS)
          continue
        }
        if (Object.keys(dependency).length !== 1)
          at(path, 'a `oneOf` dependency holds only `oneOf`')
        if (!Array.isArray(oneOf) || oneOf.length === 0) {
          at([...path, 'oneOf'], 'must be a non-empty list of branches')
          continue
        }
        oneOf.forEach((branch, i) => {
          count([...path, 'oneOf', i])
          checkBranch(branch, [...path, 'oneOf', i], fields, at, NARROWING_KEYS)
        })
      }
    }
  }
  const conditional = (holder: Json, path: (string | number)[]) => {
    const condition = own(holder, 'if')
    const then = own(holder, 'then')
    const otherwise = own(holder, 'else')
    if (condition === undefined) {
      if (then !== undefined || otherwise !== undefined) at(path, '`then` and `else` need an `if`')
      return
    }
    count(path)
    checkBranch(condition, [...path, 'if'], fields, at, IF_KEYS)
    if (then === undefined && otherwise === undefined) at(path, '`if` needs a `then` or an `else`')
    if (then !== undefined) checkBranch(then, [...path, 'then'], fields, at, NARROWING_KEYS)
    if (otherwise !== undefined)
      checkBranch(otherwise, [...path, 'else'], fields, at, NARROWING_KEYS)
  }
  conditional(schema, [])
  const allOf = own(schema, 'allOf')
  if (allOf !== undefined) {
    if (!Array.isArray(allOf)) at(['allOf'], 'must be a list of `if`/`then`/`else` conditions')
    else {
      allOf.forEach((entry, i) => {
        if (!isObject(entry)) {
          at(['allOf', i], 'must be an `if`/`then`/`else` condition')
          return
        }
        for (const key of Object.keys(entry)) {
          if (key !== 'if' && key !== 'then' && key !== 'else') {
            at(['allOf', i, key], 'an `allOf` entry holds only `if`, `then` and `else`')
          }
        }
        if (own(entry, 'if') === undefined) at(['allOf', i], 'needs an `if`')
        conditional(entry, ['allOf', i])
      })
    }
  }
  return fields
}

type At = (path: (string | number)[], message: string) => void

function checkLabel(schema: Json, path: (string | number)[], at: At): void {
  const title = own(schema, 'title')
  if (title !== undefined && !isText(title, TEMPLATE_LIMITS.titleChars)) {
    at([...path, 'title'], `must be text of at most ${TEMPLATE_LIMITS.titleChars} characters`)
  }
  const description = own(schema, 'description')
  if (description !== undefined && !isText(description, TEMPLATE_LIMITS.descriptionChars)) {
    at(
      [...path, 'description'],
      `must be text of at most ${TEMPLATE_LIMITS.descriptionChars} characters`,
    )
  }
}

function checkNameList(
  value: unknown,
  path: (string | number)[],
  fields: ReadonlyMap<string, FieldInfo>,
  at: At,
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    at(path, 'must be a list of field names')
    return
  }
  const seen = new Set<string>()
  value.forEach((name, i) => {
    if (typeof name !== 'string' || !fields.has(name)) {
      at([...path, i], `${JSON.stringify(name)} is not a declared field`)
    } else if (seen.has(name)) {
      at([...path, i], `"${name}" is listed twice`)
    } else {
      seen.add(name)
    }
  })
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function checkField(
  value: unknown,
  path: (string | number)[],
  at: At,
): Omit<FieldInfo, 'name'> | undefined {
  if (!isObject(value)) {
    at(path, 'must be a field schema object')
    return undefined
  }
  const declared = own(value, 'type')
  const type =
    declared === 'string' ||
    declared === 'number' ||
    declared === 'integer' ||
    declared === 'boolean'
      ? declared
      : undefined
  if (type === undefined) {
    at([...path, 'type'], 'must be "string", "number", "integer" or "boolean"')
    return undefined
  }
  const allowed = type === 'string' ? STRING_KEYS : type === 'boolean' ? BOOLEAN_KEYS : NUMBER_KEYS
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) at([...path, key], `"${key}" is not allowed on a ${type} field`)
  }
  checkLabel(value, path, at)
  const fallback = own(value, 'default')

  if (type === 'boolean') {
    if (fallback !== undefined && typeof fallback !== 'boolean') {
      at([...path, 'default'], 'must be true or false')
    }
    return { type, picker: undefined, options: false, scope: undefined, forceFilter: undefined }
  }

  const options = checkOptions(value, type, path, at)
  if (type === 'number' || type === 'integer') {
    const bounds = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const
    for (const key of bounds) {
      const bound = own(value, key)
      if (bound !== undefined && !isFiniteNumber(bound)) at([...path, key], 'must be a number')
    }
    const min = own(value, 'minimum')
    const max = own(value, 'maximum')
    if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
      at([...path, 'maximum'], 'must not be less than `minimum`')
    }
    const step = own(value, 'multipleOf')
    if (step !== undefined && !(isFiniteNumber(step) && step > 0)) {
      at([...path, 'multipleOf'], 'must be a number greater than 0')
    }
    if (fallback !== undefined && !isFiniteNumber(fallback))
      at([...path, 'default'], 'must be a number')
    if (type === 'integer' && isFiniteNumber(fallback) && !Number.isInteger(fallback)) {
      at([...path, 'default'], 'must be a whole number')
    }
    return { type, picker: undefined, options, scope: undefined, forceFilter: undefined }
  }

  // Strings: a picker, a drop-down or text.
  const picker = own(value, 'x-wrx-picker')
  if (picker !== undefined) {
    if (picker !== 'force' && picker !== 'role') {
      at([...path, 'x-wrx-picker'], 'must be "force" or "role"')
      return undefined
    }
    for (const key of ['maxLength', 'minLength', 'pattern', 'format', 'enum', 'oneOf', 'default']) {
      if (own(value, key) !== undefined) {
        at([...path, key], `a ${picker} picker takes no "${key}": its value is a GUID`)
      }
    }
    const scope = own(value, 'x-wrx-scope')
    if (scope !== undefined && scope !== 'game' && scope !== 'room') {
      at([...path, 'x-wrx-scope'], 'must be "game" or "room"')
    }
    const force = own(value, 'x-wrx-force')
    if (force !== undefined) {
      if (picker !== 'role') at([...path, 'x-wrx-force'], 'filters a role picker only')
      else if (typeof force !== 'string' || !ID_PATTERN.test(force)) {
        at([...path, 'x-wrx-force'], 'must be a force GUID')
      }
    }
    return {
      type,
      picker,
      options: false,
      scope: scope === 'room' ? 'room' : 'game',
      forceFilter: typeof force === 'string' && picker === 'role' ? force : undefined,
    }
  }
  for (const key of ['x-wrx-scope', 'x-wrx-force']) {
    if (own(value, key) !== undefined) at([...path, key], 'needs `x-wrx-picker`')
  }
  const format = own(value, 'format')
  if (format !== undefined && format !== 'date' && format !== 'date-time') {
    at([...path, 'format'], 'must be "date" or "date-time"')
  }
  if (options) {
    for (const key of ['maxLength', 'minLength', 'pattern', 'format']) {
      if (own(value, key) !== undefined) at([...path, key], `a drop-down takes no "${key}"`)
    }
    if (fallback !== undefined && typeof fallback !== 'string')
      at([...path, 'default'], 'must be text')
    return { type, picker: undefined, options, scope: undefined, forceFilter: undefined }
  }
  const maxLength = own(value, 'maxLength')
  const longest =
    own(value, 'pattern') === undefined
      ? TEMPLATE_LIMITS.stringMaxLength
      : TEMPLATE_LIMITS.patternMaxLength
  if (!(
    Number.isInteger(maxLength) &&
    isFiniteNumber(maxLength) &&
    maxLength >= 1 &&
    maxLength <= longest
  )) {
    at(
      [...path, 'maxLength'],
      `a text field needs a maxLength from 1 to ${longest}${longest === TEMPLATE_LIMITS.patternMaxLength ? ' when it has a pattern' : ''}`,
    )
  }
  const minLength = own(value, 'minLength')
  if (minLength !== undefined) {
    if (!(Number.isInteger(minLength) && isFiniteNumber(minLength) && minLength >= 0)) {
      at([...path, 'minLength'], 'must be a whole number, 0 or more')
    } else if (isFiniteNumber(maxLength) && minLength > maxLength) {
      at([...path, 'minLength'], 'must not be more than `maxLength`')
    }
  }
  const pattern = own(value, 'pattern')
  if (pattern !== undefined) {
    const problem = typeof pattern === 'string' ? unsafePattern(pattern) : 'must be text'
    if (problem !== undefined) at([...path, 'pattern'], problem)
  }
  if (fallback !== undefined && !isText(fallback, isFiniteNumber(maxLength) ? maxLength : 0)) {
    at([...path, 'default'], 'must be text within `maxLength`')
  }
  return { type, picker: undefined, options: false, scope: undefined, forceFilter: undefined }
}

/** `enum` or `oneOf` of `{const, title}`; whether the field has either. */
function checkOptions(
  value: Json,
  type: 'string' | 'number' | 'integer',
  path: (string | number)[],
  at: At,
): boolean {
  const list = own(value, 'enum')
  const oneOf = own(value, 'oneOf')
  if (list === undefined && oneOf === undefined) return false
  if (list !== undefined && oneOf !== undefined) {
    at(path, 'use `enum` or `oneOf`, not both')
    return true
  }
  const ofType = (v: unknown) =>
    type === 'string'
      ? isText(v, TEMPLATE_LIMITS.optionChars)
      : isFiniteNumber(v) && (type === 'number' || Number.isInteger(v))
  const optionsPath = [...path, list !== undefined ? 'enum' : 'oneOf']
  const entries = list ?? oneOf
  if (!Array.isArray(entries) || entries.length === 0) {
    at(optionsPath, 'must be a non-empty list of options')
    return true
  }
  if (entries.length > TEMPLATE_LIMITS.options) {
    at(optionsPath, `has ${entries.length} options; the limit is ${TEMPLATE_LIMITS.options}`)
  }
  const seen = new Set<unknown>()
  entries.forEach((entry, i) => {
    let option: unknown = entry
    if (oneOf !== undefined) {
      if (!isObject(entry) || Object.keys(entry).some((k) => k !== 'const' && k !== 'title')) {
        at([...optionsPath, i], 'must be `{const, title}`')
        return
      }
      option = own(entry, 'const')
      const title = own(entry, 'title')
      if (title !== undefined && !isText(title, TEMPLATE_LIMITS.optionChars)) {
        at(
          [...optionsPath, i, 'title'],
          `must be text of at most ${TEMPLATE_LIMITS.optionChars} characters`,
        )
      }
    }
    if (!ofType(option)) {
      at(
        [...optionsPath, i],
        `must be ${type === 'string' ? `text of at most ${TEMPLATE_LIMITS.optionChars} characters` : `a ${type}`}`,
      )
    } else if (seen.has(option)) {
      at([...optionsPath, i], `${JSON.stringify(option)} is listed twice`)
    }
    seen.add(option)
  })
  return true
}

/** A condition's branch: `{properties: {declared: narrowing}, required?}`. */
function checkBranch(
  value: unknown,
  path: (string | number)[],
  fields: ReadonlyMap<string, FieldInfo>,
  at: At,
  narrowingKeys: readonly string[],
): void {
  if (!isObject(value)) {
    at(path, 'must be `{properties, required?}`')
    return
  }
  for (const key of Object.keys(value)) {
    if (key !== 'properties' && key !== 'required') {
      at([...path, key], 'a branch holds only `properties` and `required`')
    }
  }
  checkNameList(own(value, 'required'), [...path, 'required'], fields, at)
  const properties = own(value, 'properties')
  if (properties === undefined) return
  if (!isObject(properties)) {
    at([...path, 'properties'], 'must be an object')
    return
  }
  for (const [name, narrowing] of Object.entries(properties)) {
    const here = [...path, 'properties', name]
    const field = fields.get(name)
    if (field === undefined) {
      at(here, `"${name}" is not a declared field: declare every field in the root \`properties\``)
      continue
    }
    if (!isObject(narrowing)) {
      at(here, 'must be an object')
      continue
    }
    for (const key of Object.keys(narrowing)) {
      if (!narrowingKeys.includes(key)) at([...here, key], `"${key}" is not allowed in a condition`)
    }
    const type = own(narrowing, 'type')
    if (type !== undefined && type !== field.type) at([...here, 'type'], `must be "${field.type}"`)
    if (field.type === 'boolean') {
      const c = own(narrowing, 'const')
      if (c !== undefined && typeof c !== 'boolean') at([...here, 'const'], 'must be true or false')
      continue
    }
    if (own(narrowing, 'const') !== undefined) {
      const c = own(narrowing, 'const')
      const ok =
        field.type === 'string' ? isText(c, TEMPLATE_LIMITS.optionChars) : isFiniteNumber(c)
      if (!ok) at([...here, 'const'], `must be a ${field.type}`)
    }
    if (field.type !== 'string') {
      for (const key of ['minimum', 'maximum']) {
        const bound = own(narrowing, key)
        if (bound !== undefined && !isFiniteNumber(bound)) at([...here, key], 'must be a number')
      }
    }
    if (own(narrowing, 'enum') !== undefined || own(narrowing, 'oneOf') !== undefined) {
      checkOptions(narrowing, field.type, here, at)
    }
  }
}

/**
 * Why a `pattern` is refused, or `undefined` if it is safe to run on any value within the
 * profile's `patternMaxLength` (T-R1: a modified client's value must not make the receiver
 * backtrack for long). Stricter than a star-height check, which passes `(a|a)*`:
 *
 * - at most `patternChars` characters, valid with the `u` flag (as validators compile it);
 * - no backreferences and no lookaround;
 * - no quantifier on a group but `?`: only single characters, escapes and classes repeat;
 * - at most `patternVariableQuantifiers` quantifiers that repeat a variable number of times.
 *
 * With every repeat on a single atom, the worst case is polynomial in the number of variable
 * quantifiers, and the length cap bounds it.
 */
export function unsafePattern(pattern: string): string | undefined {
  if (pattern.length > TEMPLATE_LIMITS.patternChars) {
    return `a pattern has at most ${TEMPLATE_LIMITS.patternChars} characters`
  }
  try {
    new RegExp(pattern, 'u')
  } catch {
    return 'is not a valid regular expression'
  }
  let variable = 0
  // What the previous token was: an atom that may repeat, a group's end, or nothing.
  let previous: 'atom' | 'group' | 'none' = 'none'
  let i = 0
  const quantifierAt = (at: number): { length: number; variable: boolean } | undefined => {
    const c = pattern[at]
    if (c === '*' || c === '+') return { length: 1, variable: true }
    if (c === '?') return { length: 1, variable: false }
    if (c === '{') {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(at))
      if (match === null) return undefined
      const exact = match[2] === undefined || match[3] === match[1]
      return { length: match[0].length, variable: !exact }
    }
    return undefined
  }
  while (i < pattern.length) {
    const c = pattern[i]
    const quantifier = quantifierAt(i)
    if (quantifier !== undefined) {
      // An optional group, `(…)?`, repeats nothing; any other quantifier on a group does.
      if (previous === 'group' && c !== '?')
        return 'a group may not repeat: repeat single characters or classes only'
      if (previous === 'none') return 'is not a valid regular expression'
      if (quantifier.variable) variable++
      if (variable > TEMPLATE_LIMITS.patternVariableQuantifiers) {
        return `at most ${TEMPLATE_LIMITS.patternVariableQuantifiers} of *, + and {n,m} in a pattern`
      }
      i += quantifier.length
      if (pattern[i] === '?') i++ // lazy
      previous = 'none'
      continue
    }
    if (c === '\\') {
      const next = pattern[i + 1] ?? ''
      if (/[1-9]/.test(next) || next === 'k') return 'backreferences are not allowed'
      // \p{…}, \u{…}, \x.. and \cX are one atom; their braces are not quantifiers.
      const escape =
        /^\\(?:[pP]\{[^}]*\}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|c[A-Za-z]|.)/su.exec(
          pattern.slice(i),
        )
      i += escape?.[0].length ?? 2
      previous = 'atom'
      continue
    }
    if (c === '[') {
      i++
      if (pattern[i] === '^') i++
      if (pattern[i] === ']') i++
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1
      i++
      previous = 'atom'
      continue
    }
    if (c === '(') {
      if (pattern.startsWith('(?=', i) || pattern.startsWith('(?!', i))
        return 'lookahead is not allowed'
      if (pattern.startsWith('(?<=', i) || pattern.startsWith('(?<!', i))
        return 'lookbehind is not allowed'
      // `(`, `(?:` or a named group `(?<name>`.
      const opening = /^\((?:\?:|\?<[^>]*>)?/.exec(pattern.slice(i))
      i += opening?.[0].length ?? 1
      previous = 'none'
      continue
    }
    if (c === ')') {
      i++
      previous = 'group'
      continue
    }
    if (c === '|' || c === '^' || c === '$') {
      i++
      previous = 'none'
      continue
    }
    i++
    previous = 'atom'
  }
  return undefined
}

function checkUiSchema(
  uiSchema: unknown,
  fields: ReadonlyMap<string, FieldInfo>,
  issues: ProfileIssue[],
): void {
  const at = (path: (string | number)[], message: string) =>
    issues.push({ path: ['uiSchema', ...path], message })
  if (!isObject(uiSchema)) {
    at([], 'must be an object')
    return
  }
  for (const [key, value] of Object.entries(uiSchema)) {
    if (key === 'ui:order') {
      if (!Array.isArray(value)) {
        at([key], 'must be a list of field names')
        continue
      }
      const seen = new Set<unknown>()
      value.forEach((name, i) => {
        if (name !== '*' && (typeof name !== 'string' || !fields.has(name))) {
          at([key, i], `${JSON.stringify(name)} is not a declared field or "*"`)
        } else if (seen.has(name)) at([key, i], `${JSON.stringify(name)} is listed twice`)
        seen.add(name)
      })
      continue
    }
    const field = fields.get(key)
    if (field === undefined) {
      at([key], `"${key}" is not a declared field or "ui:order"`)
      continue
    }
    if (!isObject(value)) {
      at([key], 'must be an object')
      continue
    }
    for (const [option, setting] of Object.entries(value)) {
      const here = [key, option]
      switch (option) {
        case 'ui:widget': {
          if (typeof setting !== 'string' || !(UI_WIDGETS as readonly string[]).includes(setting)) {
            at(here, `must be one of ${UI_WIDGETS.join(', ')}`)
            break
          }
          const problem = widgetProblem(setting as UiWidget, field)
          if (problem !== undefined) at(here, problem)
          break
        }
        case 'ui:title':
        case 'ui:placeholder':
          if (!isText(setting, TEMPLATE_LIMITS.titleChars)) {
            at(here, `must be text of at most ${TEMPLATE_LIMITS.titleChars} characters`)
          }
          break
        case 'ui:help':
        case 'ui:description':
          if (!isText(setting, TEMPLATE_LIMITS.uiTextChars)) {
            at(here, `must be text of at most ${TEMPLATE_LIMITS.uiTextChars} characters`)
          }
          break
        case 'ui:autofocus':
          if (typeof setting !== 'boolean') at(here, 'must be true or false')
          break
        case 'ui:options': {
          if (!isObject(setting)) {
            at(here, 'must be an object')
            break
          }
          for (const [name, v] of Object.entries(setting)) {
            if (name !== 'rows') at([...here, name], 'only `rows` is allowed')
            else if (!(
              Number.isInteger(v) &&
              isFiniteNumber(v) &&
              v >= 1 &&
              v <= TEMPLATE_LIMITS.textareaRows
            )) {
              at(
                [...here, name],
                `must be a whole number from 1 to ${TEMPLATE_LIMITS.textareaRows}`,
              )
            }
          }
          break
        }
        default:
          at(here, `"${option}" is not in the WRX template profile`)
      }
    }
  }
}

function widgetProblem(widget: UiWidget, field: FieldInfo): string | undefined {
  const text = field.type === 'string' && field.picker === undefined && !field.options
  switch (widget) {
    case 'text':
    case 'textarea':
    case 'date':
    case 'datetime':
      return text ? undefined : `"${widget}" is for text fields`
    case 'updown':
    case 'range':
      return field.type === 'number' || field.type === 'integer'
        ? undefined
        : `"${widget}" is for number fields`
    case 'select':
    case 'radio':
      return field.options || field.type === 'boolean' ? undefined : `"${widget}" is for drop-downs`
    case 'checkbox':
      return field.type === 'boolean' ? undefined : '"checkbox" is for yes/no fields'
  }
}

/** The item limit's room for a template document. */
function fitsInItem(doc: unknown): boolean {
  return jsonByteLength(doc) <= LIMITS.pubsubItemBytes - LIMITS.pubsubItemOverheadBytes
}

/**
 * One item of the `templates` node, its item id the template's GUID (TPL-1, provisional answer
 * 1). Read: every game user; publish: the admin (TD2). Its `schema` and `uiSchema` conform to the
 * WRX template profile (`checkTemplateProfile`), and the document fits in one PubSub item.
 */
export const templateSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema.describe('The template GUID; also the item id'),
    name: nameSchema.describe('Shown in the composer’s drop-down and on each card (TD7)'),
    description: z
      .string()
      .max(LIMITS.descriptionChars)
      .optional()
      .describe('For the admin and the composer; plain text (PLY-14)'),
    schema: z
      .record(z.string(), z.unknown())
      .describe(
        'JSON Schema 2020-12 in the WRX template profile: an object of up to 100 named scalar fields (text with a required maxLength of at most 8,000, or 200 with a pattern; number; integer; yes/no; date; date and time; a drop-down of up to 500 options; a force or role picker marked by x-wrx-picker, with x-wrx-scope and x-wrx-force), linked drop-downs and conditions one level deep (dependencies, if/then/else), and patterns that pass a safe-regex check. No $ref, arrays or nested objects',
      ),
    uiSchema: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('RJSF UI schema in the WRX template profile: field order, widgets, hints'),
    createdAt: isoDateTimeSchema.describe("Admin's clock when created; display only"),
    lockedAt: isoDateTimeSchema
      .optional()
      .describe(
        'Set by the first publish that makes the template available in a room; its schema is then fixed, and changing it means copying it to a new template (TD6, TPL-4)',
      ),
  })
  .superRefine((template, ctx) => {
    for (const issue of checkTemplateProfile(template.schema, template.uiSchema)) {
      ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message })
    }
    if (!fitsInItem(template)) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'the template does not fit in one PubSub item',
      })
    }
  })
  .describe('A message template: a JSON Schema form the admin designs')

export type Template = z.infer<typeof templateSchema>

/** One entry of a chat room's template config: like a participant entry (§3 rule 4). */
export const templateEntrySchema = z
  .object({
    kind: z.enum(['force', 'role']),
    id: idSchema.describe('Force or role GUID'),
    templateIds: z
      .array(idSchema)
      .refine((ids) => new Set(ids).size === ids.length, 'each template may appear only once')
      .describe('Templates this force or role may use here; a role entry adds to its force’s'),
  })
  .describe('Templates a force or role may use in a room (TD4, TPL-2)')

export type TemplateEntry = z.infer<typeof templateEntrySchema>

/** The `chat` room config's current version. */
export const CHAT_CONFIG_VERSION = 2

/**
 * `chat` room config version 2 (TPL-2): whether free text is allowed beside templates (TD3), and
 * which templates each force or role may use (TD4). The admin, and the White Force's roles that
 * are not observers, may use every template the room's entries name; observers none.
 */
export const chatRoomConfigSchema = z
  .object({
    schemaVersion: z.literal(CHAT_CONFIG_VERSION),
    freeText: z.boolean().describe('Free text allowed beside templates (TD3)'),
    templates: z
      .array(templateEntrySchema)
      .refine(
        (entries) => new Set(entries.map((e) => `${e.kind}:${e.id}`)).size === entries.length,
        'each force or role may appear only once',
      )
      .describe('Template entries per force or role (TD4)'),
  })
  .describe('Chat room config: free text and templates')

export type ChatRoomConfig = z.infer<typeof chatRoomConfigSchema>

/** What a version 1 config (`{}`, from before templates) means: free text, no templates. */
export const CHAT_CONFIG_V1: Readonly<ChatRoomConfig> = Object.freeze({
  schemaVersion: CHAT_CONFIG_VERSION,
  freeText: true,
  templates: [],
})

/**
 * Reads a chat room's config: version 2 as it is, and a config with no version or version 1
 * (v1 rooms have `{}`) as free text with no templates. Anything else is refused.
 */
export const chatRoomConfigReader: z.ZodType<ChatRoomConfig> = z.union([
  chatRoomConfigSchema,
  z
    .looseObject({ schemaVersion: z.literal(1).optional() })
    .transform((): ChatRoomConfig => ({ ...CHAT_CONFIG_V1, templates: [] })),
])

/** A field value: text, a number or yes/no; force and role pickers hold GUIDs (TPL-8). */
export const templateValueSchema = z.union([
  z.string().max(LIMITS.messageTextChars),
  z.number(),
  z.boolean(),
])

export type TemplateValue = z.infer<typeof templateValueSchema>

/**
 * The body of a templated message (TPL-3): the template GUID and the field values. Checked
 * against the template and the room's config on receipt (TPL-6, `@wrx/templates`); sender
 * identity still comes from the stanza (§3 rule 3).
 */
export const templateMessageBodySchema = z
  .object({
    type: z.literal('template'),
    schemaVersion: z.literal(1),
    content: z.object({
      templateId: idSchema.describe('The template used'),
      values: z
        .record(fieldNameSchema, templateValueSchema)
        .refine(
          (values) => Object.keys(values).length <= TEMPLATE_LIMITS.fields,
          `at most ${TEMPLATE_LIMITS.fields} values`,
        )
        .describe('Field values by field name; pickers hold GUIDs, never names (TPL-8)'),
    }),
  })
  .describe('A templated message')

export type TemplateMessageBody = z.infer<typeof templateMessageBodySchema>
