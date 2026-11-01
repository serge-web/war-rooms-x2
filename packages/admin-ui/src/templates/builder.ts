// The template builder's model (WP 4.3, TD5, TPL-7): a list of fields from the palette, which it
// writes as JSON Schema plus UI schema in the WRX template profile, and reads back. Pure, so the
// round trip is tested without a DOM.
//
// The builder shows only what it can write back exactly. `readTemplate` reads a schema into
// fields and then writes them out again; unless that gives the same schema and UI schema (key
// order aside), the template opens in the raw editor only (`raw` with the reason). So the builder
// never drops or changes a keyword it does not show, and everything it writes is a schema it can
// read. It writes inside the profile by construction: text has a `maxLength`, pickers carry the
// WRX keywords, drop-downs `enum` or `oneOf` of `{const, title}`, linked drop-downs a
// `dependencies` `oneOf` over the parent's options; `checkTemplateProfile` still has the last word
// (limits, patterns), and its issues are shown on the field they concern.
import { TEMPLATE_LIMITS, isFieldName } from '@wrx/schemas'
import type { PickerScope } from '@wrx/schemas'

/** The palette (TD5, Annex A special fields), in the order it is shown. */
export const FIELD_KINDS = Object.freeze([
  'text',
  'longText',
  'number',
  'slider',
  'yesNo',
  'date',
  'dateTime',
  'dropDown',
  'linked',
  'force',
  'role',
] as const)
export type FieldKind = (typeof FIELD_KINDS)[number]

export const FIELD_KIND_LABEL: Readonly<Record<FieldKind, string>> = Object.freeze({
  text: 'Text',
  longText: 'Long text',
  number: 'Number',
  slider: 'Slider',
  yesNo: 'Yes/no',
  date: 'Date',
  dateTime: 'Date and time',
  dropDown: 'Drop-down',
  linked: 'Linked drop-down',
  force: 'Force picker',
  role: 'Role picker',
})

/** `maxLength` the builder gives a new field, and date fields' fixed lengths. */
export const BUILDER_DEFAULTS = Object.freeze({
  textMaxLength: 200,
  longTextMaxLength: 2_000,
  dateMaxLength: 10,
  dateTimeMaxLength: 40,
  sliderMinimum: 0,
  sliderMaximum: 100,
})

export interface FieldOption {
  /** The stored value. */
  readonly value: string
  /** Shown in place of the value; empty shows the value. */
  readonly label: string
}

interface BaseField {
  /** The builder's own id for the field, stable across renames: list keys and parent links. */
  readonly key: string
  /** The property name: the key of a message's values. */
  readonly name: string
  /** The label (`title`); empty leaves it out. */
  readonly title: string
  /** Help text (`description`); empty leaves it out. */
  readonly description: string
  readonly required: boolean
}

export interface TextFieldModel extends BaseField {
  readonly kind: 'text' | 'longText'
  readonly maxLength: number
  readonly minLength: number | undefined
  /** Empty: no pattern. */
  readonly pattern: string
  /** `ui:placeholder`; empty leaves it out. */
  readonly placeholder: string
  /** Long text only: `ui:options.rows`. */
  readonly rows: number | undefined
}

export interface NumberFieldModel extends BaseField {
  readonly kind: 'number' | 'slider'
  /** `integer` rather than `number`. */
  readonly integer: boolean
  readonly minimum: number | undefined
  readonly maximum: number | undefined
  /** The step (`multipleOf`). */
  readonly multipleOf: number | undefined
}

export interface YesNoFieldModel extends BaseField {
  readonly kind: 'yesNo'
  readonly default: boolean | undefined
}

export interface DateFieldModel extends BaseField {
  readonly kind: 'date' | 'dateTime'
  /** The profile wants a `maxLength` on every string; kept as read. */
  readonly maxLength: number
}

export interface DropDownFieldModel extends BaseField {
  readonly kind: 'dropDown'
  readonly options: readonly FieldOption[]
  /** `ui:widget`: a list (none) or radio buttons. */
  readonly display: 'select' | 'radio'
  readonly default: string | undefined
}

/** A drop-down whose options depend on another drop-down's choice (schema `dependencies`). */
export interface LinkedFieldModel extends BaseField {
  readonly kind: 'linked'
  /** The parent drop-down's `key`. */
  readonly parentKey: string
  /** Options for each of the parent's values; a value with none leaves this field free. */
  readonly choices: readonly {
    readonly parentValue: string
    readonly options: readonly FieldOption[]
  }[]
}

export interface PickerFieldModel extends BaseField {
  readonly kind: 'force' | 'role'
  readonly scope: PickerScope
  /** Role pickers: only the roles of this force (`x-wrx-force`). */
  readonly forceFilter: string | undefined
}

export type FieldModel =
  | TextFieldModel
  | NumberFieldModel
  | YesNoFieldModel
  | DateFieldModel
  | DropDownFieldModel
  | LinkedFieldModel
  | PickerFieldModel

export interface BuilderModel {
  readonly fields: readonly FieldModel[]
  /** Root keywords the builder keeps as they are: `$schema`, `title`, `description`, `additionalProperties`. */
  readonly root: Readonly<Record<string, unknown>>
}

export interface TemplateSchemas {
  readonly schema: Record<string, unknown>
  readonly uiSchema: Record<string, unknown> | undefined
}

/** Root keywords kept as read. */
const KEPT_ROOT_KEYS: readonly string[] = Object.freeze([
  '$schema',
  'title',
  'description',
  'additionalProperties',
])

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function own(object: Json, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// --- Writing ----------------------------------------------------------------------------------

function optionsSchema(options: readonly FieldOption[]): Json {
  return options.some((o) => o.label !== '')
    ? {
        oneOf: options.map((o) =>
          o.label === '' ? { const: o.value } : { const: o.value, title: o.label },
        ),
      }
    : { enum: options.map((o) => o.value) }
}

/** Every option a linked drop-down may hold, in first-seen order: its root `enum` or `oneOf`. */
export function linkedOptions(field: LinkedFieldModel): FieldOption[] {
  const seen = new Map<string, FieldOption>()
  for (const choice of field.choices) {
    for (const option of choice.options) if (!seen.has(option.value)) seen.set(option.value, option)
  }
  return [...seen.values()]
}

function labelled(field: FieldModel, schema: Json): Json {
  return {
    ...schema,
    ...(field.title === '' ? {} : { title: field.title }),
    ...(field.description === '' ? {} : { description: field.description }),
  }
}

function fieldSchema(field: FieldModel): Json {
  switch (field.kind) {
    case 'text':
    case 'longText':
      return labelled(field, {
        type: 'string',
        maxLength: field.maxLength,
        ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
        ...(field.pattern === '' ? {} : { pattern: field.pattern }),
      })
    case 'number':
    case 'slider':
      return labelled(field, {
        type: field.integer ? 'integer' : 'number',
        ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
        ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
        ...(field.multipleOf === undefined ? {} : { multipleOf: field.multipleOf }),
      })
    case 'yesNo':
      return labelled(field, {
        type: 'boolean',
        ...(field.default === undefined ? {} : { default: field.default }),
      })
    case 'date':
    case 'dateTime':
      return labelled(field, {
        type: 'string',
        format: field.kind === 'date' ? 'date' : 'date-time',
        maxLength: field.maxLength,
      })
    case 'dropDown':
      return labelled(field, {
        type: 'string',
        ...optionsSchema(field.options),
        ...(field.default === undefined ? {} : { default: field.default }),
      })
    case 'linked':
      return labelled(field, { type: 'string', ...optionsSchema(linkedOptions(field)) })
    case 'force':
    case 'role':
      return labelled(field, {
        type: 'string',
        'x-wrx-picker': field.kind,
        ...(field.scope === 'room' ? { 'x-wrx-scope': 'room' } : {}),
        ...(field.kind === 'role' && field.forceFilter !== undefined
          ? { 'x-wrx-force': field.forceFilter }
          : {}),
      })
  }
}

function fieldUi(field: FieldModel): Json | undefined {
  const ui: Json = {}
  switch (field.kind) {
    case 'text':
      if (field.placeholder !== '') ui['ui:placeholder'] = field.placeholder
      break
    case 'longText':
      ui['ui:widget'] = 'textarea'
      if (field.rows !== undefined) ui['ui:options'] = { rows: field.rows }
      if (field.placeholder !== '') ui['ui:placeholder'] = field.placeholder
      break
    case 'slider':
      ui['ui:widget'] = 'range'
      break
    case 'dropDown':
      if (field.display === 'radio') ui['ui:widget'] = 'radio'
      break
    default:
      break
  }
  return Object.keys(ui).length === 0 ? undefined : ui
}

/** The schema and UI schema the builder's fields stand for. */
export function writeTemplate(model: BuilderModel): TemplateSchemas {
  const properties: Json = {}
  for (const field of model.fields) properties[field.name] = fieldSchema(field)
  const required = model.fields.filter((f) => f.required).map((f) => f.name)

  // Linked drop-downs: one `oneOf` per parent, a branch per parent option, narrowing each child.
  const dependencies: Json = {}
  for (const parent of model.fields) {
    if (parent.kind !== 'dropDown') continue
    const children = model.fields.filter(
      (f): f is LinkedFieldModel => f.kind === 'linked' && f.parentKey === parent.key,
    )
    if (children.length === 0) continue
    dependencies[parent.name] = {
      oneOf: parent.options.map((option) => {
        const branch: Json = { [parent.name]: { const: option.value } }
        for (const child of children) {
          const options = child.choices.find((c) => c.parentValue === option.value)?.options ?? []
          if (options.length > 0) branch[child.name] = optionsSchema(options)
        }
        return { properties: branch }
      }),
    }
  }

  const kept: Json = {}
  for (const key of KEPT_ROOT_KEYS) {
    const value = own(model.root, key)
    if (value !== undefined) kept[key] = value
  }
  const schema: Json = {
    ...kept,
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    ...(Object.keys(dependencies).length === 0 ? {} : { dependencies }),
  }

  const uiSchema: Json = {}
  if (model.fields.length > 0) uiSchema['ui:order'] = model.fields.map((f) => f.name)
  for (const field of model.fields) {
    const ui = fieldUi(field)
    if (ui !== undefined) uiSchema[field.name] = ui
  }
  return { schema, uiSchema: Object.keys(uiSchema).length === 0 ? undefined : uiSchema }
}

// --- Reading ----------------------------------------------------------------------------------

export type ReadResult =
  | { readonly ok: true; readonly model: BuilderModel }
  | { readonly ok: false; readonly reason: string }

/** Keys for fields read from a schema: the field's position, so they are stable per read. */
function readKey(index: number): string {
  return `f${index}`
}

function readOptions(field: Json): FieldOption[] | undefined {
  const list = own(field, 'enum')
  if (Array.isArray(list)) {
    if (!list.every((v) => typeof v === 'string')) return undefined
    return list.map((value) => ({ value, label: '' }))
  }
  const oneOf = own(field, 'oneOf')
  if (Array.isArray(oneOf)) {
    const options: FieldOption[] = []
    for (const entry of oneOf) {
      if (!isObject(entry) || typeof own(entry, 'const') !== 'string') return undefined
      options.push({ value: text(own(entry, 'const')), label: text(own(entry, 'title')) })
    }
    return options
  }
  return undefined
}

function readField(
  name: string,
  index: number,
  value: unknown,
  ui: Json,
  required: ReadonlySet<string>,
  linked: ReadonlyMap<string, { parent: string; choices: LinkedFieldModel['choices'] }>,
  keyOf: (name: string) => string,
): FieldModel | string {
  if (!isObject(value)) return `the field "${name}" is not a field schema`
  const base = {
    key: readKey(index),
    name,
    title: text(own(value, 'title')),
    description: text(own(value, 'description')),
    required: required.has(name),
  }
  const widget = own(ui, 'ui:widget')
  const type = own(value, 'type')
  if (type === 'boolean') {
    const fallback = own(value, 'default')
    return { ...base, kind: 'yesNo', default: typeof fallback === 'boolean' ? fallback : undefined }
  }
  if (type === 'number' || type === 'integer') {
    return {
      ...base,
      kind: widget === 'range' ? 'slider' : 'number',
      integer: type === 'integer',
      minimum: num(own(value, 'minimum')),
      maximum: num(own(value, 'maximum')),
      multipleOf: num(own(value, 'multipleOf')),
    }
  }
  if (type !== 'string') return `the field "${name}" has a type the builder does not show`
  const picker = own(value, 'x-wrx-picker')
  if (picker === 'force' || picker === 'role') {
    const force = own(value, 'x-wrx-force')
    return {
      ...base,
      kind: picker,
      scope: own(value, 'x-wrx-scope') === 'room' ? 'room' : 'game',
      forceFilter: typeof force === 'string' ? force : undefined,
    }
  }
  const format = own(value, 'format')
  if (format === 'date' || format === 'date-time') {
    return {
      ...base,
      kind: format === 'date' ? 'date' : 'dateTime',
      maxLength: num(own(value, 'maxLength')) ?? 0,
    }
  }
  const options = readOptions(value)
  if (options !== undefined) {
    const link = linked.get(name)
    if (link !== undefined) {
      return { ...base, kind: 'linked', parentKey: keyOf(link.parent), choices: link.choices }
    }
    const fallback = own(value, 'default')
    return {
      ...base,
      kind: 'dropDown',
      options,
      display: widget === 'radio' ? 'radio' : 'select',
      default: typeof fallback === 'string' ? fallback : undefined,
    }
  }
  const rowsOption = own(ui, 'ui:options')
  const rows = isObject(rowsOption) ? num(own(rowsOption, 'rows')) : undefined
  return {
    ...base,
    kind: widget === 'textarea' ? 'longText' : 'text',
    maxLength: num(own(value, 'maxLength')) ?? 0,
    minLength: num(own(value, 'minLength')),
    pattern: text(own(value, 'pattern')),
    placeholder: text(own(ui, 'ui:placeholder')),
    rows,
  }
}

/** The linked drop-downs a `dependencies` keyword describes, by child name; or why not. */
function readDependencies(
  dependencies: unknown,
): Map<string, { parent: string; choices: LinkedFieldModel['choices'] }> | string {
  const linked = new Map<string, { parent: string; choices: LinkedFieldModel['choices'] }>()
  if (dependencies === undefined) return linked
  const unsupported = 'its conditions are not linked drop-downs the builder can show'
  if (!isObject(dependencies)) return unsupported
  for (const [parent, dependency] of Object.entries(dependencies)) {
    if (!isObject(dependency)) return unsupported
    const branches = own(dependency, 'oneOf')
    if (!Array.isArray(branches)) return unsupported
    const choices = new Map<string, { parentValue: string; options: FieldOption[] }[]>()
    for (const branch of branches) {
      if (!isObject(branch)) return unsupported
      const properties = own(branch, 'properties')
      if (!isObject(properties)) return unsupported
      const self = own(properties, parent)
      const parentValue = isObject(self) ? own(self, 'const') : undefined
      if (typeof parentValue !== 'string') return unsupported
      for (const [child, narrowing] of Object.entries(properties)) {
        if (child === parent) continue
        const options = isObject(narrowing) ? readOptions(narrowing) : undefined
        if (options === undefined) return unsupported
        choices.set(child, [...(choices.get(child) ?? []), { parentValue, options }])
      }
    }
    for (const [child, list] of choices) {
      if (linked.has(child)) return unsupported
      linked.set(child, { parent, choices: list })
    }
  }
  return linked
}

/** Field names in display order: `ui:order`, with `*` standing for the rest, else declaration order. */
export function fieldOrder(schema: Json, uiSchema: Json | undefined): string[] {
  const properties = own(schema, 'properties')
  const names = isObject(properties) ? Object.keys(properties) : []
  const order = uiSchema === undefined ? undefined : own(uiSchema, 'ui:order')
  if (!Array.isArray(order)) return names
  const listed = order.filter((n): n is string => typeof n === 'string' && names.includes(n))
  const rest = names.filter((n) => !listed.includes(n))
  const star = order.indexOf('*')
  if (star === -1) return [...listed, ...rest]
  const before = order
    .slice(0, star)
    .filter((n): n is string => typeof n === 'string' && names.includes(n))
  return [...before, ...rest, ...listed.filter((n) => !before.includes(n))]
}

/**
 * The template as builder fields, or why the builder cannot show it (it then opens in the raw
 * editor only). Exact: the fields must write back the same schema and UI schema.
 */
export function readTemplate(schema: unknown, uiSchema: unknown): ReadResult {
  if (!isObject(schema)) return { ok: false, reason: 'the schema is not an object' }
  if (uiSchema !== undefined && !isObject(uiSchema)) {
    return { ok: false, reason: 'the UI schema is not an object' }
  }
  const properties = own(schema, 'properties')
  if (own(schema, 'type') !== 'object' || !isObject(properties)) {
    return { ok: false, reason: 'the schema is not an object of fields' }
  }
  const ui = uiSchema ?? {}
  const requiredList = own(schema, 'required')
  const required = new Set(
    Array.isArray(requiredList) ? requiredList.filter((n) => typeof n === 'string') : [],
  )
  const linked = readDependencies(own(schema, 'dependencies'))
  if (typeof linked === 'string') return { ok: false, reason: linked }

  const order = fieldOrder(schema, uiSchema)
  const keys = new Map(order.map((name, i) => [name, readKey(i)]))
  const keyOf = (name: string) => keys.get(name) ?? ''
  const fields: FieldModel[] = []
  for (const [index, name] of order.entries()) {
    const fieldUiSchema = own(ui, name)
    const field = readField(
      name,
      index,
      own(properties, name),
      isObject(fieldUiSchema) ? fieldUiSchema : {},
      required,
      linked,
      keyOf,
    )
    if (typeof field === 'string') return { ok: false, reason: field }
    fields.push(field)
  }
  for (const [child, link] of linked) {
    const parent = fields.find((f) => f.name === link.parent)
    const field = fields.find((f) => f.name === child)
    if (parent?.kind !== 'dropDown' || field?.kind !== 'linked') {
      return { ok: false, reason: 'its conditions are not linked drop-downs the builder can show' }
    }
  }
  const root: Json = {}
  for (const key of KEPT_ROOT_KEYS) {
    const value = own(schema, key)
    if (value !== undefined) root[key] = value
  }
  const model: BuilderModel = { fields, root }
  const written = writeTemplate(model)
  if (!sameTemplate(written, { schema, uiSchema })) {
    return { ok: false, reason: 'it uses keywords or settings the builder does not show' }
  }
  return { ok: true, model }
}

/**
 * Whether two templates mean the same: equal JSON with object keys in any order, `required` in
 * any order, and the same field order whether `ui:order` gives it or the declaration does.
 */
export function sameTemplate(
  a: { readonly schema: unknown; readonly uiSchema?: unknown },
  b: { readonly schema: unknown; readonly uiSchema?: unknown },
): boolean {
  return canonical(a) === canonical(b)
}

function canonical({ schema, uiSchema }: { schema: unknown; uiSchema?: unknown }): string {
  if (!isObject(schema)) return JSON.stringify(sortKeys({ schema, uiSchema }))
  const ui = isObject(uiSchema) ? uiSchema : undefined
  const order = fieldOrder(schema, ui)
  const rest: Json = {}
  for (const [key, value] of Object.entries(ui ?? {})) {
    if (key === 'ui:order') continue
    if (isObject(value) && Object.keys(value).length === 0) continue
    rest[key] = value
  }
  const required = own(schema, 'required')
  const normal: Json = { ...schema }
  if (Array.isArray(required)) normal.required = (required as unknown[]).map(String).sort()
  return JSON.stringify(sortKeys({ schema: normal, ui: rest, order }))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!isObject(value)) return value
  const out: Json = {}
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key])
  return out
}

// --- Editing ----------------------------------------------------------------------------------

/** A field name from a label: camelCase letters and digits, starting with a letter. */
export function fieldNameFrom(label: string, taken: ReadonlySet<string>): string {
  const words = label
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '')
  let base = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('')
  if (!/^[A-Za-z]/.test(base)) base = `field${base}`
  base = base.slice(0, 56)
  if (!isFieldName(base)) base = 'field'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** A new key no field in the model has. */
export function newFieldKey(model: BuilderModel): string {
  const keys = new Set(model.fields.map((f) => f.key))
  for (let n = model.fields.length; ; n++) {
    const key = `n${n}`
    if (!keys.has(key)) return key
  }
}

/** A new field of `kind`, named from its label, unique in the model. */
export function newField(model: BuilderModel, kind: FieldKind): FieldModel {
  const title = FIELD_KIND_LABEL[kind]
  const base = {
    key: newFieldKey(model),
    name: fieldNameFrom(title, new Set(model.fields.map((f) => f.name))),
    title,
    description: '',
    required: false,
  }
  switch (kind) {
    case 'text':
    case 'longText':
      return {
        ...base,
        kind,
        maxLength:
          kind === 'text' ? BUILDER_DEFAULTS.textMaxLength : BUILDER_DEFAULTS.longTextMaxLength,
        minLength: undefined,
        pattern: '',
        placeholder: '',
        rows: undefined,
      }
    case 'number':
      return {
        ...base,
        kind,
        integer: false,
        minimum: undefined,
        maximum: undefined,
        multipleOf: undefined,
      }
    case 'slider':
      return {
        ...base,
        kind,
        integer: true,
        minimum: BUILDER_DEFAULTS.sliderMinimum,
        maximum: BUILDER_DEFAULTS.sliderMaximum,
        multipleOf: 1,
      }
    case 'yesNo':
      return { ...base, kind, default: undefined }
    case 'date':
      return { ...base, kind, maxLength: BUILDER_DEFAULTS.dateMaxLength }
    case 'dateTime':
      return { ...base, kind, maxLength: BUILDER_DEFAULTS.dateTimeMaxLength }
    case 'dropDown':
      return {
        ...base,
        kind,
        options: [
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' },
        ],
        display: 'select',
        default: undefined,
      }
    case 'linked': {
      const parent = model.fields.find((f) => f.kind === 'dropDown')
      return {
        ...base,
        kind,
        parentKey: parent?.key ?? '',
        choices: (parent?.kind === 'dropDown' ? parent.options : []).map((o) => ({
          parentValue: o.value,
          options: [{ value: `${o.value}A`, label: '' }],
        })),
      }
    }
    case 'force':
    case 'role':
      return { ...base, kind, scope: 'game', forceFilter: undefined }
  }
}

/** The model with `field` added at `index` (the end by default). */
export function addField(model: BuilderModel, field: FieldModel, index?: number): BuilderModel {
  const fields = [...model.fields]
  fields.splice(index ?? fields.length, 0, field)
  return { ...model, fields }
}

/** The model with the field `key` replaced; a renamed parent keeps its linked drop-downs. */
export function updateField(model: BuilderModel, key: string, next: FieldModel): BuilderModel {
  return { ...model, fields: model.fields.map((f) => (f.key === key ? next : f)) }
}

/** The model without the field `key`. Its linked drop-downs become plain drop-downs. */
export function removeField(model: BuilderModel, key: string): BuilderModel {
  return {
    ...model,
    fields: model.fields
      .filter((f) => f.key !== key)
      .map((f): FieldModel => {
        if (f.kind !== 'linked' || f.parentKey !== key) return f
        const { parentKey: _parent, choices: _choices, ...rest } = f
        return {
          ...rest,
          kind: 'dropDown',
          options: linkedOptions(f),
          display: 'select',
          default: undefined,
        }
      }),
  }
}

/** The model with the field `key` moved to `index`. */
export function moveField(model: BuilderModel, key: string, index: number): BuilderModel {
  const from = model.fields.findIndex((f) => f.key === key)
  if (from === -1) return model
  const fields = [...model.fields]
  const [field] = fields.splice(from, 1)
  if (field === undefined) return model
  fields.splice(Math.max(0, Math.min(index, fields.length)), 0, field)
  return { ...model, fields }
}

/** Why a field name cannot be used for `key`'s field, or undefined. */
export function fieldNameProblem(
  model: BuilderModel,
  key: string,
  name: string,
): string | undefined {
  if (!isFieldName(name)) {
    return 'use a letter, then letters, digits or underscores (at most 64)'
  }
  if (model.fields.some((f) => f.key !== key && f.name === name))
    return `another field is "${name}"`
  return undefined
}

/** The most characters a text field may hold, with or without a pattern (the profile's caps). */
export function maxLengthLimit(field: TextFieldModel): number {
  return field.pattern === '' ? TEMPLATE_LIMITS.stringMaxLength : TEMPLATE_LIMITS.patternMaxLength
}
