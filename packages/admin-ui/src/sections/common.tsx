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

/** ADM-42: ids become node names (`forces:<id>`, `roles:<id>`, `rooms:<id>`), and those are listable. */
export function NodeNamesNotice({ kind }: { readonly kind: string }): ReactNode {
  return (
    <Notice tone="warning" title="Ids are not secret.">
      Each {kind} id is part of a server node name, and anyone, even without logging in, can list
      node names. Choose names whose ids reveal nothing confidential.
    </Notice>
  )
}

/** The id shown read-only, as generated (§3 rule 1). */
export function IdLine({ id }: { readonly id: string }) {
  return (
    <p className="wrx-admin-id">
      Id: <code>{id}</code>
    </p>
  )
}
