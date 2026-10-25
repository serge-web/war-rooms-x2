import { useId, useState } from 'react'
import type { ComponentPropsWithRef } from 'react'

export type TextFieldProps = Omit<ComponentPropsWithRef<'input'>, 'id'> & {
  /** The visible label; required, so every field has an accessible name (NFR-14). */
  readonly label: string
  /** Help text under the field, linked with `aria-describedby`. */
  readonly hint?: string
  /** An error under the field; sets `aria-invalid` and is announced. */
  readonly error?: string | undefined
  /** Defaults to a generated id. */
  readonly id?: string
}

/** A labelled text input with optional hint and error. */
export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
  const generated = useId()
  const inputId = id ?? generated
  const hintId = hint === undefined ? undefined : `${inputId}-hint`
  const errorId = error === undefined ? undefined : `${inputId}-error`
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={['wrx-field', className].filter(Boolean).join(' ')}>
      <label className="wrx-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        type="text"
        {...rest}
        id={inputId}
        className="wrx-field__input"
        aria-describedby={describedBy}
        aria-invalid={error === undefined ? undefined : true}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="wrx-field__hint">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="wrx-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type'>

/** A password input with a show/hide toggle (a pressed-state button, NFR-14). */
export function PasswordField({ className, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className={['wrx-password', className].filter(Boolean).join(' ')}>
      <TextField autoComplete="current-password" {...rest} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="wrx-password__toggle"
        aria-pressed={visible}
        onClick={() => {
          setVisible((v) => !v)
        }}
      >
        {visible ? 'Hide password' : 'Show password'}
      </button>
    </div>
  )
}
