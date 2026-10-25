// The admin's game view (ADM-28–31): the player shell over the admin's session, with a preview
// selector in the header. Without a preview it is the umpire's own view, in the White Force: every
// room with write access, and objectives editing (PLY-15, PLY-35, SC-5). Choosing a role shows
// exactly what that role sees (ADM-30); posting while previewing goes from the admin account and
// is labelled as the umpire's, never the role's (ADM-31), and a notice says so.
//
// Nothing here runs an admin command: the game view reads and joins like a player, and writes
// only on an explicit action (send, publish objectives, post an announcement). The admin
// operations live in the admin backend (ADM-28), behind its own toggle.
import { UMPIRE_NAME } from '@wrx/domain'
import { SessionStoreProvider, useForces, useMe, useRoles, useSessionStore } from '@wrx/hooks'
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
  /** The previewed role, or undefined for the admin's own view, as the umpire. */
  readonly value: string | undefined
  readonly onChange: (roleId: string | undefined) => void
}

/** "View as: Umpire (you) | <role>…" (ADM-30). */
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
        <option value="">{`${UMPIRE_NAME} (you)`}</option>
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
  // The admin's own force: the White Force, which it plays in as umpire.
  const white = useMe().data.force
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
        role={{ name: UMPIRE_NAME, forceName: white?.name, forceColour: white?.colour }}
        headerItems={selector}
        notice={
          <Banner className="wrx-preview-notice" tone="info" title={`Viewing as ${previewed.name}`}>
            You see exactly this role’s rooms, layout, themes and objectives. Anything you post is
            sent from your admin login and shown as from the {UMPIRE_NAME}, not from this role.
          </Banner>
        }
      />
    </SessionStoreProvider>
  )
}
