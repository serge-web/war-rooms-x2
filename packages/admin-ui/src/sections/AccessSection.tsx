// The effective-access matrix (ADM-9): rooms × roles, write / read / none, computed by
// `effectiveAccess` (via `useDesignAccess`) from the draft, so it is live before publishing.
// Also lists every design check, since errors block publishing (WP 2.3).
import type { AccessCell, AccessMatrix as Matrix, AccessReason } from '@wrx/domain'
import { useDesignAccess } from '@wrx/hooks'
import type { DesignFile, DesignIssue } from '@wrx/schemas'
import { IssueList, Notice, SectionFrame } from '../components/index.ts'
import type { DraftValidation } from '../draft/index.ts'

const REASON_LABEL: Readonly<Record<AccessReason, string>> = Object.freeze({
  'force-entry': 'force entry',
  'role-entry': 'role entry',
  'white-force': 'White Force',
  'white-observer-all': 'White observer, no rooms assigned: reads all',
  'white-observer-unassigned': 'White observer, not assigned here',
  observer: 'observer',
})

const ACCESS_LABEL = Object.freeze({ write: 'Write', read: 'Read', none: 'None' })

export interface AccessMatrixCoreProps {
  readonly matrix: Matrix
  /** For display names; ids are shown for anything it does not name. */
  readonly design: Pick<DesignFile, 'forces' | 'roles' | 'rooms'>
}

/** The matrix as a table: a header row of forces, one of roles, then a row per room. */
export function AccessMatrixCore({ matrix, design }: AccessMatrixCoreProps) {
  const roles = new Map(design.roles.map((r) => [r.id, r]))
  const forces = new Map(design.forces.map((f) => [f.id, f]))
  const roomName = (id: string) => design.rooms.find((r) => r.id === id)?.name ?? id

  const groups: { forceId: string; roleIds: string[] }[] = []
  for (const roleId of matrix.roleIds) {
    const forceId = roles.get(roleId)?.forceId ?? ''
    const last = groups.at(-1)
    if (last?.forceId === forceId) last.roleIds.push(roleId)
    else groups.push({ forceId, roleIds: [roleId] })
  }

  if (matrix.roomIds.length === 0 || matrix.roleIds.length === 0) {
    return <p className="wrx-admin-muted">Add rooms and roles to see who can use each room.</p>
  }
  return (
    <div
      className="wrx-admin-matrix-scroll"
      role="region"
      aria-label="Access matrix, scrollable"
      tabIndex={0}
    >
      <table className="wrx-admin-matrix">
        <caption>Effective access: each room (row) for each role (column)</caption>
        <colgroup span={1} />
        {groups.map((g) => (
          <colgroup key={g.forceId} span={g.roleIds.length} />
        ))}
        <thead>
          <tr>
            <td rowSpan={2} />
            {groups.map((g) => (
              <th key={g.forceId} scope="colgroup" colSpan={g.roleIds.length}>
                {forces.get(g.forceId)?.name ?? 'Unknown force'}
              </th>
            ))}
          </tr>
          <tr>
            {matrix.roleIds.map((roleId) => {
              const role = roles.get(roleId)
              return (
                <th key={roleId} scope="col">
                  {role?.name ?? roleId}
                  {role?.isObserver === true && <span className="wrx-admin-tag">Observer</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {matrix.roomIds.map((roomId) => (
            <tr key={roomId}>
              <th scope="row">{roomName(roomId)}</th>
              {matrix.roleIds.map((roleId) => (
                <Cell key={roleId} cell={matrix.cells.get(roomId)?.get(roleId)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ cell }: { readonly cell: AccessCell | undefined }) {
  const access = cell?.access ?? 'none'
  const reasons = cell?.reasons ?? []
  return (
    <td className={`wrx-admin-access wrx-admin-access-${access}`} data-access={access}>
      <span className="wrx-admin-access-value">{ACCESS_LABEL[access]}</span>
      {reasons.length > 0 && (
        <span className="wrx-admin-access-why">
          {' '}
          ({reasons.map((r) => REASON_LABEL[r]).join(', ')})
        </span>
      )}
    </td>
  )
}

/** The matrix over a design, through `useDesignAccess` (NFR-18: the hook half). */
export function AccessMatrix({ design }: { readonly design: DesignFile }) {
  const matrix = useDesignAccess(design)
  return <AccessMatrixCore matrix={matrix} design={design} />
}

export interface AccessSectionCoreProps {
  readonly matrix: Matrix
  readonly design: DesignFile
  readonly validation: DraftValidation
}

export function AccessSectionCore({ matrix, design, validation }: AccessSectionCoreProps) {
  const roomName = (id: string) => design.rooms.find((r) => r.id === id)?.name ?? id
  const problems: DesignIssue[] = matrix.problems.map((p) => ({
    severity: 'error',
    path: `rooms:${p.roomId}`,
    message: `${roomName(p.roomId)}: ${p.message} (grants nothing)`,
  }))
  return (
    <SectionFrame
      title="Access matrix"
      intro={
        <p className="wrx-admin-hint">
          Who can use each room once published. Precedence, weakest first: a force entry, a role
          entry, White Force membership (write everywhere), observer status (read only, always). A
          White Force observer sees only the rooms that name it in a role entry, or every room when
          none does. You, the umpire, write in every room.
        </p>
      }
    >
      <AccessMatrixCore matrix={matrix} design={design} />
      <h3>Problems</h3>
      {problems.length === 0 ? (
        <p className="wrx-admin-muted">Every participant entry names a known force or role.</p>
      ) : (
        <IssueList issues={problems} />
      )}
      <h3>Design checks</h3>
      {validation.issues.length === 0 ? (
        <Notice tone="info">No problems: the design can be published.</Notice>
      ) : (
        <>
          <p>
            {validation.errorCount} {validation.errorCount === 1 ? 'error' : 'errors'} (these block
            publishing), {validation.warningCount}{' '}
            {validation.warningCount === 1 ? 'warning' : 'warnings'}.
          </p>
          <ul className="wrx-admin-issues">
            {validation.issues.map((issue) => (
              <li
                key={`${issue.severity}|${issue.path}|${issue.message}`}
                className={`wrx-admin-issue wrx-admin-issue-${issue.severity}`}
              >
                <span className="wrx-admin-issue-severity">
                  {issue.severity === 'error' ? 'Error' : 'Warning'}:
                </span>{' '}
                <code>{issue.path}</code> {issue.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionFrame>
  )
}
