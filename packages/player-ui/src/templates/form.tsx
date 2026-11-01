// The form of one message template (TPL-3, WP 4.2): RJSF's `Form` with our theme (theme.tsx) and
// the validator every receiver uses (`@wrx/templates/rjsf`, which interprets schemas, so it runs
// under the client's CSP with no 'unsafe-eval'; never `@rjsf/validator-ajv8`). The composer and,
// later, the admin's live preview (WP 4.3) render it. Loaded lazily (`lazy.tsx`), so RJSF is
// only fetched once a room offers a template.
// Not the package root: it imports `@rjsf/validator-ajv8` (for its test registry), which needs
// 'unsafe-eval' and is not installed. The lint rules refuse both (eslint.config.js).
import Form from '@rjsf/core/lib/components/Form.js'
import type { IChangeEvent } from '@rjsf/core/lib/components/Form.js'
import type {
  ErrorSchema,
  Experimental_DefaultFormStateBehavior,
  RJSFSchema,
  RJSFValidationError,
  UiSchema,
} from '@rjsf/utils'
import { templateFields } from '@wrx/schemas'
import type { Template } from '@wrx/schemas'
import { createTemplateFormValidator } from '@wrx/templates/rjsf'
import type { FormValues } from '@wrx/templates'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { orderedFieldNames } from './card.ts'
import { PICKER_WIDGET, templateTheme, templateWidgets } from './theme.tsx'
import type { TemplateFormContext } from './theme.tsx'
import type { PickerSource } from './pickers.ts'

type Values = FormValues

export interface TemplateFormProps {
  readonly template: Template
  readonly values: FormValues
  readonly onChange: (values: FormValues) => void
  /** Called with the values once they pass the template's schema. */
  readonly onSubmit: (values: FormValues) => void
  /** Called when a send was refused by the schema: how many problems, to announce. */
  readonly onInvalid?: (problems: number) => void
  readonly pickers: PickerSource
  readonly disabled?: boolean
  /** Problems found outside the form, e.g. the store's refusal, by field name. */
  readonly extraErrors?: Readonly<Record<string, readonly string[]>> | undefined
  /** Prefix for the fields' ids; unique per form on the page (several panes, several panels). */
  readonly idPrefix: string
  /** The buttons, inside the form; a submit button sends. */
  readonly children?: ReactNode
}

const validator = createTemplateFormValidator<TemplateFormContext>()

/**
 * Defaults come from `default` only: RJSF would otherwise take a drop-down's first `oneOf`
 * `const` as its value, so a field the user never touched would be sent as its first option.
 */
const DEFAULTS: Experimental_DefaultFormStateBehavior = Object.freeze({ constAsDefaults: 'never' })

/**
 * The UI schema RJSF is given: the template's own (profile-checked), with every field kept in
 * the order (`*` added where the order leaves fields out, which RJSF would refuse) and the force
 * and role pickers given the picker widget.
 */
export function formUiSchema(template: Template): UiSchema {
  const ui: Record<string, unknown> = { ...(template.uiSchema ?? {}) }
  ui['ui:order'] = orderedFieldNames(template)
  for (const field of templateFields(template.schema)) {
    if (field.picker === undefined) continue
    const own = ui[field.name]
    ui[field.name] = {
      ...(typeof own === 'object' && own !== null ? own : {}),
      'ui:widget': PICKER_WIDGET,
    }
  }
  ui['ui:submitButtonOptions'] = { norender: true }
  return ui as UiSchema
}

function toErrorSchema(
  errors: Readonly<Record<string, readonly string[]>> | undefined,
): ErrorSchema<Values> | undefined {
  if (errors === undefined) return undefined
  const schema: Record<string, { __errors: string[] }> = {}
  for (const [name, list] of Object.entries(errors)) {
    if (list.length > 0) schema[name] = { __errors: [...list] }
  }
  return Object.keys(schema).length === 0 ? undefined : (schema as ErrorSchema<Values>)
}

export function TemplateForm({
  template,
  values,
  onChange,
  onSubmit,
  onInvalid,
  pickers,
  disabled = false,
  extraErrors,
  idPrefix,
  children,
}: TemplateFormProps) {
  const uiSchema = useMemo(() => formUiSchema(template), [template])
  const context = useMemo<TemplateFormContext>(
    () => ({ templateName: template.name, pickers }),
    [template.name, pickers],
  )
  // Errors show once a send is tried, then follow each change until the form is sent.
  const [live, setLive] = useState(false)
  const extra = useMemo(() => toErrorSchema(extraErrors), [extraErrors])
  return (
    <Form<Values, RJSFSchema, TemplateFormContext>
      // A new template is a new form: no state carries over.
      key={template.id}
      className="wrx-tform"
      schema={template.schema}
      uiSchema={uiSchema as UiSchema<Values, RJSFSchema, TemplateFormContext>}
      formData={values}
      formContext={context}
      validator={validator}
      templates={templateTheme}
      widgets={templateWidgets}
      idPrefix={idPrefix}
      disabled={disabled}
      noHtml5Validate
      experimental_defaultFormStateBehavior={DEFAULTS}
      showErrorList={false}
      liveValidate={live ? 'onChange' : undefined}
      focusOnFirstError
      extraErrors={extra}
      onChange={(event: IChangeEvent<Values, RJSFSchema, TemplateFormContext>) => {
        onChange(event.formData ?? {})
      }}
      onError={(errors: RJSFValidationError[]) => {
        setLive(true)
        onInvalid?.(errors.length)
      }}
      onSubmit={(event: IChangeEvent<Values, RJSFSchema, TemplateFormContext>) => {
        setLive(false)
        onSubmit(event.formData ?? {})
      }}
    >
      {children}
    </Form>
  )
}

export default TemplateForm
