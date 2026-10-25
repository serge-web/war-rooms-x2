// The admin's game view (ADM-28–31): the player shell over the admin's session, with a preview
// selector in the header. Choosing a role shows exactly what that role sees (ADM-30); posting
// while previewing goes from the admin account (ADM-31), and a notice says so.
import { SessionStoreProvider, useForces, useRoles, useSessionStore } from '@wrx/hooks'
import { Banner } from '@wrx/ui'
import { useId, useMemo, useState } from 'react'
import { Shell } from '../shell.tsx'
import type { ShellProps } from '../shell.tsx'
import { previewAsRole } from './preview-store.ts'

export interface PreviewRoleOption {
  readonly id: string
  /** e.g. "Blue CO (Blue)". */
  readonly label: string
}

export interface PreviewSelectorCoreProps {
  readonly roles: readonly PreviewRoleOption[]
  /** The previewed role, or undefined for the admin's own view. */
  readonly value: string | undefined
  readonly onChange: (roleId: string | undefined) => void
}

/** "View as: Admin | <role>…" (ADM-30). */
export function PreviewSelectorCore({ roles, value, onChange }: PreviewSelectorCoreProps) {
  const id = useId()
  return (
    <span className="wrx-preview-selector">
      <label htmlFor={id}>View as</label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => {
          onChange(event.target.value === '' ? undefined : event.target.value)
        }}
      >
        <option value="">Admin</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.label}
          </option>
        ))}
      </select>
    </span>
  )
}

/** The shell for an admin session, with the preview selector; needs the admin's provider. */
export function AdminGameView(props: Omit<ShellProps, 'headerItems' | 'notice' | 'role'>) {
  const store = useSessionStore()
  const roles = useRoles().data
  const forces = useForces().data
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  // A role deleted while previewed drops the preview.
  const previewed = chosen === undefined ? undefined : roles.find((r) => r.id === chosen)
  const preview = useMemo(
    () => (previewed === undefined ? undefined : previewAsRole(store, previewed.id)),
    [store, previewed?.id],
  )
  const options = roles.map((role) => {
    const force = forces.find((f) => f.id === role.forceId)
    return { id: role.id, label: force === undefined ? role.name : `${role.name} (${force.name})` }
  })
  const selector = (
    <PreviewSelectorCore roles={options} value={previewed?.id} onChange={setChosen} />
  )
  if (preview === undefined || previewed === undefined) {
    return <Shell {...props} headerItems={selector} />
  }
  return (
    // A fresh subtree per previewed role: its workspace restores that role's layout (PLY-5).
    <SessionStoreProvider key={previewed.id} store={preview}>
      <Shell
        {...props}
        role={{ name: 'Admin' }}
        headerItems={selector}
        notice={
          <Banner className="wrx-preview-notice" tone="info" title={`Viewing as ${previewed.name}`}>
            You see exactly this role’s rooms, layout, themes and objectives. Anything you post is
            sent from the admin account and shown as from the admin.
          </Banner>
        }
      />
    </SessionStoreProvider>
  )
}
