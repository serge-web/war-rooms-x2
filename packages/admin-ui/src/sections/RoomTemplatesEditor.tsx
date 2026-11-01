// A chat room's templates (WP 4.3, TD3, TD4, TPL-2): whether free text is allowed, and which
// templates each force or role may use, as a table of forces and roles × templates beside the
// participants editor. Rows: the room's participants, any force or role the config already names,
// and any the admin adds. The rule (provisional answer 4): a role entry adds to its force's; the
// admin and White Force roles that are not observers may use every template named here.
import { byOrderThenId } from '@wrx/domain'
import type { ChatRoomConfig, DesignFile, DesignIssue, Room, TemplateEntry } from '@wrx/schemas'
import { useId, useState } from 'react'
import { Button, CheckboxField, IssueList } from '../components/index.ts'
import { sortedRoles } from '../draft/index.ts'

export interface RoomTemplatesEditorProps {
  readonly design: DesignFile
  readonly room: Room
  readonly config: ChatRoomConfig
  readonly issues: readonly DesignIssue[]
  readonly onFreeText: (freeText: boolean) => void
  readonly onEntry: (
    kind: TemplateEntry['kind'],
    id: string,
    templateIds: readonly string[],
  ) => void
}

type Who = Pick<TemplateEntry, 'kind' | 'id'>

const keyOf = (w: Who) => `${w.kind}:${w.id}`

export function RoomTemplatesEditor({
  design,
  room,
  config,
  issues,
  onFreeText,
  onEntry,
}: RoomTemplatesEditorProps) {
  const id = useId()
  const [extra, setExtra] = useState<readonly Who[]>([])
  const forces = [...design.forces].sort(byOrderThenId)
  const roles = sortedRoles(design)
  const nameOf = (w: Who) => {
    if (w.kind === 'force') {
      const force = design.forces.find((f) => f.id === w.id)
      return force === undefined ? `Unknown force "${w.id}"` : `Force: ${force.name}`
    }
    const role = design.roles.find((r) => r.id === w.id)
    if (role === undefined) return `Unknown role "${w.id}"`
    const force = design.forces.find((f) => f.id === role.forceId)
    return `Role: ${role.name}${force === undefined ? '' : ` (${force.name})`}`
  }
  const rank = (w: Who) =>
    w.kind === 'force'
      ? forces.findIndex((f) => f.id === w.id)
      : forces.length + roles.findIndex((r) => r.id === w.id)
  const rows = new Map<string, Who>()
  for (const w of [...room.participants, ...config.templates, ...extra]) {
    rows.set(keyOf(w), { kind: w.kind, id: w.id })
  }
  const listed = [...rows.values()].sort((a, b) => rank(a) - rank(b))
  const choices = [
    ...forces.map((f): Who => ({ kind: 'force', id: f.id })),
    ...roles.map((r): Who => ({ kind: 'role', id: r.id })),
  ].filter((w) => !rows.has(keyOf(w)))
  const [pick, setPick] = useState('')
  const picked = choices.find((c) => keyOf(c) === pick) ?? choices[0]
  const templates = design.templates
  const entryOf = (w: Who) => config.templates.find((e) => e.kind === w.kind && e.id === w.id)

  return (
    <fieldset className="wrx-admin-fieldset" aria-describedby={`${id}-rules`}>
      <legend>Templates</legend>
      <p className="wrx-admin-hint" id={`${id}-rules`}>
        Which templates each force or role may use here. A role entry adds to its force&rsquo;s.
        White Force roles that are not observers, and you, may use every template ticked here;
        observers none. The server cannot enforce this: every client checks it.
      </p>
      <CheckboxField
        label="Free text allowed"
        hint="Off: players may send only templates in this room."
        checked={config.freeText}
        onChange={onFreeText}
      />
      {templates.length === 0 ? (
        <p className="wrx-admin-muted">
          The design has no templates yet: add them in the Templates section.
        </p>
      ) : listed.length === 0 ? (
        <p className="wrx-admin-muted">Add participants, or a force or role below.</p>
      ) : (
        <div
          className="wrx-admin-matrix-scroll"
          role="region"
          aria-label={`Templates in ${room.name}, scrollable`}
          tabIndex={0}
        >
          <table className="wrx-admin-participants wrx-room-templates">
            <caption className="wrx-admin-visually-hidden">
              Templates each force or role may use in {room.name}
            </caption>
            <thead>
              <tr>
                <th scope="col">Force or role</th>
                {templates.map((t) => (
                  <th key={t.id} scope="col">
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listed.map((w) => {
                const entry = entryOf(w)
                const name = nameOf(w)
                return (
                  <tr key={keyOf(w)}>
                    <th scope="row">{name}</th>
                    {templates.map((t) => {
                      const on = entry?.templateIds.includes(t.id) ?? false
                      return (
                        <td key={t.id}>
                          <input
                            type="checkbox"
                            aria-label={`${name} may use ${t.name}`}
                            checked={on}
                            onChange={(e) => {
                              const ids = entry?.templateIds ?? []
                              onEntry(
                                w.kind,
                                w.id,
                                e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id),
                              )
                            }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* Entries naming templates the design no longer has are design errors, listed here. */}
      <IssueList issues={issues} />
      {templates.length > 0 && picked !== undefined && (
        <div
          className="wrx-admin-add"
          role="group"
          aria-label="Add a force or role to the templates"
        >
          <div className="wrx-admin-field">
            <label htmlFor={`${id}-pick`}>Add a force or role</label>
            <select
              id={`${id}-pick`}
              className="wrx-admin-input"
              value={keyOf(picked)}
              onChange={(e) => {
                setPick(e.target.value)
              }}
            >
              {(['force', 'role'] as const).map((group) => {
                const options = choices.filter((c) => c.kind === group)
                return options.length === 0 ? null : (
                  <optgroup key={group} label={group === 'force' ? 'Forces' : 'Roles'}>
                    {options.map((c) => (
                      <option key={keyOf(c)} value={keyOf(c)}>
                        {nameOf(c)}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
          </div>
          <Button
            onClick={() => {
              setExtra([...extra, picked])
              setPick('')
            }}
          >
            Add row
          </Button>
        </div>
      )}
    </fieldset>
  )
}
