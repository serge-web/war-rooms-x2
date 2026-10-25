// A room's participants (ADM-6, §3 rule 4): mixed force and role entries, each with read or
// write access. Umpire-force roles and observers follow their own rules, shown in the matrix.
import { byOrderThenId } from '@wrx/domain'
import type { DesignFile, DesignIssue, Participant, Room } from '@wrx/schemas'
import { useId, useState } from 'react'
import { Button, IssueList } from '../components/index.ts'
import { sortedRoles } from '../draft/index.ts'

export interface ParticipantsEditorProps {
  readonly design: DesignFile
  readonly room: Room
  /** Issues for the room's participants, by path (`rooms[i].participants[j]`). */
  readonly issuesAt: (path: string) => readonly DesignIssue[]
  /** Path prefix of this room's entries, e.g. `rooms[2].participants`. */
  readonly path: string
  readonly onSet: (entry: Participant) => void
  readonly onRemove: (kind: Participant['kind'], id: string) => void
}

const ACCESS_LABEL = Object.freeze({ write: 'Read and write', read: 'Read only' })

export function ParticipantsEditor({
  design,
  room,
  issuesAt,
  path,
  onSet,
  onRemove,
}: ParticipantsEditorProps) {
  const id = useId()
  const forces = [...design.forces].sort(byOrderThenId)
  const roles = sortedRoles(design)
  const nameOf = (p: Pick<Participant, 'kind' | 'id'>) => {
    if (p.kind === 'force') {
      const force = design.forces.find((f) => f.id === p.id)
      return force === undefined ? `Unknown force "${p.id}"` : `Force: ${force.name}`
    }
    const role = design.roles.find((r) => r.id === p.id)
    if (role === undefined) return `Unknown role "${p.id}"`
    const force = design.forces.find((f) => f.id === role.forceId)
    return `Role: ${role.name}${force === undefined ? '' : ` (${force.name})`}`
  }
  const present = new Set(room.participants.map((p) => `${p.kind}:${p.id}`))
  const choices = [
    ...forces.map((f) => ({ kind: 'force' as const, id: f.id })),
    ...roles.map((r) => ({ kind: 'role' as const, id: r.id })),
  ]
    .map((entry) => ({ ...entry, value: `${entry.kind}:${entry.id}`, label: nameOf(entry) }))
    .filter((c) => !present.has(c.value))
  const [pick, setPick] = useState('')
  const [access, setAccess] = useState<Participant['access']>('write')
  const picked = choices.find((c) => c.value === pick) ?? choices[0]

  return (
    <fieldset className="wrx-admin-fieldset" aria-describedby={`${id}-rules`}>
      <legend>Participants</legend>
      <p className="wrx-admin-hint" id={`${id}-rules`}>
        A role entry overrides its force&rsquo;s entry. Umpire-force roles can always read and
        write; observers can only ever read.
      </p>
      {room.participants.length === 0 ? (
        <p className="wrx-admin-muted">No participants yet.</p>
      ) : (
        <table className="wrx-admin-participants">
          <caption className="wrx-admin-visually-hidden">Participants of {room.name}</caption>
          <thead>
            <tr>
              <th scope="col">Participant</th>
              <th scope="col">Access</th>
              <th scope="col">
                <span className="wrx-admin-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {room.participants.map((p, i) => {
              const name = nameOf(p)
              return (
                <tr key={`${p.kind}:${p.id}`}>
                  <th scope="row">
                    {name}
                    <IssueList issues={issuesAt(`${path}[${i}]`)} />
                  </th>
                  <td>
                    <select
                      className="wrx-admin-input"
                      aria-label={`Access for ${name}`}
                      value={p.access}
                      onChange={(e) => {
                        onSet({ ...p, access: e.target.value === 'read' ? 'read' : 'write' })
                      }}
                    >
                      <option value="write">{ACCESS_LABEL.write}</option>
                      <option value="read">{ACCESS_LABEL.read}</option>
                    </select>
                  </td>
                  <td>
                    <Button
                      variant="quiet"
                      aria-label={`Remove ${name}`}
                      onClick={() => {
                        onRemove(p.kind, p.id)
                      }}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <IssueList issues={issuesAt(path).filter((i) => i.path === path)} />
      {picked === undefined ? (
        <p className="wrx-admin-muted">Every force and role is already listed.</p>
      ) : (
        <div className="wrx-admin-add" role="group" aria-label="Add a participant">
          <div className="wrx-admin-field">
            <label htmlFor={`${id}-pick`}>Add participant</label>
            <select
              id={`${id}-pick`}
              className="wrx-admin-input"
              value={picked.value}
              onChange={(e) => {
                setPick(e.target.value)
              }}
            >
              {(['force', 'role'] as const).map((group) => {
                const options = choices.filter((c) => c.kind === group)
                return options.length === 0 ? null : (
                  <optgroup key={group} label={group === 'force' ? 'Forces' : 'Roles'}>
                    {options.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
          </div>
          <div className="wrx-admin-field">
            <label htmlFor={`${id}-access`}>With access</label>
            <select
              id={`${id}-access`}
              className="wrx-admin-input"
              value={access}
              onChange={(e) => {
                setAccess(e.target.value === 'read' ? 'read' : 'write')
              }}
            >
              <option value="write">{ACCESS_LABEL.write}</option>
              <option value="read">{ACCESS_LABEL.read}</option>
            </select>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              onSet({ kind: picked.kind, id: picked.id, access })
              setPick('')
            }}
          >
            Add participant
          </Button>
        </div>
      )}
    </fieldset>
  )
}
