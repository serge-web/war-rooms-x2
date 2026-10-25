// Local form controls for the admin backend, styled only by the `--wrx-*` properties. Each takes
// plain props, so WP 2.4's shared `packages/ui` can replace them one by one.
import { useId, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { DesignIssue } from '@wrx/schemas'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
}

export function Button({ variant = 'secondary', className, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      className={`wrx-admin-button wrx-admin-button-${variant}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  )
}

export type NoticeTone = 'info' | 'warning' | 'error'

/** A short message beside the form. Errors are announced as alerts. */
export function Notice({
  tone = 'info',
  title,
  children,
}: {
  readonly tone?: NoticeTone
  readonly title?: string
  readonly children: ReactNode
}) {
  return (
    <div
      className={`wrx-admin-notice wrx-admin-notice-${tone}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {title !== undefined && <strong className="wrx-admin-notice-title">{title} </strong>}
      {children}
    </div>
  )
}

/** The issues for one field, linked to it with `aria-describedby`. */
export function IssueList({
  id,
  issues,
}: {
  readonly id?: string
  readonly issues: readonly DesignIssue[]
}) {
  if (issues.length === 0) return null
  return (
    <ul className="wrx-admin-issues" id={id}>
      {issues.map((issue) => (
        <li
          key={`${issue.severity}|${issue.path}|${issue.message}`}
          className={`wrx-admin-issue wrx-admin-issue-${issue.severity}`}
        >
          <span className="wrx-admin-issue-severity">
            {issue.severity === 'error' ? 'Error' : 'Warning'}:
          </span>{' '}
          {issue.message}
        </li>
      ))}
    </ul>
  )
}

interface FieldFrame {
  readonly label: string
  readonly hint?: ReactNode
  readonly issues?: readonly DesignIssue[]
}

/** Wires a control's label, hint and issues together with ids. */
function useFieldIds(hint: ReactNode, issues: readonly DesignIssue[]) {
  const id = useId()
  const hintId = hint === undefined ? undefined : `${id}-hint`
  const issuesId = issues.length === 0 ? undefined : `${id}-issues`
  const describedBy = [hintId, issuesId].filter((x) => x !== undefined).join(' ') || undefined
  const invalid = issues.some((i) => i.severity === 'error')
  return { id, hintId, issuesId, describedBy, invalid }
}

function FieldParts({
  hint,
  hintId,
  issues,
  issuesId,
}: {
  readonly hint: ReactNode
  readonly hintId: string | undefined
  readonly issues: readonly DesignIssue[]
  readonly issuesId: string | undefined
}) {
  return (
    <>
      {hint !== undefined && (
        <div className="wrx-admin-hint" id={hintId}>
          {hint}
        </div>
      )}
      <IssueList id={issuesId} issues={issues} />
    </>
  )
}

export interface TextFieldProps extends FieldFrame {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly multiline?: boolean
  readonly readOnly?: boolean
  readonly maxLength?: number
  readonly placeholder?: string
}

export function TextField({
  label,
  hint,
  issues = [],
  value,
  onChange,
  multiline = false,
  readOnly,
  maxLength,
  placeholder,
}: TextFieldProps) {
  const ids = useFieldIds(hint, issues)
  const common = {
    id: ids.id,
    value,
    readOnly,
    maxLength,
    placeholder,
    'aria-describedby': ids.describedBy,
    'aria-invalid': ids.invalid || undefined,
    className: 'wrx-admin-input',
  }
  return (
    <div className="wrx-admin-field">
      <label htmlFor={ids.id}>{label}</label>
      {multiline ? (
        <textarea
          {...common}
          rows={3}
          onChange={(e) => {
            onChange(e.target.value)
          }}
        />
      ) : (
        <input
          {...common}
          type="text"
          onChange={(e) => {
            onChange(e.target.value)
          }}
        />
      )}
      <FieldParts hint={hint} hintId={ids.hintId} issues={issues} issuesId={ids.issuesId} />
    </div>
  )
}

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectFieldProps extends FieldFrame {
  readonly value: string
  readonly options: readonly SelectOption[]
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}

export function SelectField({
  label,
  hint,
  issues = [],
  value,
  options,
  onChange,
  disabled,
}: SelectFieldProps) {
  const ids = useFieldIds(hint, issues)
  return (
    <div className="wrx-admin-field">
      <label htmlFor={ids.id}>{label}</label>
      <select
        id={ids.id}
        className="wrx-admin-input"
        value={value}
        disabled={disabled}
        aria-describedby={ids.describedBy}
        aria-invalid={ids.invalid || undefined}
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
      <FieldParts hint={hint} hintId={ids.hintId} issues={issues} issuesId={ids.issuesId} />
    </div>
  )
}

export interface CheckboxFieldProps extends FieldFrame {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

export function CheckboxField({ label, hint, issues = [], checked, onChange }: CheckboxFieldProps) {
  const ids = useFieldIds(hint, issues)
  return (
    <div className="wrx-admin-field wrx-admin-field-check">
      <input
        id={ids.id}
        type="checkbox"
        checked={checked}
        aria-describedby={ids.describedBy}
        onChange={(e) => {
          onChange(e.target.checked)
        }}
      />
      <label htmlFor={ids.id}>{label}</label>
      <FieldParts hint={hint} hintId={ids.hintId} issues={issues} issuesId={ids.issuesId} />
    </div>
  )
}

const HEX = /^#[0-9a-fA-F]{6}$/

export interface ColourFieldProps extends FieldFrame {
  readonly value: string
  readonly onChange: (colour: string) => void
}

/**
 * A colour: the native picker plus a hex field (ui-stack.md). The hex field commits only a
 * complete `#rrggbb`; until then it keeps what the admin typed and says what is expected.
 */
export function ColourField({ label, hint, issues = [], value, onChange }: ColourFieldProps) {
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setText(value)
  }
  const typing = text !== value && !HEX.test(text)
  const local: DesignIssue[] = typing
    ? [{ severity: 'error', path: '', message: 'use a colour as #rrggbb' }]
    : []
  const ids = useFieldIds(hint, [...local, ...issues])
  return (
    <div className="wrx-admin-field">
      <label htmlFor={ids.id}>{label}</label>
      <div className="wrx-admin-colour">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX.test(value) ? value.toLowerCase() : '#000000'}
          onChange={(e) => {
            onChange(e.target.value)
          }}
        />
        <input
          id={ids.id}
          type="text"
          className="wrx-admin-input wrx-admin-input-hex"
          value={text}
          spellCheck={false}
          maxLength={7}
          aria-describedby={ids.describedBy}
          aria-invalid={ids.invalid || undefined}
          onChange={(e) => {
            const next = e.target.value.trim()
            setText(next)
            if (HEX.test(next)) onChange(next)
          }}
        />
      </div>
      <FieldParts
        hint={hint}
        hintId={ids.hintId}
        issues={[...local, ...issues]}
        issuesId={ids.issuesId}
      />
    </div>
  )
}
