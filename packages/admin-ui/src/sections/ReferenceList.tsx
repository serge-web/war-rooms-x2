import type { Reference } from '../draft/index.ts'

const KIND_LABEL = Object.freeze({ role: 'Role', room: 'Room', objectives: 'Objectives' })

/** What refers to an item about to be deleted, and what happens to each (ADM-14). */
export function ReferenceList({
  references,
  none,
  footer,
}: {
  readonly references: readonly Reference[]
  readonly none: string
  readonly footer?: string
}) {
  return (
    <>
      {references.length === 0 ? (
        <p>{none}</p>
      ) : (
        <>
          <p>Referred to by:</p>
          <ul className="wrx-admin-references">
            {references.map((r) => (
              <li key={`${r.kind}:${r.id}`}>
                {r.kind === 'objectives' ? (
                  KIND_LABEL[r.kind]
                ) : (
                  <>
                    {KIND_LABEL[r.kind]} <strong>{r.name}</strong>
                  </>
                )}
                : {r.effect}
              </li>
            ))}
          </ul>
        </>
      )}
      {footer !== undefined && <p>{footer}</p>}
    </>
  )
}
