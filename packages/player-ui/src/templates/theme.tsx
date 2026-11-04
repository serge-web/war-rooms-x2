// The RJSF theme of the template composer (Annex A, TPL-3; WP 4.2): our own field templates and
// widgets on native controls, styled only by the --wrx-* tokens of the panel's theme scope
// (D24, PLY-26), with no Bootstrap or MUI. Every label, title, description and hint is rendered
// as React text, never Markdown or HTML (PLY-14): RJSF's Markdown descriptions are never used.
//
// Native controls rather than Radix primitives: a native select, range or date input works from
// the keyboard and with screen readers as it is (NFR-14), needs no portal (so it works in a
// popout window and a narrow tab alike), and the browser gives date pickers their local display
// (PLY-45). @wrx/ui uses Radix only where a primitive helps (dialogs, toasts).
import {
  descriptionId,
  enumOptionsIndexForValue,
  enumOptionsValueForIndex,
  errorId,
  getInputProps,
  getUiOptions,
  helpId,
} from '@rjsf/utils'
import type {
  DescriptionFieldProps,
  FieldTemplateProps,
  ObjectFieldTemplateProps,
  RegistryWidgetsType,
  RJSFSchema,
  TemplatesType,
  TitleFieldProps,
  WidgetProps,
} from '@rjsf/utils'
import type { ChangeEvent } from 'react'
import { pickerOptions } from './pickers.ts'
import type { PickerSource } from './pickers.ts'

/** What the composer hands every widget, through RJSF's `formContext`. */
export interface TemplateFormContext {
  readonly [key: string]: unknown
  readonly templateName: string
  /** Live forces, roles and deleted entities for the pickers (TPL-8, TPL-9). */
  readonly pickers: PickerSource
}

type Props = WidgetProps<Record<string, unknown>, RJSFSchema, TemplateFormContext>

/** The widget name the composer gives force and role picker fields in its UI schema. */
export const PICKER_WIDGET = 'wrxPicker'

export function labelId(id: string): string {
  return `${id}__label`
}

export function countId(id: string): string {
  return `${id}__count`
}

/** The ids describing a control: only elements the field template does render. */
function describedBy(props: Props, ...extra: (string | undefined)[]): string | undefined {
  const ui = getUiOptions(props.uiSchema)
  const ids = [
    (props.rawErrors?.length ?? 0) > 0 && props.hideError !== true ? errorId(props.id) : undefined,
    hasText(ui.description ?? props.schema.description) ? descriptionId(props.id) : undefined,
    hasText(ui.help) ? helpId(props.id) : undefined,
    ...extra,
  ].filter((id): id is string => id !== undefined)
  return ids.length === 0 ? undefined : ids.join(' ')
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function common(props: Props) {
  return {
    id: props.id,
    name: props.htmlName ?? props.id,
    disabled: props.disabled === true || props.readonly === true,
    'aria-invalid': (props.rawErrors?.length ?? 0) > 0 || undefined,
    'aria-required': props.required === true || undefined,
    onBlur: (event: { target: { value: string } }) => {
      props.onBlur(props.id, event.target.value)
    },
    onFocus: (event: { target: { value: string } }) => {
      props.onFocus(props.id, event.target.value)
    },
  }
}

function emptyTo(props: Props, value: string): unknown {
  return value === '' ? props.options.emptyValue : value
}

// ---- Templates --------------------------------------------------------------------------------

function FieldTemplate(props: FieldTemplateProps) {
  const { id, label, children, rawErrors, rawHelp, rawDescription, hidden, required } = props
  if (hidden === true) return <div hidden>{children}</div>
  // The root object's own template draws its legend; a yes/no draws its label beside the box.
  const ui = getUiOptions(props.uiSchema)
  const isRoot = props.schema.type === 'object'
  const isCheckbox =
    props.schema.type === 'boolean' && (ui.widget === undefined || ui.widget === 'checkbox')
  const showLabel = props.displayLabel !== false && !isRoot && !isCheckbox && label !== ''
  const errors = (rawErrors ?? []).filter(hasText)
  if (isRoot) return children
  return (
    <div className={`wrx-tfield${errors.length > 0 ? ' wrx-tfield--invalid' : ''}`} data-field={id}>
      {showLabel ? (
        <label id={labelId(id)} className="wrx-tfield__label" htmlFor={id}>
          {label}
          {required === true ? (
            <span className="wrx-tfield__required" aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {hasText(rawDescription) ? (
        <p id={descriptionId(id)} className="wrx-tfield__hint">
          {rawDescription}
        </p>
      ) : null}
      {children}
      {errors.length === 0 || props.hideError === true ? null : (
        <ul id={errorId(id)} className="wrx-tfield__errors">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
      {hasText(rawHelp) ? (
        <p id={helpId(id)} className="wrx-tfield__hint">
          {rawHelp}
        </p>
      ) : null}
    </div>
  )
}

function ObjectFieldTemplate(
  props: ObjectFieldTemplateProps<Record<string, unknown>, RJSFSchema, TemplateFormContext>,
) {
  const context = props.registry.formContext
  const description = typeof props.description === 'string' ? props.description : undefined
  return (
    <fieldset
      className="wrx-tform__fields"
      id={props.fieldPathId.$id}
      // Disabled, its fields cannot take focus, so the fieldset does, for scrolling it from the
      // keyboard when it overflows (WCAG 2.1.1; a paused composer, PLY-56).
      tabIndex={props.disabled === true ? 0 : undefined}
    >
      <legend className="wrx-visually-hidden">{context.templateName}</legend>
      {hasText(description) ? <p className="wrx-tfield__hint">{description}</p> : null}
      {props.properties.map((property) => property.content)}
    </fieldset>
  )
}

/** Titles and descriptions as plain text (PLY-14); never RJSF's Markdown. */
function TitleFieldTemplate({ id, title }: TitleFieldProps) {
  return (
    <p id={id} className="wrx-tfield__label">
      {title}
    </p>
  )
}

function DescriptionFieldTemplate({ id, description }: DescriptionFieldProps) {
  return typeof description === 'string' && description !== '' ? (
    <p id={id} className="wrx-tfield__hint">
      {description}
    </p>
  ) : null
}

/** Errors are drawn by the field template beside each field, and summed up by the composer. */
function Nothing() {
  return null
}

export const templateTheme: Readonly<Partial<Omit<TemplatesType, 'ButtonTemplates'>>> =
  Object.freeze({
    FieldTemplate,
    ObjectFieldTemplate: ObjectFieldTemplate as TemplatesType['ObjectFieldTemplate'],
    TitleFieldTemplate,
    DescriptionFieldTemplate,
    ErrorListTemplate: Nothing,
    FieldErrorTemplate: Nothing,
    FieldHelpTemplate: Nothing,
  })

// ---- Widgets ----------------------------------------------------------------------------------

/** Text, with a counter when the field has a `maxLength` (it always has, in the profile). */
function TextWidget(props: Props) {
  // RJSF's default widget for numbers is `text`: they get the number field.
  if (props.schema.type === 'number' || props.schema.type === 'integer') {
    return <UpDownWidget {...props} />
  }
  const max = typeof props.schema.maxLength === 'number' ? props.schema.maxLength : undefined
  const text = typeof props.value === 'string' ? props.value : ''
  return (
    <>
      <input
        {...common(props)}
        type="text"
        className="wrx-tfield__input"
        value={text}
        placeholder={props.placeholder}
        maxLength={max}
        readOnly={props.readonly}
        aria-describedby={describedBy(props, max === undefined ? undefined : countId(props.id))}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          props.onChange(emptyTo(props, event.target.value))
        }}
      />
      <Counter id={props.id} length={text.length} max={max} />
    </>
  )
}

function TextareaWidget(props: Props) {
  const max = typeof props.schema.maxLength === 'number' ? props.schema.maxLength : undefined
  const text = typeof props.value === 'string' ? props.value : ''
  const rows = typeof props.options.rows === 'number' ? props.options.rows : 3
  return (
    <>
      <textarea
        {...common(props)}
        className="wrx-tfield__input wrx-tfield__textarea"
        value={text}
        rows={rows}
        placeholder={props.placeholder}
        maxLength={max}
        readOnly={props.readonly}
        aria-describedby={describedBy(props, max === undefined ? undefined : countId(props.id))}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          props.onChange(emptyTo(props, event.target.value))
        }}
      />
      <Counter id={props.id} length={text.length} max={max} />
    </>
  )
}

function Counter({ id, length, max }: { id: string; length: number; max: number | undefined }) {
  if (max === undefined) return null
  return (
    <p id={countId(id)} className="wrx-tfield__count">
      {length.toLocaleString('en')} of {max.toLocaleString('en')} characters
    </p>
  )
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : ''
}

/** A number or a whole number; RJSF's number field turns the text into a number. */
function UpDownWidget(props: Props) {
  const spec = getInputProps(props.schema, 'number', props.options)
  return (
    <input
      {...common(props)}
      type="number"
      inputMode={props.schema.type === 'integer' ? 'numeric' : 'decimal'}
      className="wrx-tfield__input wrx-tfield__number"
      value={numberText(props.value)}
      step={spec.step}
      min={spec.min}
      max={spec.max}
      placeholder={props.placeholder}
      readOnly={props.readonly}
      aria-describedby={describedBy(props)}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        props.onChange(emptyTo(props, event.target.value))
      }}
    />
  )
}

/** A slider with a number field beside it, both setting the one value. */
function RangeWidget(props: Props) {
  const spec = getInputProps(props.schema, 'range', props.options)
  const min = typeof spec.min === 'number' ? spec.min : 0
  const max = typeof spec.max === 'number' ? spec.max : 100
  const step = spec.step ?? 1
  const set = (event: ChangeEvent<HTMLInputElement>) => {
    props.onChange(emptyTo(props, event.target.value))
  }
  const value = numberText(props.value)
  const base = common(props)
  return (
    <div className="wrx-tfield__range">
      <input
        {...base}
        // ARIA gives a slider no `aria-required`; the number field beside it carries it.
        aria-required={undefined}
        type="range"
        className="wrx-tfield__slider"
        min={min}
        max={max}
        step={step}
        // An empty field shows the slider at its minimum until it is moved.
        value={value === '' ? min : value}
        aria-valuetext={value === '' ? 'not set' : undefined}
        aria-describedby={describedBy(props)}
        onChange={set}
      />
      <input
        {...base}
        id={`${props.id}__number`}
        name={`${base.name}__number`}
        type="number"
        className="wrx-tfield__input wrx-tfield__number"
        aria-label={`${props.label}, exact value`}
        min={min}
        max={max}
        step={step}
        value={value}
        readOnly={props.readonly}
        aria-describedby={describedBy(props)}
        onChange={set}
      />
    </div>
  )
}

/** Yes/no: a checkbox labelled beside it. */
function CheckboxWidget(props: Props) {
  return (
    <div className="wrx-tfield__check">
      <input
        {...common(props)}
        type="checkbox"
        checked={props.value === true}
        aria-describedby={describedBy(props)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          props.onChange(event.target.checked)
        }}
      />
      <label htmlFor={props.id} className="wrx-tfield__label">
        {props.label}
        {props.required === true ? (
          <span className="wrx-tfield__required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
    </div>
  )
}

function enumOptions(props: Props) {
  return props.options.enumOptions ?? []
}

/** A drop-down; for linked drop-downs RJSF narrows `enumOptions` as the other field changes. */
function SelectWidget(props: Props) {
  const options = enumOptions(props)
  const index = enumOptionsIndexForValue(props.value, options, false)
  const selected = typeof index === 'string' ? index : ''
  const showEmpty = props.schema.default === undefined || selected === ''
  return (
    <select
      {...common(props)}
      className="wrx-tfield__input wrx-tfield__select"
      value={selected}
      aria-describedby={describedBy(props)}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
        props.onChange(
          enumOptionsValueForIndex(event.target.value, options, props.options.emptyValue),
        )
      }}
    >
      {showEmpty ? (
        <option value="">{hasText(props.placeholder) ? props.placeholder : 'Choose…'}</option>
      ) : null}
      {options.map((option, i) => (
        <option key={i} value={String(i)}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function RadioWidget(props: Props) {
  const options = enumOptions(props)
  const index = enumOptionsIndexForValue(props.value, options, false)
  const base = common(props)
  return (
    <div
      className="wrx-tfield__radios"
      role="radiogroup"
      id={props.id}
      aria-labelledby={labelId(props.id)}
      aria-describedby={describedBy(props)}
      aria-invalid={base['aria-invalid']}
      aria-required={base['aria-required']}
    >
      {options.map((option, i) => {
        const id = `${props.id}__${String(i)}`
        return (
          <span key={i} className="wrx-tfield__radio">
            <input
              type="radio"
              id={id}
              name={base.name}
              value={String(i)}
              checked={index === String(i)}
              disabled={base.disabled}
              onChange={() => {
                props.onChange(enumOptionsValueForIndex(String(i), options))
              }}
            />
            <label htmlFor={id}>{option.label}</label>
          </span>
        )
      })}
    </div>
  )
}

/** A calendar day: the browser shows it in the local format; the value is ISO `YYYY-MM-DD`. */
function DateWidget(props: Props) {
  return (
    <input
      {...common(props)}
      type="date"
      className="wrx-tfield__input wrx-tfield__date"
      value={typeof props.value === 'string' ? props.value : ''}
      readOnly={props.readonly}
      aria-describedby={describedBy(props)}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        props.onChange(emptyTo(props, event.target.value))
      }}
    />
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

/** An ISO instant as a `datetime-local` value in local wall-clock time (PLY-45). */
export function isoToLocalInput(iso: unknown): string {
  if (typeof iso !== 'string' || iso === '') return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** A `datetime-local` value, read as local time, as an ISO instant in UTC; `undefined` if empty. */
export function localInputToIso(local: string): string | undefined {
  if (local === '') return undefined
  const at = new Date(local)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

/** A date and time: chosen and shown in local time; the value is an ISO instant in UTC. */
function DateTimeWidget(props: Props) {
  return (
    <input
      {...common(props)}
      type="datetime-local"
      className="wrx-tfield__input wrx-tfield__date"
      value={isoToLocalInput(props.value)}
      readOnly={props.readonly}
      aria-describedby={describedBy(props)}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        props.onChange(localInputToIso(event.target.value) ?? props.options.emptyValue)
      }}
    />
  )
}

/** A force or role picker: GUIDs as values, current names as labels (TPL-8). */
function PickerWidget(props: Props) {
  const schema = props.schema as Record<string, unknown>
  const picker = schema['x-wrx-picker'] === 'role' ? 'role' : 'force'
  const forceFilter = typeof schema['x-wrx-force'] === 'string' ? schema['x-wrx-force'] : undefined
  const scope = schema['x-wrx-scope'] === 'room' ? 'room' : 'game'
  const options = pickerOptions(
    { picker, scope, forceFilter },
    props.registry.formContext.pickers,
    props.value,
  )
  const value = typeof props.value === 'string' ? props.value : ''
  return (
    <select
      {...common(props)}
      className="wrx-tfield__input wrx-tfield__select"
      value={value}
      data-picker={picker}
      aria-describedby={describedBy(props)}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
        props.onChange(emptyTo(props, event.target.value))
      }}
    >
      <option value="">
        {hasText(props.placeholder) ? props.placeholder : `Choose a ${picker}…`}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export const templateWidgets: Readonly<RegistryWidgetsType> = Object.freeze({
  TextWidget,
  TextareaWidget,
  UpDownWidget,
  RangeWidget,
  CheckboxWidget,
  SelectWidget,
  RadioWidget,
  DateWidget,
  DateTimeWidget,
  [PICKER_WIDGET]: PickerWidget,
})
