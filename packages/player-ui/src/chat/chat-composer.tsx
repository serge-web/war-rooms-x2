// The composer with templates (Annex A, TD3, TPL-3; WP 4.2). When the room offers this role
// templates, a "Message type" drop-down picks free text (if the room allows it) or a template;
// a template shows its form, validated inline before sending with the receiver's own validator
// (TPL-6), and checked against the stanza cap (PLY-53). With free text off and no template for
// the role, the composer says so and cannot send. Text and form values not yet sent are kept
// while switching between types, and a refused post keeps them, as text is kept (PLY-33).
import type { Template, TemplateValue } from '@wrx/schemas'
import { templateFields } from '@wrx/schemas'
import type { FormValues } from '@wrx/templates'
import { Button, Spinner } from '@wrx/ui'
import { Suspense, useId, useMemo, useState } from 'react'
import { LazyTemplateForm } from '../templates/lazy.tsx'
import { NO_PICKER_SOURCE } from '../templates/pickers.ts'
import type { PickerSource } from '../templates/pickers.ts'
import { ComposerCore, useReportDraft, worseDraft } from './composer.tsx'
import type { ComposerCoreProps, DraftState } from './composer.tsx'
import { sizeNote, templateMessageSize } from './format.ts'

export type TemplateSendOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: string
      /** Each field's problem, when the values were the reason (the receiver's check). */
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>> | undefined
    }

/** A templated message the server or the store refused, with why (PLY-33). */
export interface UnsentTemplate {
  readonly templateId: string
  readonly values: Readonly<Record<string, TemplateValue>>
  readonly reason: string
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>> | undefined
}

export interface ChatComposerCoreProps extends ComposerCoreProps {
  /** The templates this role may use here, in the room config's order (TD4). */
  readonly templates?: readonly Template[]
  /** Free text is allowed here (TD3). Default true. */
  readonly freeText?: boolean
  /** Sends a templated message; resolves when the server has accepted or refused it. */
  readonly onSendTemplate?: (templateId: string, values: FormValues) => Promise<TemplateSendOutcome>
  /** Live forces and roles for the pickers (TPL-8). */
  readonly pickers?: PickerSource
  readonly unsentTemplate?: UnsentTemplate | undefined
}

/** Why a templates-only room's composer cannot send for a role it offers nothing. */
export const NO_TEMPLATES_REASON =
  'This room takes templated messages only, and none is offered to your role.'

const FREE_TEXT = ''

/**
 * A new form's values: every yes/no field holds its default, or no, since an unticked box reads
 * as "no" and should send as no, not as a field left out.
 */
export function initialValues(template: Template): FormValues {
  const values: Record<string, TemplateValue> = {}
  const properties = template.schema.properties as Record<string, { default?: unknown }> | undefined
  for (const field of templateFields(template.schema)) {
    if (field.type !== 'boolean') continue
    const fallback = properties?.[field.name]?.default
    values[field.name] = typeof fallback === 'boolean' ? fallback : false
  }
  return values
}

/** Whether a form holds anything the player entered: a value other than its starting one. */
export function hasEnteredValues(template: Template, values: FormValues): boolean {
  const start = initialValues(template)
  return Object.entries(values).some(
    ([name, value]) =>
      value !== undefined &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0) &&
      JSON.stringify(value) !== JSON.stringify(start[name]),
  )
}

/** The values as a message holds them: empty fields left out. */
export function sendableValues(values: FormValues): Record<string, TemplateValue> {
  const out: Record<string, TemplateValue> = {}
  for (const [name, value] of Object.entries(values)) if (value !== undefined) out[name] = value
  return out
}

export function ChatComposerCore(props: ChatComposerCoreProps) {
  const {
    templates = [],
    freeText = true,
    onSendTemplate,
    pickers = NO_PICKER_SOURCE,
    unsentTemplate,
    disabledReason,
    onDraftChange,
    ...textProps
  } = props
  const offered = templates.length > 0 && onSendTemplate !== undefined
  const unsentOffered =
    unsentTemplate !== undefined && templates.some((t) => t.id === unsentTemplate.templateId)
  const [mode, setMode] = useState<string>(() =>
    unsentOffered ? unsentTemplate.templateId : freeText ? FREE_TEXT : (templates[0]?.id ?? ''),
  )
  const [text, setText] = useState(textProps.initialText ?? '')
  const [drafts, setDrafts] = useState<ReadonlyMap<string, FormValues>>(() =>
    unsentOffered ? new Map([[unsentTemplate.templateId, unsentTemplate.values]]) : new Map(),
  )
  const selectId = useId()
  // PLY-54: what the mounted composer reports (it alone knows of a refusal), with the drafts of
  // the types not on screen.
  const [shown, setShown] = useState<{ readonly id: string; readonly state: DraftState }>({
    id: FREE_TEXT,
    state: 'none',
  })

  // The chosen type, or the first one offered if it has gone (the room's config changed).
  const template = templates.find((t) => t.id === mode)
  const current = template?.id ?? (freeText ? FREE_TEXT : (templates[0]?.id ?? FREE_TEXT))
  const chosen = templates.find((t) => t.id === current)
  const chosenId = chosen?.id ?? FREE_TEXT

  let draft: DraftState = shown.id === chosenId ? shown.state : 'none'
  if (chosen !== undefined && text.trim() !== '') draft = worseDraft(draft, 'draft')
  for (const t of templates) {
    if (t.id === chosen?.id) continue
    const values = drafts.get(t.id)
    if (values !== undefined && hasEnteredValues(t, values)) draft = worseDraft(draft, 'draft')
  }
  useReportDraft(offered ? draft : 'none', offered ? onDraftChange : undefined)

  if (!offered) {
    return (
      <ComposerCore
        {...textProps}
        disabledReason={disabledReason ?? (freeText ? undefined : NO_TEMPLATES_REASON)}
        onDraftChange={onDraftChange}
      />
    )
  }

  return (
    <div className="wrx-composer wrx-composer--templates">
      <div className="wrx-composer__type">
        <label className="wrx-composer__type-label" htmlFor={selectId}>
          Message type
        </label>
        <select
          id={selectId}
          className="wrx-tfield__input wrx-tfield__select wrx-composer__type-select"
          value={current}
          onChange={(event) => {
            setMode(event.target.value)
          }}
        >
          {freeText ? <option value={FREE_TEXT}>Free text</option> : null}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {chosen === undefined ? (
        <ComposerCore
          {...textProps}
          initialText={text}
          disabledReason={disabledReason}
          onTextChange={setText}
          embedded
          onDraftChange={(state) => {
            setShown({ id: FREE_TEXT, state })
          }}
        />
      ) : (
        <TemplateComposer
          key={chosen.id}
          template={chosen}
          values={drafts.get(chosen.id) ?? initialValues(chosen)}
          setValues={(values) => {
            setDrafts((map) => new Map(map).set(chosen.id, values))
          }}
          onSend={onSendTemplate}
          pickers={pickers}
          disabledReason={disabledReason}
          unsent={unsentTemplate?.templateId === chosen.id ? unsentTemplate : undefined}
          onDraftChange={(state) => {
            setShown({ id: chosen.id, state })
          }}
        />
      )}
    </div>
  )
}

function TemplateComposer({
  template,
  values,
  setValues,
  onSend,
  pickers,
  disabledReason,
  unsent,
  onDraftChange,
}: {
  readonly template: Template
  readonly values: FormValues
  readonly setValues: (values: FormValues) => void
  readonly onSend: (templateId: string, values: FormValues) => Promise<TemplateSendOutcome>
  readonly pickers: PickerSource
  readonly disabledReason: string | undefined
  readonly unsent: UnsentTemplate | undefined
  readonly onDraftChange: (state: DraftState) => void
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | undefined>(unsent?.reason)
  const [fieldErrors, setFieldErrors] = useState(unsent?.fieldErrors)
  const [problems, setProblems] = useState<number | undefined>(undefined)
  // Unique per form on the page: several panels and panes may show the same template.
  const idPrefix = `t${useId().replace(/[^A-Za-z0-9]/g, '')}`
  const reasonId = useId()
  const noteId = useId()
  const sendable = useMemo(() => sendableValues(values), [values])
  const size = useMemo(() => templateMessageSize(template.id, sendable), [template.id, sendable])
  const note = sizeNote(size)
  const disabled = disabledReason !== undefined
  const canSend = !disabled && !sending && size.over === undefined
  useReportDraft(
    error !== undefined ? 'unsent' : hasEnteredValues(template, values) ? 'draft' : 'none',
    onDraftChange,
  )

  const submit = async (submitted: FormValues) => {
    if (!canSend) return
    setProblems(undefined)
    setSending(true)
    const outcome = await onSend(template.id, sendableValues(submitted))
    setSending(false)
    if (outcome.ok) {
      setValues(initialValues(template))
      setError(undefined)
      setFieldErrors(undefined)
    } else {
      // PLY-33: the values stay, so the form can be sent again.
      setError(outcome.reason)
      setFieldErrors(outcome.fieldErrors)
    }
  }

  return (
    <div className="wrx-composer__template" data-template={template.id}>
      {template.description === undefined || template.description === '' ? null : (
        <p className="wrx-composer__description">{template.description}</p>
      )}
      {disabled ? (
        <p id={reasonId} className="wrx-composer__reason">
          {disabledReason}
        </p>
      ) : null}
      {error === undefined ? null : (
        <p className="wrx-composer__error" role="alert">
          Not sent: {error} Your values are kept below.
        </p>
      )}
      {problems === undefined ? null : (
        <p className="wrx-composer__error" role="alert">
          Not sent: {problems === 1 ? 'one field needs' : `${String(problems)} fields need`}{' '}
          attention.
        </p>
      )}
      <div className="wrx-composer__form">
        <Suspense fallback={<Spinner label="Loading the form" />}>
          <LazyTemplateForm
            template={template}
            values={values}
            onChange={(next) => {
              setValues(next)
              if (fieldErrors !== undefined) setFieldErrors(undefined)
            }}
            onSubmit={(submitted) => {
              void submit(submitted)
            }}
            onInvalid={setProblems}
            pickers={pickers}
            disabled={disabled}
            extraErrors={fieldErrors}
            idPrefix={idPrefix}
          >
            <div className="wrx-composer__actions">
              {note === undefined ? null : (
                <p
                  id={noteId}
                  className={
                    size.over === undefined
                      ? 'wrx-composer__note'
                      : 'wrx-composer__note wrx-composer__error'
                  }
                >
                  {note}
                </p>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={disabled || sending}
                onClick={() => {
                  setValues(initialValues(template))
                  setError(undefined)
                  setFieldErrors(undefined)
                  setProblems(undefined)
                }}
              >
                Clear
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!canSend}
                busy={sending}
                aria-describedby={
                  [disabled ? reasonId : '', note === undefined ? '' : noteId]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              >
                Send
              </Button>
            </div>
          </LazyTemplateForm>
        </Suspense>
      </div>
    </div>
  )
}
