// Layout pieces shared by the admin sections: a section frame, the list / form split, and the
// one-line "add" form (ADM-27).
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from './controls.tsx'

export function SectionFrame({
  title,
  intro,
  children,
}: {
  readonly title: string
  readonly intro?: ReactNode
  readonly children: ReactNode
}) {
  const id = useId()
  return (
    <section className="wrx-admin-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {intro}
      {children}
    </section>
  )
}

/** The list on the left, the edit form for the selected item on the right. */
export function ListAndForm({
  listLabel,
  list,
  form,
}: {
  readonly listLabel: string
  readonly list: ReactNode
  readonly form: ReactNode
}) {
  return (
    <div className="wrx-admin-split">
      <div className="wrx-admin-split-list" role="group" aria-label={listLabel}>
        {list}
      </div>
      <div className="wrx-admin-split-form">{form}</div>
    </div>
  )
}

/** The edit form's frame: a heading, the fields, and actions such as Delete. */
export function EditForm({
  title,
  actions,
  children,
}: {
  readonly title: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  const id = useId()
  return (
    <form
      className="wrx-admin-form"
      aria-labelledby={id}
      onSubmit={(e) => {
        e.preventDefault()
      }}
    >
      <h3 id={id}>{title}</h3>
      {children}
      {actions !== undefined && <div className="wrx-admin-form-actions">{actions}</div>}
    </form>
  )
}

/** A name field and an Add button; extra controls (a force, a room type) go in `children`. */
export function AddForm({
  label,
  buttonLabel,
  onAdd,
  children,
}: {
  /** The name field's label, e.g. "New force name". */
  readonly label: string
  readonly buttonLabel: string
  /** Called with the trimmed name; never with an empty one. */
  readonly onAdd: (name: string) => void
  readonly children?: ReactNode
}) {
  const id = useId()
  const [name, setName] = useState('')
  return (
    <form
      className="wrx-admin-add"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = name.trim()
        if (trimmed === '') return
        onAdd(trimmed)
        setName('')
      }}
    >
      <div className="wrx-admin-field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          className="wrx-admin-input"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
          }}
        />
      </div>
      {children}
      <Button type="submit" variant="primary" disabled={name.trim() === ''}>
        {buttonLabel}
      </Button>
    </form>
  )
}
