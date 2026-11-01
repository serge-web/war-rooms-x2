// The template's live preview (WP 4.3, TPL-7; themed in WP 4.4): the very form a player fills,
// WP 4.2's `TemplateForm` from `@wrx/player-ui/templates`, with its theme on the `--wrx-*` tokens,
// its widgets and the validator every receiver uses (`@wrx/templates/rjsf`, which interprets
// schemas, so it runs under the client's CSP; never `@rjsf/validator-ajv8`, F7). It starts as the
// composer starts (`initialValues`: yes/no fields at their default or no; a drop-down with nothing
// chosen, as RJSF takes no `const` as a default), and shows problems as the composer does: once a
// send is tried, then live. "Check" stands in for Send; nothing is sent.
//
// Pickers offer the draft's forces and roles. The draft has no deleted entities to show
// (`retired` is the server's), and no room: a room-scoped picker offers the whole game.
import type { DesignFile, Template } from '@wrx/schemas'
import { checkTemplateProfile, templateFields } from '@wrx/schemas'
import { initialValues } from '@wrx/player-ui/chat'
import { TemplateForm } from '@wrx/player-ui/templates'
import type { PickerSource } from '@wrx/player-ui/templates'
import type { FormValues } from '@wrx/templates'
import { useId, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { Button } from '../components/index.ts'

export interface TemplatePreviewProps {
  readonly template: Template
  /** The forces and roles the pickers offer. */
  readonly design: Pick<DesignFile, 'forces' | 'roles'>
}

/** The preview the Templates section draws; a host may give another (`AdminApp`'s slot). */
export type TemplatePreviewSlot = ComponentType<TemplatePreviewProps>

type Outcome = { readonly kind: 'fits' } | { readonly kind: 'problems'; readonly count: number }

export function TemplatePreview({ template, design }: TemplatePreviewProps) {
  const issues = useMemo(
    () => checkTemplateProfile(template.schema, template.uiSchema),
    [template.schema, template.uiSchema],
  )
  if (issues.length > 0) {
    return (
      <p className="wrx-admin-muted">
        The preview shows once the template is inside the WRX template profile: fix the problems
        listed.
      </p>
    )
  }
  // Another template is another form; edits to this one keep the values typed so far.
  return <PreviewForm key={template.id} template={template} design={design} />
}

function PreviewForm({ template, design }: TemplatePreviewProps) {
  const [values, setValues] = useState<FormValues>(() => initialValues(template))
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined)
  // Only the fields the schema has now: a field removed in the editor takes its value with it.
  const shown = useMemo(() => {
    const names = new Set(templateFields(template.schema).map((f) => f.name))
    return Object.fromEntries(Object.entries(values).filter(([name]) => names.has(name)))
  }, [template.schema, values])
  const pickers = useMemo<PickerSource>(
    () => ({ forces: design.forces, roles: design.roles, retired: [] }),
    [design.forces, design.roles],
  )
  // Unique on the page: the ids of the composer's forms are prefixed differently.
  const idPrefix = `wrx-preview-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const statusId = `${idPrefix}-status`
  return (
    <div className="wrx-template-preview">
      <TemplateForm
        template={template}
        values={shown}
        onChange={(next) => {
          setValues(next)
          setOutcome(undefined)
        }}
        onSubmit={() => {
          setOutcome({ kind: 'fits' })
        }}
        onInvalid={(count) => {
          setOutcome({ kind: 'problems', count })
        }}
        pickers={pickers}
        idPrefix={idPrefix}
      >
        <div className="wrx-template-preview__actions">
          <Button type="submit" variant="secondary" aria-describedby={statusId}>
            Check
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setValues(initialValues(template))
              setOutcome(undefined)
            }}
          >
            Clear
          </Button>
          <p id={statusId} className="wrx-template-preview__status" role="status">
            {outcome === undefined
              ? ''
              : outcome.kind === 'fits'
                ? 'These values fit the template: a player could send them.'
                : outcome.count === 1
                  ? 'One field needs attention.'
                  : `${String(outcome.count)} fields need attention.`}
          </p>
        </div>
      </TemplateForm>
    </div>
  )
}
