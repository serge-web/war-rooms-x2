// XEP-0004 data forms: build submit forms from plain values, and read typed values back.
import type * as XMPP from 'stanza'

export type DataForm = XMPP.Stanzas.DataForm
export type DataFormField = XMPP.Stanzas.DataFormField

/** A value we put in a submitted form field. */
export type FormValue = string | boolean | readonly string[]

export interface FieldValue {
  readonly name: string
  readonly value: FormValue
}

/** A submit form with its FORM_TYPE, from plain name/value pairs (XEP-0004 §3.4, XEP-0068). */
export function submitForm(formType: string, values: readonly FieldValue[]): DataForm {
  const fields: DataFormField[] = [{ name: 'FORM_TYPE', type: 'hidden', value: formType }]
  for (const { name, value } of values) {
    fields.push({ name, value: typeof value === 'object' ? [...value] : value })
  }
  return { type: 'submit', fields }
}

function field(form: DataForm | undefined, name: string): DataFormField | undefined {
  return form?.fields?.find((f) => f.name === name)
}

/** Field names the form offers, in order. */
export function fieldNames(form: DataForm | undefined): readonly string[] {
  const names: string[] = []
  for (const f of form?.fields ?? []) if (f.name !== undefined) names.push(f.name)
  return names
}

/** A single-valued field as a string; multi-valued fields are joined with newlines. */
export function stringField(form: DataForm | undefined, name: string): string | undefined {
  const value = field(form, name)?.value
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value.join('\n')
  return String(value)
}

/** All values of a field as strings (jid-multi, list-multi, text-multi, or a single value). */
export function listField(form: DataForm | undefined, name: string): readonly string[] {
  const value = field(form, name)?.value
  if (value === undefined) return []
  if (Array.isArray(value)) return value.map(String)
  return [String(value)]
}

/** A boolean field. XEP-0004 §3.3 allows `1`/`0` as well as `true`/`false`. */
export function booleanField(form: DataForm | undefined, name: string): boolean | undefined {
  const value = field(form, name)?.value
  if (typeof value === 'boolean') return value
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return undefined
}
