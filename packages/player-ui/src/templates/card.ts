// A templated message as a card (TD7, TPL-5): the template's name, then each filled field's label
// and value in the form's order. Pure display data: no React, no store. Values stay raw where
// their text depends on the reader's clock (dates), so the card formats them where it renders.
import { templateFields } from '@wrx/schemas'
import type { FieldInfo, Template, TemplateMessageBody, TemplateValue } from '@wrx/schemas'
import { entityName } from './pickers.ts'
import type { PickerSource } from './pickers.ts'

export type CardValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'yes-no'; readonly value: boolean }
  /** `format: date`, `YYYY-MM-DD`: a calendar day, shown without a time zone shift. */
  | { readonly kind: 'date'; readonly iso: string }
  /** `format: date-time`, an ISO instant: shown in local wall-clock time (PLY-45). */
  | { readonly kind: 'date-time'; readonly iso: string }
  /** A drop-down: the option's title, or the value itself. */
  | { readonly kind: 'option'; readonly text: string }
  /** A force or role picker's GUID as its current name, or its last name if deleted (TPL-8, 9). */
  | {
      readonly kind: 'entity'
      readonly picker: 'force' | 'role'
      readonly name: string
      readonly deleted: boolean
    }

export interface CardField {
  readonly name: string
  readonly label: string
  readonly value: CardValue
}

export interface TemplateCardView {
  readonly templateId: string
  /** Plain text (PLY-14). */
  readonly templateName: string
  readonly fields: readonly CardField[]
}

type Json = Readonly<Record<string, unknown>>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function own(object: unknown, key: string): unknown {
  return isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined
}

/**
 * Field names in the form's order: the UI schema's `ui:order`, where `*` stands for every field
 * it does not name (RJSF's rule); fields an order without `*` leaves out follow at the end, so a
 * card never drops a value and the form never refuses the order.
 */
export function orderedFieldNames(template: Template): string[] {
  const names = templateFields(template.schema).map((f) => f.name)
  const order = own(template.uiSchema, 'ui:order')
  if (!Array.isArray(order)) return names
  const listed = order.filter(
    (n): n is string => typeof n === 'string' && (n === '*' || names.includes(n)),
  )
  const rest = names.filter((n) => !listed.includes(n))
  const ordered = listed.flatMap((n) => (n === '*' ? rest : [n]))
  return listed.includes('*') ? ordered : [...ordered, ...rest]
}

/** A field's label: the UI schema's `ui:title`, the schema's `title`, or the field name. */
export function fieldLabel(template: Template, name: string): string {
  const ui = own(own(template.uiSchema, name), 'ui:title')
  if (typeof ui === 'string' && ui !== '') return ui
  const title = own(own(own(template.schema, 'properties'), name), 'title')
  return typeof title === 'string' && title !== '' ? title : name
}

function optionTitle(declared: unknown, value: TemplateValue): string | undefined {
  const oneOf = own(declared, 'oneOf')
  if (!Array.isArray(oneOf)) return undefined
  for (const option of oneOf as unknown[]) {
    if (own(option, 'const') === value) {
      const title = own(option, 'title')
      return typeof title === 'string' && title !== '' ? title : undefined
    }
  }
  return undefined
}

function cardValue(
  field: FieldInfo,
  declared: unknown,
  value: TemplateValue,
  source: PickerSource,
): CardValue {
  if (typeof value === 'boolean') return { kind: 'yes-no', value }
  if (field.picker !== undefined && typeof value === 'string') {
    const found = entityName(field.picker, value, source)
    return {
      kind: 'entity',
      picker: field.picker,
      // A valid message names a known or deleted entity; anything else shows the GUID.
      name: found?.name ?? value,
      deleted: found?.deleted ?? false,
    }
  }
  if (field.options) {
    return { kind: 'option', text: optionTitle(declared, value) ?? String(value) }
  }
  if (typeof value === 'number') return { kind: 'number', value }
  const format = own(declared, 'format')
  if (format === 'date') return { kind: 'date', iso: value }
  if (format === 'date-time') return { kind: 'date-time', iso: value }
  return { kind: 'text', text: value }
}

/**
 * The card for a templated message that fits its template (`checkTemplatedMessage` said
 * `valid` or `not-permitted`): the template's name, then each field that has a value, in the
 * form's order. Picker GUIDs become names from `source` (TPL-8).
 */
export function templateCard(
  body: TemplateMessageBody,
  template: Template,
  source: PickerSource,
): TemplateCardView {
  const fields = new Map(templateFields(template.schema).map((f) => [f.name, f]))
  const properties = own(template.schema, 'properties')
  const values = body.content.values
  const shown: CardField[] = []
  for (const name of orderedFieldNames(template)) {
    const field = fields.get(name)
    if (field === undefined || !Object.hasOwn(values, name)) continue
    const value = values[name]
    if (value === undefined) continue
    shown.push({
      name,
      label: fieldLabel(template, name),
      value: cardValue(field, own(properties, name), value, source),
    })
  }
  return Object.freeze({
    templateId: template.id,
    templateName: template.name,
    fields: Object.freeze(shown),
  })
}

export interface CardClock {
  /** A calendar day, `YYYY-MM-DD`, e.g. "24 Oct 2026". */
  date(iso: string): string
  /** An instant in local wall-clock time, e.g. "24 Oct 2026, 08:40" (PLY-45). */
  dateTime(iso: string): string
}

/** Formatters for card dates in one locale and zone. Make one per list, not one per card. */
export function cardClock({
  locale,
  timeZone,
}: {
  readonly locale?: string | undefined
  readonly timeZone?: string | undefined
} = {}): CardClock {
  // A date is a calendar day: read and written in UTC, so no zone moves it to the day before.
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const instant = new Intl.DateTimeFormat(locale, {
    ...(timeZone === undefined ? {} : { timeZone }),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return {
    date: (iso) => {
      const ms = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : Number.NaN
      return Number.isNaN(ms) ? iso : day.format(ms)
    },
    dateTime: (iso) => {
      const ms = Date.parse(iso)
      return Number.isNaN(ms) ? iso : instant.format(ms)
    },
  }
}

/** A card value as one line of text, for the card itself and for screen-reader summaries. */
export function cardValueText(value: CardValue, clock: CardClock): string {
  switch (value.kind) {
    case 'text':
    case 'option':
      return value.text
    case 'number':
      return value.value.toLocaleString('en', { maximumFractionDigits: 20 })
    case 'yes-no':
      return value.value ? 'Yes' : 'No'
    case 'date':
      return clock.date(value.iso)
    case 'date-time':
      return clock.dateTime(value.iso)
    case 'entity':
      return value.deleted ? `${value.name} (deleted)` : value.name
  }
}
