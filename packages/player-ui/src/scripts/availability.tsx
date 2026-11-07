// Who is offered the script panel (SRD Annex C PD4, PY-6; WP 6.3): the admin's own game view and
// the White Force roles that are not observers (`scriptRoleOf`). A preview as a role reads through
// the admin's session, so a script there would run as the admin under the role's name: the admin's
// game view turns the panel off for its previews (`NoScriptsHere`).
import { scriptRoleOf } from '@wrx/domain'
import type { ScriptRole } from '@wrx/domain'
import { useMe } from '@wrx/hooks'
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

const ScriptsOffContext = createContext(false)

/** Its subtree offers no script panel, whatever the role (the admin's preview as a role). */
export function NoScriptsHere({ children }: { readonly children?: ReactNode }) {
  return <ScriptsOffContext.Provider value={true}>{children}</ScriptsOffContext.Provider>
}

/** The role this pane's scripts run as, or undefined if it gets no script panel. */
export function useScriptRole(): ScriptRole | undefined {
  const off = useContext(ScriptsOffContext)
  const me = useMe()
  if (off || me.status === 'loading') return undefined
  return scriptRoleOf(me.data)
}
