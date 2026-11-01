import type { ReactNode } from 'react'
import { Notice } from '../components/index.ts'
import type { Draft, DraftValidation } from '../draft/index.ts'

/** What every section takes: plain data and one callback, no store (NFR-18). */
export interface SectionProps {
  readonly draft: Draft
  readonly validation: DraftValidation
  /** Proposes the next draft; the host commits it to the draft store. */
  readonly onChange: (next: Draft) => void
}

/**
 * ADM-42: ids become node names (`forces:<id>`, `roles:<id>`, `rooms:<id>`), and those are
 * listable. Ids are GUIDs (§3 rule 1), so the names reveal how many there are, not what they are.
 */
export function NodeNamesNotice({ kind }: { readonly kind: string }): ReactNode {
  return (
    <Notice tone="info" title="Node names are public.">
      Each {kind} id is part of a server node name, and anyone, even without logging in, can list
      node names. Ids are random GUIDs, so the names show how many {kind}s the game has, not their
      names.
      {kind === 'role'
        ? ' A role’s login name is its account name: players see it, and it is not secret either.'
        : ''}
    </Notice>
  )
}

/** The id shown read-only, as generated: a GUID (§3 rule 1). */
export function IdLine({ id }: { readonly id: string }) {
  return (
    <p className="wrx-admin-id">
      Id: <code>{id}</code>
    </p>
  )
}
