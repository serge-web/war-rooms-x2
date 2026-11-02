// Message templates (WP 4.3, Annex A, TD2, TD5, TD6, TPL-4, TPL-7): the list, add, rename, copy
// and delete (refused while a room offers the template), and the editor: the builder and the raw
// JSON Schema editor on the same template, with a live preview. A locked template (a published
// room has offered it) is read only, with "Copy to new template".
import * as Tabs from '@radix-ui/react-tabs'
import { LIMITS, checkTemplateProfile } from '@wrx/schemas'
import type { Template } from '@wrx/schemas'
import { useId, useMemo, useState } from 'react'
import {
  AddForm,
  Button,
  ConfirmDialog,
  IssueList,
  ListAndForm,
  Notice,
  SectionFrame,
  TextField,
} from '../components/index.ts'
import {
  addTemplate,
  copyTemplate,
  deleteTemplate,
  isTemplateLocked,
  roomsUsingTemplate,
  updateTemplate,
} from '../draft/index.ts'
import { IdLine } from '../sections/common.tsx'
import type { SectionProps } from '../sections/common.tsx'
import { readTemplate, writeTemplate } from './builder.ts'
import type { BuilderModel } from './builder.ts'
import { parseRaw, rawIssues, rawText } from './raw.ts'
import { RawEditor } from './RawEditor.tsx'
import { TemplateBuilder } from './TemplateBuilder.tsx'
import { TemplatePreview } from './TemplatePreview.tsx'
import type { TemplatePreviewSlot } from './TemplatePreview.tsx'
import './templates.css'

export interface TemplatesSectionProps extends SectionProps {
  /** The clock for `createdAt` (display only). */
  readonly now?: () => Date
  /** The preview; by default the player's own form (`TemplatePreview`). */
  readonly preview?: TemplatePreviewSlot
}

export function TemplatesSectionCore({
  draft,
  validation,
  onChange,
  now = () => new Date(),
  preview = TemplatePreview,
}: TemplatesSectionProps) {
  const templates = draft.design.templates
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const selected = templates.find((t) => t.id === chosen) ?? templates[0]
  return (
    <SectionFrame
      title="Templates"
      intro={
        <p className="wrx-admin-hint">
          Forms players can send in a room instead of, or beside, free text. Choose in each room
          which forces and roles may use which templates. Every role can read every template, so a
          template&rsquo;s name and fields should not give away one force&rsquo;s plans. Once a
          published room offers a template, its fields are fixed: copy it to change them.
        </p>
      }
    >
      <IssueList issues={validation.issues.filter((i) => i.path === 'templates')} />
      <ListAndForm
        listLabel="Template list"
        list={
          <>
            {templates.length === 0 ? (
              <p className="wrx-admin-muted">No templates yet.</p>
            ) : (
              <ul className="wrx-admin-list" aria-label="Templates">
                {templates.map((t) => {
                  const current = t.id === selected?.id
                  const errors = validation
                    .at(`templates[${templates.indexOf(t)}]`)
                    .filter((i) => i.severity === 'error').length
                  return (
                    <li key={t.id} className={`wrx-admin-list-row${current ? ' is-selected' : ''}`}>
                      <button
                        type="button"
                        className="wrx-admin-list-name"
                        aria-current={current ? 'true' : undefined}
                        onClick={() => {
                          setChosen(t.id)
                        }}
                      >
                        <span className="wrx-admin-list-label">
                          {t.name.trim() === '' ? '(unnamed)' : t.name}
                        </span>
                        {isTemplateLocked(t) && <span className="wrx-admin-tag">Locked</span>}
                        {errors > 0 && (
                          <span className="wrx-admin-badge wrx-admin-badge-error">
                            {errors}
                            <span className="wrx-admin-visually-hidden">
                              {' '}
                              {errors === 1 ? 'error' : 'errors'}
                            </span>
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <AddForm
              label="New template name"
              buttonLabel="Add template"
              onAdd={(name) => {
                const added = addTemplate(draft, name, now())
                onChange(added.draft)
                setChosen(added.id)
              }}
            />
          </>
        }
        form={
          selected === undefined ? (
            <p className="wrx-admin-muted">Add a template to edit it.</p>
          ) : (
            <TemplateForm
              key={selected.id}
              template={selected}
              preview={preview}
              onCopied={setChosen}
              {...{ draft, validation, onChange, now }}
            />
          )
        }
      />
    </SectionFrame>
  )
}

type Mode = 'builder' | 'raw'

function TemplateForm({
  template,
  draft,
  validation,
  onChange,
  now,
  preview: Preview,
  onCopied,
}: SectionProps & {
  readonly template: Template
  readonly now: () => Date
  readonly preview: TemplatePreviewSlot
  readonly onCopied: (id: string) => void
}) {
  const headingId = useId()
  const design = draft.design
  const at = `templates[${design.templates.findIndex((t) => t.id === template.id)}]`
  const locked = isTemplateLocked(template)
  const rooms = roomsUsingTemplate(design, template.id)
  const [mode, setMode] = useState<Mode>(() =>
    readTemplate(template.schema, template.uiSchema).ok ? 'builder' : 'raw',
  )
  const name = template.name.trim() === '' ? '(unnamed)' : template.name
  const copy = () => {
    const added = copyTemplate(draft, template.id, now())
    onChange(added.draft)
    onCopied(added.id)
  }
  const blocked = deleteTemplate(draft, template.id)
  const ownIssues = validation
    .at(at)
    .filter((i) => !i.path.startsWith(`${at}.schema`) && !i.path.startsWith(`${at}.uiSchema`))

  return (
    <section className="wrx-admin-form wrx-template-form" aria-labelledby={headingId}>
      <h3 id={headingId}>Template: {name}</h3>
      <IdLine id={template.id} />
      {locked && (
        <Notice tone="info" title="Locked.">
          A published room has offered this template, so messages may use it: its fields, labels and
          name are fixed, so past messages read as they did (TPL-4). You can still change its
          description. To change the rest, copy it to a new template and offer the copy instead.{' '}
          <Button variant="primary" onClick={copy}>
            Copy to new template
          </Button>
        </Notice>
      )}
      <TextField
        label="Name"
        value={template.name}
        maxLength={LIMITS.nameChars}
        hint="Shown in the composer’s drop-down and on each message card."
        readOnly={locked}
        issues={validation.at(`${at}.name`)}
        onChange={(next) => {
          onChange(updateTemplate(draft, template.id, { name: next }))
        }}
      />
      <TextField
        label="Description"
        multiline
        value={template.description ?? ''}
        maxLength={LIMITS.descriptionChars}
        issues={validation.at(`${at}.description`)}
        onChange={(description) => {
          onChange(updateTemplate(draft, template.id, { description }))
        }}
      />
      <IssueList
        issues={ownIssues.filter(
          (i) => !i.path.startsWith(`${at}.name`) && !i.path.startsWith(`${at}.description`),
        )}
      />
      <p className="wrx-admin-hint">
        {rooms.length === 0
          ? 'No room offers this template yet: choose who may use it in a room’s settings.'
          : `Offered in ${rooms.map((r) => r.name).join(', ')}.`}
      </p>

      <Tabs.Root
        value={mode}
        onValueChange={(v) => {
          setMode(v === 'raw' ? 'raw' : 'builder')
        }}
      >
        <Tabs.List className="wrx-admin-tabs" aria-label="Edit the template's fields">
          <Tabs.Trigger className="wrx-admin-tab" value="builder">
            Builder
          </Tabs.Trigger>
          <Tabs.Trigger className="wrx-admin-tab" value="raw">
            Raw JSON Schema
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="builder" className="wrx-admin-tab-panel">
          <BuilderPane
            template={template}
            locked={locked}
            design={design}
            onRaw={() => {
              setMode('raw')
            }}
            onSchemas={(schema, uiSchema) => {
              onChange(updateTemplate(draft, template.id, { schema, uiSchema: uiSchema ?? null }))
            }}
          />
        </Tabs.Content>
        <Tabs.Content value="raw" className="wrx-admin-tab-panel">
          <RawPane
            template={template}
            locked={locked}
            onSchemas={(schema, uiSchema) => {
              onChange(updateTemplate(draft, template.id, { schema, uiSchema: uiSchema ?? null }))
            }}
          />
        </Tabs.Content>
      </Tabs.Root>

      <section className="wrx-template-preview-frame" aria-label={`Preview of ${name}`}>
        <h4>Preview</h4>
        <p className="wrx-admin-hint">
          The form as a player fills it, checked as every receiver checks a message.
        </p>
        <Preview template={template} design={design} />
      </section>

      <div className="wrx-admin-form-actions">
        <Button onClick={copy}>Copy to new template</Button>
        <ConfirmDialog
          triggerLabel={`Delete ${name}`}
          title={`Delete ${name}?`}
          confirmLabel="Delete template"
          canConfirm={blocked.ok}
          onConfirm={() => {
            if (blocked.ok) onChange(blocked.value)
          }}
        >
          {blocked.ok ? (
            <p>
              {locked
                ? 'It is locked: if it has been published, the next publish removes it, and messages that used it then show as plain text.'
                : 'If it has been published, the next publish removes it.'}
            </p>
          ) : (
            <p>It cannot be deleted: {blocked.error}.</p>
          )}
        </ConfirmDialog>
      </div>
    </section>
  )
}

function BuilderPane({
  template,
  locked,
  design,
  onRaw,
  onSchemas,
}: {
  readonly template: Template
  readonly locked: boolean
  readonly design: SectionProps['draft']['design']
  readonly onRaw: () => void
  readonly onSchemas: (
    schema: Record<string, unknown>,
    uiSchema: Record<string, unknown> | undefined,
  ) => void
}) {
  // Read once as the tab opens: the raw editor's changes are read when the builder opens again.
  const [read] = useState(() => readTemplate(template.schema, template.uiSchema))
  const [model, setModel] = useState<BuilderModel | undefined>(read.ok ? read.model : undefined)
  const issues = useMemo(
    () => checkTemplateProfile(template.schema, template.uiSchema),
    [template.schema, template.uiSchema],
  )
  if (model === undefined) {
    return (
      <Notice tone="warning" title="This template opens in the raw editor only.">
        The builder cannot show it: {read.ok ? 'unreadable' : read.reason}. Edit it as JSON Schema.{' '}
        <Button onClick={onRaw}>Open the raw editor</Button>
      </Notice>
    )
  }
  return (
    <TemplateBuilder
      model={model}
      readOnly={locked}
      issues={issues}
      design={design}
      onChange={(next) => {
        setModel(next)
        const written = writeTemplate(next)
        onSchemas(written.schema, written.uiSchema)
      }}
    />
  )
}

function RawPane({
  template,
  locked,
  onSchemas,
}: {
  readonly template: Template
  readonly locked: boolean
  readonly onSchemas: (
    schema: Record<string, unknown>,
    uiSchema: Record<string, unknown> | undefined,
  ) => void
}) {
  const problemsId = useId()
  const [initial] = useState(() => rawText(template))
  const [text, setText] = useState(initial)
  const parsed = parseRaw(text)
  const problems = parsed.ok ? rawIssues(text).map((i) => i.message) : [parsed.error]
  return (
    <div className="wrx-template-raw-pane">
      <p className="wrx-admin-hint">
        The template&rsquo;s JSON Schema and UI schema, in the WRX template profile: an object of
        named fields, text with a <code>maxLength</code>, numbers, yes/no, dates, drop-downs and
        pickers; no arrays or nesting. Press Escape, then Tab, to leave the editor.
      </p>
      <RawEditor
        initialText={initial}
        readOnly={locked}
        label={`JSON Schema of ${template.name}`}
        describedBy={problemsId}
        onChange={(next) => {
          setText(next)
          const result = parseRaw(next)
          if (result.ok && !locked) onSchemas(result.value.schema, result.value.uiSchema)
        }}
      />
      <div id={problemsId} className="wrx-template-raw-problems">
        {problems.length === 0 ? (
          <p className="wrx-admin-muted">No problems: the template is inside the profile.</p>
        ) : (
          <>
            <p>
              {problems.length} {problems.length === 1 ? 'problem' : 'problems'}
              {parsed.ok ? '' : ': the draft keeps the last valid JSON'}
            </p>
            <ul className="wrx-admin-issues">
              {problems.map((p, i) => (
                <li key={i} className="wrx-admin-issue wrx-admin-issue-error">
                  <span className="wrx-admin-issue-severity">Error:</span> {p}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
