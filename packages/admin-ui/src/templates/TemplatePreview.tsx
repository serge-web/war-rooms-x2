// The template's live preview (WP 4.3, TPL-7): the form a player fills, rendered by RJSF and
// checked as the player's composer and every receiver check it, with `createTemplateFormValidator`
// (`@wrx/templates/rjsf`) over the interpreting validator. Never `@rjsf/validator-ajv8`: it
// compiles schemas with `new Function`, which the client's CSP refuses (no 'unsafe-eval', F7).
//
// RJSF's own core theme for now. WP 4.2's theme on Radix and the `--wrx-*` tokens replaces it
// through the `TemplatePreviewSlot` the Templates section takes; WP 4.4 wires that in.
import Form from '@rjsf/core/lib/components/Form.js'
import type { IChangeEvent } from '@rjsf/core/lib/components/Form.js'
import type { RJSFSchema, UiSchema, WidgetProps } from '@rjsf/utils'
import { checkTemplateProfile, templateFields } from '@wrx/schemas'
import type { DesignFile, Template, TemplateValue } from '@wrx/schemas'
import { createTemplateFormValidator } from '@wrx/templates/rjsf'
import type { FormValues } from '@wrx/templates'
import { byOrderThenId } from '@wrx/domain'
import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'

export interface TemplatePreviewProps {
  readonly template: Pick<Template, 'id' | 'name' | 'schema' | 'uiSchema'>
  /** The forces and roles the pickers offer. */
  readonly design: Pick<DesignFile, 'forces' | 'roles'>
}

/** The preview the Templates section draws; WP 4.2's themed form can take its place. */
export type TemplatePreviewSlot = ComponentType<TemplatePreviewProps>

interface PickerContext {
  readonly design: Pick<DesignFile, 'forces' | 'roles'>
}

/** A force or role picker: a list of names, storing the GUID (TPL-8). */
function PickerWidget({
  id,
  value,
  required,
  disabled,
  readonly,
  onChange,
  onBlur,
  onFocus,
  schema,
  registry,
}: WidgetProps<FormValues, RJSFSchema, PickerContext>) {
  const design = registry.formContext.design
  const kind = (schema as Record<string, unknown>)['x-wrx-picker']
  const filter = (schema as Record<string, unknown>)['x-wrx-force']
  const forces = [...design.forces].sort(byOrderThenId)
  const forceIndex = new Map(forces.map((f, i) => [f.id, i]))
  const choices =
    kind === 'role'
      ? [...design.roles]
          .filter((r) => filter === undefined || r.forceId === filter)
          .sort(
            (a, b) =>
              (forceIndex.get(a.forceId) ?? forces.length) -
                (forceIndex.get(b.forceId) ?? forces.length) || byOrderThenId(a, b),
          )
          .map((r) => ({ id: r.id, name: r.name }))
      : forces.map((f) => ({ id: f.id, name: f.name }))
  return (
    <select
      id={id}
      className="form-control"
      value={typeof value === 'string' ? value : ''}
      required={required}
      disabled={disabled === true || readonly === true}
      onChange={(e) => {
        onChange(e.target.value === '' ? undefined : e.target.value)
      }}
      onBlur={(e) => {
        onBlur(id, e.target.value)
      }}
      onFocus={(e) => {
        onFocus(id, e.target.value)
      }}
    >
      <option value="">Choose…</option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

const WIDGETS = Object.freeze({ wrxPicker: PickerWidget })

/** The template's UI schema for the preview: pickers drawn by `PickerWidget`, no submit button. */
function previewUiSchema(
  template: TemplatePreviewProps['template'],
): UiSchema<FormValues, RJSFSchema, PickerContext> {
  const ui: Record<string, unknown> = { ...(template.uiSchema ?? {}) }
  for (const field of templateFields(template.schema)) {
    if (field.picker === undefined) continue
    const own = ui[field.name]
    ui[field.name] = {
      ...(typeof own === 'object' && own !== null ? own : {}),
      'ui:widget': 'wrxPicker',
    }
  }
  ui['ui:submitButtonOptions'] = { norender: true }
  return ui as UiSchema<FormValues, RJSFSchema, PickerContext>
}

export function TemplatePreview({ template, design }: TemplatePreviewProps) {
  const validator = useMemo(() => createTemplateFormValidator<PickerContext>(), [])
  const [values, setValues] = useState<FormValues>({})
  const issues = useMemo(
    () => checkTemplateProfile(template.schema, template.uiSchema),
    [template.schema, template.uiSchema],
  )
  const uiSchema = useMemo(() => previewUiSchema(template), [template])
  const context = useMemo(() => ({ design }), [design])
  if (issues.length > 0) {
    return (
      <p className="wrx-admin-muted">
        The preview shows once the template is inside the WRX template profile: fix the problems
        listed.
      </p>
    )
  }
  return (
    <div className="wrx-template-preview">
      <Form<FormValues, RJSFSchema, PickerContext>
        key={template.id}
        tagName="div"
        idPrefix={`wrx-preview-${template.id}`}
        schema={template.schema}
        uiSchema={uiSchema}
        formData={values}
        formContext={context}
        validator={validator}
        widgets={WIDGETS}
        liveValidate="onChange"
        showErrorList={false}
        noHtml5Validate
        onChange={(event: IChangeEvent<FormValues>) => {
          const next: Record<string, TemplateValue | undefined> = { ...(event.formData ?? {}) }
          setValues(next)
        }}
      />
    </div>
  )
}
