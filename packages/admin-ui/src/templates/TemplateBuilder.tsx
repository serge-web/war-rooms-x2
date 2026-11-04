// The drag-and-drop template builder (WP 4.3, TD5, TPL-7): a palette of field types, the fields
// in order, and the selected field's settings. On dnd-kit like the forces and rooms lists: drag a
// palette entry into the list, or press it to add the field at the end; sort fields by dragging,
// with the keyboard (Space, arrows, Space) or with Move up / Move down (NFR-14). Every change is
// written as WRX-profile JSON Schema and UI schema (`writeTemplate`).
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { Announcements, DragEndEvent, UniqueIdentifier } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { byOrderThenId } from '@wrx/domain'
import { TEMPLATE_LIMITS, unsafePattern } from '@wrx/schemas'
import type { DesignFile, DesignIssue, ProfileIssue } from '@wrx/schemas'
import { useId, useState } from 'react'
import type { PointerEventHandler, ReactNode } from 'react'
import { Button, IssueList } from '../components/index.ts'
import {
  FIELD_KINDS,
  FIELD_KIND_LABEL,
  addField,
  fieldNameFrom,
  fieldNameProblem,
  maxLengthLimit,
  moveField,
  newField,
  removeField,
  updateField,
} from './builder.ts'
import type {
  BuilderModel,
  DropDownFieldModel,
  FieldKind,
  FieldModel,
  FieldOption,
  LinkedFieldModel,
} from './builder.ts'

export interface TemplateBuilderProps {
  readonly model: BuilderModel
  readonly onChange: (model: BuilderModel) => void
  /** A locked template: everything shown, nothing editable. */
  readonly readOnly: boolean
  /** The profile's issues with the written schema, to show on the field they concern. */
  readonly issues: readonly ProfileIssue[]
  /** For a role picker's force filter. */
  readonly design: Pick<DesignFile, 'forces'>
}

const PALETTE_PREFIX = 'palette:'
const LIST_ID = 'fields-list'

function fieldLabel(field: FieldModel): string {
  return field.title.trim() === '' ? field.name : field.title
}

/** The field a profile issue concerns, by name, if any. */
export function issueField(issue: ProfileIssue): string | undefined {
  const [root, a, b] = issue.path
  if (root === 'schema' && a === 'properties' && typeof b === 'string') return b
  if (root === 'schema' && a === 'dependencies' && typeof b === 'string') return b
  if (root === 'uiSchema' && typeof a === 'string' && a !== 'ui:order') return a
  return undefined
}

function asDesignIssues(issues: readonly ProfileIssue[]): DesignIssue[] {
  return issues.map((i) => ({ severity: 'error', path: i.path.join('.'), message: i.message }))
}

export function TemplateBuilder({
  model,
  onChange,
  readOnly,
  issues,
  design,
}: TemplateBuilderProps) {
  const [selected, setSelected] = useState<string | undefined>(model.fields[0]?.key)
  const field = model.fields.find((f) => f.key === selected) ?? model.fields[0]
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const add = (kind: FieldKind, index?: number) => {
    const created = newField(model, kind)
    onChange(addField(model, created, index))
    setSelected(created.key)
  }
  const nameOf = (id: UniqueIdentifier): string => {
    const key = String(id)
    if (key.startsWith(PALETTE_PREFIX)) {
      const kind = key.slice(PALETTE_PREFIX.length) as FieldKind
      return `a new ${FIELD_KIND_LABEL[kind]} field`
    }
    const found = model.fields.find((f) => f.key === key)
    return found === undefined ? key : fieldLabel(found)
  }
  const position = (id: UniqueIdentifier) => {
    const index = model.fields.findIndex((f) => f.key === id)
    return `position ${index === -1 ? model.fields.length + 1 : index + 1} of ${model.fields.length}`
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} is over ${position(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} dropped in ${position(over.id)}.`
        : `${nameOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} cancelled.`,
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || readOnly) return
    const id = String(active.id)
    const index = model.fields.findIndex((f) => f.key === over.id)
    if (id.startsWith(PALETTE_PREFIX)) {
      add(id.slice(PALETTE_PREFIX.length) as FieldKind, index === -1 ? undefined : index)
      return
    }
    if (active.id !== over.id && index !== -1) onChange(moveField(model, id, index))
  }
  const general = issues.filter((i) => issueField(i) === undefined)
  const hasDropDown = model.fields.some((f) => f.kind === 'dropDown')

  return (
    <div className="wrx-template-builder">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To reorder, press Space or Enter to pick up, use the arrow keys to move, press Space or Enter to drop, or Escape to cancel.',
          },
        }}
      >
        <div className="wrx-template-palette" role="group" aria-label="Field palette">
          <h4>Add a field</h4>
          <p className="wrx-admin-hint">
            Press a field type to add it at the end, or drag it into the list.
          </p>
          <ul>
            {FIELD_KINDS.map((kind) => (
              <PaletteItem
                key={kind}
                kind={kind}
                disabled={readOnly || (kind === 'linked' && !hasDropDown)}
                onAdd={() => {
                  add(kind)
                }}
              />
            ))}
          </ul>
          {!hasDropDown && (
            <p className="wrx-admin-hint">A linked drop-down needs a drop-down to depend on.</p>
          )}
        </div>
        <div className="wrx-template-fields">
          <h4>Fields</h4>
          <FieldList
            model={model}
            readOnly={readOnly}
            selected={field?.key}
            issues={issues}
            onSelect={setSelected}
            onMove={(key, index) => {
              onChange(moveField(model, key, index))
            }}
            onRemove={(key) => {
              onChange(removeField(model, key))
            }}
          />
          <IssueList issues={asDesignIssues(general)} />
        </div>
      </DndContext>
      <div className="wrx-template-settings">
        {field === undefined ? (
          <p className="wrx-admin-muted">Add a field from the palette.</p>
        ) : (
          <FieldSettings
            key={field.key}
            model={model}
            field={field}
            readOnly={readOnly}
            design={design}
            issues={asDesignIssues(issues.filter((i) => issueField(i) === field.name))}
            onChange={(next) => {
              onChange(updateField(model, field.key, next))
            }}
          />
        )}
      </div>
    </div>
  )
}

function PaletteItem({
  kind,
  disabled,
  onAdd,
}: {
  readonly kind: FieldKind
  readonly disabled: boolean
  readonly onAdd: () => void
}) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({
    id: `${PALETTE_PREFIX}${kind}`,
    disabled,
  })
  // Pointer drag only: the keyboard adds with the button itself (Enter or Space).
  const onPointerDown = listeners?.onPointerDown as PointerEventHandler | undefined
  return (
    <li>
      <button
        type="button"
        ref={setNodeRef}
        className={`wrx-admin-button wrx-admin-button-secondary wrx-template-palette-item${isDragging ? ' is-dragging' : ''}`}
        disabled={disabled}
        onPointerDown={onPointerDown}
        style={{ transform: CSS.Translate.toString(transform) }}
        onClick={onAdd}
      >
        {FIELD_KIND_LABEL[kind]}
      </button>
    </li>
  )
}

function FieldList({
  model,
  readOnly,
  selected,
  issues,
  onSelect,
  onMove,
  onRemove,
}: {
  readonly model: BuilderModel
  readonly readOnly: boolean
  readonly selected: string | undefined
  readonly issues: readonly ProfileIssue[]
  readonly onSelect: (key: string) => void
  readonly onMove: (key: string, index: number) => void
  readonly onRemove: (key: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: LIST_ID })
  return (
    <div ref={setNodeRef} className={`wrx-template-drop${isOver ? ' is-over' : ''}`}>
      {model.fields.length === 0 ? (
        <p className="wrx-admin-muted">No fields yet: add one from the palette.</p>
      ) : (
        <SortableContext
          items={model.fields.map((f) => f.key)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="wrx-admin-list" aria-label="Fields">
            {model.fields.map((field, index) => (
              <FieldRow
                key={field.key}
                field={field}
                index={index}
                count={model.fields.length}
                selected={field.key === selected}
                readOnly={readOnly}
                problems={issues.filter((i) => issueField(i) === field.name).length}
                onSelect={onSelect}
                onMove={onMove}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </SortableContext>
      )}
    </div>
  )
}

function FieldRow({
  field,
  index,
  count,
  selected,
  readOnly,
  problems,
  onSelect,
  onMove,
  onRemove,
}: {
  readonly field: FieldModel
  readonly index: number
  readonly count: number
  readonly selected: boolean
  readonly readOnly: boolean
  readonly problems: number
  readonly onSelect: (key: string) => void
  readonly onMove: (key: string, index: number) => void
  readonly onRemove: (key: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.key, disabled: readOnly })
  const label = fieldLabel(field)
  return (
    <li
      ref={setNodeRef}
      data-sort-index={index}
      className={`wrx-admin-list-row${selected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="wrx-admin-handle"
        {...attributes}
        {...listeners}
        disabled={readOnly}
        aria-label={`Reorder ${label}`}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        type="button"
        className="wrx-admin-list-name"
        aria-current={selected ? 'true' : undefined}
        onClick={() => {
          onSelect(field.key)
        }}
      >
        <span className="wrx-admin-list-label">{label}</span>
        <span className="wrx-admin-tag">{FIELD_KIND_LABEL[field.kind]}</span>
        {field.required && <span className="wrx-admin-tag">Required</span>}
        {problems > 0 && (
          <span className="wrx-admin-badge wrx-admin-badge-error">
            {problems}
            <span className="wrx-admin-visually-hidden">
              {' '}
              {problems === 1 ? 'error' : 'errors'}
            </span>
          </span>
        )}
      </button>
      <span className="wrx-admin-list-moves">
        <Button
          variant="quiet"
          aria-label={`Move ${label} up`}
          disabled={readOnly || index === 0}
          onClick={() => {
            onMove(field.key, index - 1)
          }}
        >
          <span aria-hidden="true">↑</span>
        </Button>
        <Button
          variant="quiet"
          aria-label={`Move ${label} down`}
          disabled={readOnly || index === count - 1}
          onClick={() => {
            onMove(field.key, index + 1)
          }}
        >
          <span aria-hidden="true">↓</span>
        </Button>
        <Button
          variant="quiet"
          aria-label={`Remove ${label}`}
          disabled={readOnly}
          onClick={() => {
            onRemove(field.key)
          }}
        >
          <span aria-hidden="true">×</span>
        </Button>
      </span>
    </li>
  )
}

// --- Settings ---------------------------------------------------------------------------------

function Row({ children }: { readonly children: ReactNode }) {
  return <div className="wrx-template-setting-row">{children}</div>
}

function TextInput({
  label,
  value,
  onChange,
  hint,
  problem,
  maxLength,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly hint?: string
  readonly problem?: string | undefined
  readonly maxLength?: number
}) {
  const id = useId()
  const described = [
    hint === undefined ? '' : `${id}-hint`,
    problem === undefined ? '' : `${id}-problem`,
  ]
    .filter((x) => x !== '')
    .join(' ')
  return (
    <div className="wrx-admin-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="wrx-admin-input"
        type="text"
        value={value}
        maxLength={maxLength}
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={described === '' ? undefined : described}
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />
      {hint !== undefined && (
        <div className="wrx-admin-hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
      {problem !== undefined && (
        <ul className="wrx-admin-issues" id={`${id}-problem`}>
          <li className="wrx-admin-issue wrx-admin-issue-error">
            <span className="wrx-admin-issue-severity">Error:</span> {problem}
          </li>
        </ul>
      )}
    </div>
  )
}

/** A number setting; empty means none. */
function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  required = false,
}: {
  readonly label: string
  readonly value: number | undefined
  readonly onChange: (value: number | undefined) => void
  readonly min?: number
  readonly max?: number
  readonly step?: number | 'any'
  readonly required?: boolean
}) {
  const id = useId()
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setText(value === undefined ? '' : String(value))
  }
  return (
    <div className="wrx-admin-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="wrx-admin-input wrx-template-number"
        type="number"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step ?? 'any'}
        required={required}
        onChange={(e) => {
          const raw = e.target.value
          setText(raw)
          if (raw.trim() === '') {
            if (!required) onChange(undefined)
            return
          }
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(n)
        }}
      />
    </div>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="wrx-admin-field wrx-admin-field-check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked)
        }}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  )
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="wrx-admin-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="wrx-admin-input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function FieldSettings({
  model,
  field,
  readOnly,
  design,
  issues,
  onChange,
}: {
  readonly model: BuilderModel
  readonly field: FieldModel
  readonly readOnly: boolean
  readonly design: Pick<DesignFile, 'forces'>
  readonly issues: readonly DesignIssue[]
  readonly onChange: (field: FieldModel) => void
}) {
  const [name, setName] = useState(field.name)
  const [shownName, setShownName] = useState(field.name)
  if (field.name !== shownName) {
    setShownName(field.name)
    setName(field.name)
  }
  // A name still made from the label follows the label, until the admin names the field.
  const taken = new Set(model.fields.filter((f) => f.key !== field.key).map((f) => f.name))
  const derived = field.name === fieldNameFrom(field.title, taken)
  const nameProblem = name === field.name ? undefined : fieldNameProblem(model, field.key, name)
  const label = fieldLabel(field)
  return (
    <fieldset className="wrx-admin-fieldset wrx-template-field-settings" disabled={readOnly}>
      <legend>
        {FIELD_KIND_LABEL[field.kind]}: {label}
      </legend>
      <TextInput
        label="Label"
        value={field.title}
        maxLength={TEMPLATE_LIMITS.titleChars}
        onChange={(title) => {
          onChange(
            derived ? { ...field, title, name: fieldNameFrom(title, taken) } : { ...field, title },
          )
        }}
      />
      <TextInput
        label="Field name"
        value={name}
        maxLength={64}
        hint="The key of the value in each message. Letters, digits and underscores."
        problem={nameProblem}
        onChange={(next) => {
          setName(next)
          if (fieldNameProblem(model, field.key, next) === undefined)
            onChange({ ...field, name: next })
        }}
      />
      <TextInput
        label="Help text"
        value={field.description}
        maxLength={TEMPLATE_LIMITS.descriptionChars}
        onChange={(description) => {
          onChange({ ...field, description })
        }}
      />
      <Check
        label="Required"
        checked={field.required}
        onChange={(required) => {
          onChange({ ...field, required })
        }}
      />
      <KindSettings model={model} field={field} design={design} onChange={onChange} />
      {/* A pattern's problem is shown at its field, from the same check. */}
      <IssueList issues={issues.filter((i) => !i.path.endsWith('.pattern'))} />
    </fieldset>
  )
}

function KindSettings({
  model,
  field,
  design,
  onChange,
}: {
  readonly model: BuilderModel
  readonly field: FieldModel
  readonly design: Pick<DesignFile, 'forces'>
  readonly onChange: (field: FieldModel) => void
}) {
  switch (field.kind) {
    case 'text':
    case 'longText': {
      const limit = maxLengthLimit(field)
      const patternProblem = field.pattern === '' ? undefined : unsafePattern(field.pattern)
      return (
        <>
          <Row>
            <NumberInput
              label="Most characters"
              value={field.maxLength}
              min={1}
              max={limit}
              step={1}
              required
              onChange={(maxLength) => {
                if (maxLength !== undefined) onChange({ ...field, maxLength })
              }}
            />
            <NumberInput
              label="Fewest characters"
              value={field.minLength}
              min={0}
              step={1}
              onChange={(minLength) => {
                onChange({ ...field, minLength })
              }}
            />
          </Row>
          {field.kind === 'text' && (
            <TextInput
              label="Pattern (regular expression)"
              value={field.pattern}
              maxLength={TEMPLATE_LIMITS.patternChars}
              hint={`Optional. With a pattern, text holds at most ${TEMPLATE_LIMITS.patternMaxLength} characters; groups may not repeat.`}
              problem={patternProblem}
              onChange={(pattern) => {
                onChange({ ...field, pattern })
              }}
            />
          )}
          <TextInput
            label="Placeholder"
            value={field.placeholder}
            maxLength={TEMPLATE_LIMITS.titleChars}
            onChange={(placeholder) => {
              onChange({ ...field, placeholder })
            }}
          />
          {field.kind === 'longText' && (
            <NumberInput
              label="Rows shown"
              value={field.rows}
              min={1}
              max={TEMPLATE_LIMITS.textareaRows}
              step={1}
              onChange={(rows) => {
                onChange({ ...field, rows })
              }}
            />
          )}
        </>
      )
    }
    case 'number':
    case 'slider':
      return (
        <>
          <Check
            label="Whole numbers only"
            checked={field.integer}
            onChange={(integer) => {
              onChange({ ...field, integer })
            }}
          />
          <Row>
            <NumberInput
              label="Minimum"
              value={field.minimum}
              required={field.kind === 'slider'}
              onChange={(minimum) => {
                onChange({ ...field, minimum })
              }}
            />
            <NumberInput
              label="Maximum"
              value={field.maximum}
              required={field.kind === 'slider'}
              onChange={(maximum) => {
                onChange({ ...field, maximum })
              }}
            />
            <NumberInput
              label="Step"
              value={field.multipleOf}
              min={0}
              onChange={(multipleOf) => {
                onChange({ ...field, multipleOf })
              }}
            />
          </Row>
        </>
      )
    case 'yesNo':
      return (
        <Select
          label="Starts as"
          value={field.default === undefined ? '' : field.default ? 'yes' : 'no'}
          options={[
            { value: '', label: 'Not set' },
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
          onChange={(v) => {
            onChange({ ...field, default: v === '' ? undefined : v === 'yes' })
          }}
        />
      )
    case 'date':
    case 'dateTime':
      return (
        <p className="wrx-admin-hint">
          Shown in the player&rsquo;s local time; stored as an ISO{' '}
          {field.kind === 'date' ? 'date' : 'date and time'}.
        </p>
      )
    case 'dropDown':
      return <DropDownSettings field={field} onChange={onChange} />
    case 'linked':
      return <LinkedSettings model={model} field={field} onChange={onChange} />
    case 'force':
    case 'role':
      return (
        <>
          <Select
            label="Offer"
            value={field.scope}
            options={[
              { value: 'game', label: `Every ${field.kind} in the game` },
              { value: 'room', label: `Only ${field.kind}s in this room` },
            ]}
            onChange={(scope) => {
              onChange({ ...field, scope: scope === 'room' ? 'room' : 'game' })
            }}
          />
          {field.kind === 'role' && (
            <Select
              label="Only roles of"
              value={field.forceFilter ?? ''}
              options={[
                { value: '', label: 'Any force' },
                ...[...design.forces]
                  .sort(byOrderThenId)
                  .map((f) => ({ value: f.id, label: f.name })),
                ...(field.forceFilter !== undefined &&
                !design.forces.some((f) => f.id === field.forceFilter)
                  ? [{ value: field.forceFilter, label: 'Unknown force' }]
                  : []),
              ]}
              onChange={(v) => {
                onChange({ ...field, forceFilter: v === '' ? undefined : v })
              }}
            />
          )}
        </>
      )
  }
}

function DropDownSettings({
  field,
  onChange,
}: {
  readonly field: DropDownFieldModel
  readonly onChange: (field: FieldModel) => void
}) {
  return (
    <>
      <OptionsEditor
        label={`Options of ${fieldLabel(field)}`}
        options={field.options}
        onChange={(options) => {
          const fallback =
            field.default !== undefined && options.some((o) => o.value === field.default)
              ? field.default
              : undefined
          onChange({ ...field, options, default: fallback })
        }}
      />
      <Row>
        <Select
          label="Show as"
          value={field.display}
          options={[
            { value: 'select', label: 'A drop-down list' },
            { value: 'radio', label: 'Radio buttons' },
          ]}
          onChange={(v) => {
            onChange({ ...field, display: v === 'radio' ? 'radio' : 'select' })
          }}
        />
        <Select
          label="Starts as"
          value={field.default ?? ''}
          options={[
            { value: '', label: 'Not set' },
            ...field.options.map((o) => ({
              value: o.value,
              label: o.label === '' ? o.value : o.label,
            })),
          ]}
          onChange={(v) => {
            onChange({ ...field, default: v === '' ? undefined : v })
          }}
        />
      </Row>
    </>
  )
}

function LinkedSettings({
  model,
  field,
  onChange,
}: {
  readonly model: BuilderModel
  readonly field: LinkedFieldModel
  readonly onChange: (field: FieldModel) => void
}) {
  const parents = model.fields.filter((f): f is DropDownFieldModel => f.kind === 'dropDown')
  const parent = parents.find((p) => p.key === field.parentKey)
  return (
    <>
      <Select
        label="Depends on"
        value={parent?.key ?? ''}
        options={[
          ...(parent === undefined ? [{ value: '', label: 'Choose a drop-down' }] : []),
          ...parents.map((p) => ({ value: p.key, label: fieldLabel(p) })),
        ]}
        onChange={(key) => {
          onChange({ ...field, parentKey: key, choices: [] })
        }}
      />
      {parent === undefined ? (
        <p className="wrx-admin-hint">Choose the drop-down whose choice sets these options.</p>
      ) : (
        parent.options.map((option) => {
          const choice = field.choices.find((c) => c.parentValue === option.value)
          return (
            <OptionsEditor
              key={option.value}
              label={`When ${fieldLabel(parent)} is ${option.label === '' ? option.value : option.label}`}
              options={choice?.options ?? []}
              onChange={(options) => {
                const others = field.choices.filter((c) => c.parentValue !== option.value)
                const ordered = parent.options.flatMap((o) => {
                  if (o.value === option.value) return [{ parentValue: o.value, options }]
                  const kept = others.find((c) => c.parentValue === o.value)
                  return kept === undefined ? [] : [kept]
                })
                onChange({ ...field, choices: ordered })
              }}
            />
          )
        })
      )}
    </>
  )
}

/** A list of options, each a stored value and a label shown in its place. */
function OptionsEditor({
  label,
  options,
  onChange,
}: {
  readonly label: string
  readonly options: readonly FieldOption[]
  readonly onChange: (options: FieldOption[]) => void
}) {
  const set = (i: number, option: FieldOption) => {
    onChange(options.map((o, j) => (j === i ? option : o)))
  }
  return (
    <fieldset className="wrx-admin-fieldset wrx-template-options">
      <legend>{label}</legend>
      {options.length === 0 ? (
        <p className="wrx-admin-muted">No options.</p>
      ) : (
        <table className="wrx-template-options-table">
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Label</th>
              <th scope="col">
                <span className="wrx-admin-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {options.map((option, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="wrx-admin-input"
                    aria-label={`${label}: option ${i + 1} value`}
                    value={option.value}
                    maxLength={TEMPLATE_LIMITS.optionChars}
                    onChange={(e) => {
                      set(i, { ...option, value: e.target.value })
                    }}
                  />
                </td>
                <td>
                  <input
                    className="wrx-admin-input"
                    aria-label={`${label}: option ${i + 1} label`}
                    value={option.label}
                    maxLength={TEMPLATE_LIMITS.optionChars}
                    onChange={(e) => {
                      set(i, { ...option, label: e.target.value })
                    }}
                  />
                </td>
                <td>
                  <Button
                    variant="quiet"
                    aria-label={`${label}: remove option ${i + 1}`}
                    onClick={() => {
                      onChange(options.filter((_, j) => j !== i))
                    }}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button
        onClick={() => {
          const values = new Set(options.map((o) => o.value))
          let n = options.length + 1
          while (values.has(`option${n}`)) n++
          onChange([...options, { value: `option${n}`, label: `Option ${n}` }])
        }}
      >
        Add option
      </Button>
    </fieldset>
  )
}
