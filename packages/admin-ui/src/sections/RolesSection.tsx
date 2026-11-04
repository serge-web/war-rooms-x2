// Roles (ADM-5): name, login name, observer flag and force; reordered within a force by drag and
// drop (ADM-8) and moved between forces with the Force field, keeping their ids. A role's id is a
// GUID nobody sees; its login name is the XMPP account name a player types (§3 rule 1).
// Passwords are set at publish time (WP 2.3) and never stored in the design (§3 rule 9).
import { byOrderThenId } from '@wrx/domain'
import { LIMITS } from '@wrx/schemas'
import type { Role } from '@wrx/schemas'
import { useId, useState } from 'react'
import {
  AddForm,
  Button,
  CheckboxField,
  ConfirmDialog,
  EditForm,
  IssueList,
  ListAndForm,
  Notice,
  SectionFrame,
  SelectField,
  SortableList,
  TextField,
} from '../components/index.ts'
import {
  addRole,
  changeLoginName,
  deleteRole,
  isRolePublished,
  moveRole,
  referencesTo,
  updateRole,
} from '../draft/index.ts'
import type { Draft } from '../draft/index.ts'
import { NodeNamesNotice } from './common.tsx'
import type { SectionProps } from './common.tsx'
import { ForceMark } from './ForcesSection.tsx'
import { ReferenceList } from './ReferenceList.tsx'

export function RolesSectionCore({ draft, validation, onChange }: SectionProps) {
  const { forces, roles } = draft.design
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const selected = roles.find((r) => r.id === chosen) ?? roles[0]
  const [newForce, setNewForce] = useState<string | undefined>(undefined)
  const addTo = forces.find((f) => f.id === newForce)?.id ?? forces[0]?.id
  const orphans = roles.filter((r) => !forces.some((f) => f.id === r.forceId))

  const list = (
    <>
      {forces.length === 0 && <p className="wrx-admin-muted">Add a force before adding roles.</p>}
      {forces.map((force) => (
        <div key={force.id} className="wrx-admin-group">
          <h3 className="wrx-admin-group-title">
            {force.name} <ForceMark force={force} />
          </h3>
          <SortableList
            label={`Roles in ${force.name}`}
            items={roles
              .filter((r) => r.forceId === force.id)
              .sort(byOrderThenId)
              .map((r) => ({ ...r, label: r.name }))}
            selectedId={selected?.id}
            onSelect={setChosen}
            onMove={(id, index) => {
              onChange(moveRole(draft, id, force.id, index))
            }}
            decorate={(r) => r.isObserver && <span className="wrx-admin-tag">Observer</span>}
            emptyText="No roles in this force."
          />
        </div>
      ))}
      {orphans.length > 0 && (
        <div className="wrx-admin-group">
          <h3 className="wrx-admin-group-title">Roles of unknown forces</h3>
          <ul className="wrx-admin-list">
            {orphans.map((r) => (
              <li key={r.id} className="wrx-admin-list-row">
                <button
                  type="button"
                  className="wrx-admin-list-name"
                  aria-current={r.id === selected?.id ? 'true' : undefined}
                  onClick={() => {
                    setChosen(r.id)
                  }}
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {addTo !== undefined && (
        <AddForm
          label="New role name"
          buttonLabel="Add role"
          onAdd={(name) => {
            const added = addRole(draft, addTo, name)
            onChange(added.draft)
            setChosen(added.id)
          }}
        >
          <SelectField
            label="In force"
            value={addTo}
            options={forces.map((f) => ({ value: f.id, label: f.name }))}
            onChange={setNewForce}
          />
        </AddForm>
      )}
    </>
  )

  return (
    <SectionFrame title="Roles" intro={<NodeNamesNotice kind="role" />}>
      <ListAndForm
        listLabel="Role list"
        list={list}
        form={
          selected === undefined ? (
            <p className="wrx-admin-muted">Add a role to edit it.</p>
          ) : (
            <RoleForm
              key={selected.id}
              role={selected}
              draft={draft}
              validation={validation}
              onChange={onChange}
            />
          )
        }
      />
    </SectionFrame>
  )
}

function RoleForm({ role, draft, validation, onChange }: SectionProps & { readonly role: Role }) {
  const design = draft.design
  const at = `roles[${design.roles.findIndex((r) => r.id === role.id)}]`
  const refs = referencesTo(design, 'roles', role.id)
  const forceKnown = design.forces.some((f) => f.id === role.forceId)
  return (
    <EditForm
      title={`Role: ${role.name.trim() === '' ? '(unnamed)' : role.name}`}
      actions={
        <ConfirmDialog
          triggerLabel={`Delete ${role.name}`}
          title={`Delete ${role.name}?`}
          confirmLabel="Delete role"
          onConfirm={() => {
            onChange(deleteRole(draft, role.id))
          }}
        >
          <Notice tone="warning" title="Message history stays.">
            Messages this role has sent stay in room history, under its login name{' '}
            <code>{role.loginName}</code>, shown with its last name and marked deleted. Once the
            role has been published, the login name is never given to another role.
          </Notice>
          <ReferenceList references={refs} none="No room names this role directly." />
        </ConfirmDialog>
      }
    >
      <LoginNameField draft={draft} role={role} onChange={onChange} />
      <IssueList issues={[...validation.at(`${at}.id`), ...validation.at(`${at}.loginName`)]} />
      <TextField
        label="Name"
        value={role.name}
        maxLength={LIMITS.nameChars}
        issues={validation.at(`${at}.name`)}
        onChange={(name) => {
          onChange(updateRole(draft, role.id, { name }))
        }}
      />
      <SelectField
        label="Force"
        hint="Moving a role keeps its login name; its access follows the new force."
        value={role.forceId}
        options={[
          ...design.forces.map((f) => ({ value: f.id, label: f.name })),
          ...(forceKnown ? [] : [{ value: role.forceId, label: `${role.forceId} (unknown)` }]),
        ]}
        issues={validation.at(`${at}.forceId`)}
        onChange={(forceId) => {
          onChange(moveRole(draft, role.id, forceId))
        }}
      />
      <CheckboxField
        label="Observer"
        hint="Observers read but never post, in every room they can see."
        checked={role.isObserver}
        onChange={(isObserver) => {
          onChange(updateRole(draft, role.id, { isObserver }))
        }}
      />
      <p className="wrx-admin-muted">
        Passwords are set when the design is published, and are never stored in the design.
      </p>
    </EditForm>
  )
}

/** The login name: editable until the role is first published (ADM-5), then fixed. */
function LoginNameField({
  draft,
  role,
  onChange,
}: {
  readonly draft: Draft
  readonly role: Role
  readonly onChange: (next: Draft) => void
}) {
  const id = useId()
  const [text, setText] = useState(role.loginName)
  const [error, setError] = useState<string | undefined>(undefined)
  if (isRolePublished(draft, role.id)) {
    return (
      <TextField
        label="Login name"
        value={role.loginName}
        readOnly
        hint="Fixed: this role has been published, and the server cannot rename an account. To change it, delete the role and add a new one."
        onChange={() => undefined}
      />
    )
  }
  const apply = () => {
    const result = changeLoginName(draft, role.id, text.trim())
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(undefined)
    onChange(result.value)
  }
  return (
    <div className="wrx-admin-field">
      <label htmlFor={id}>Login name</label>
      <div className="wrx-admin-inline">
        <input
          id={id}
          className="wrx-admin-input"
          type="text"
          value={text}
          spellCheck={false}
          maxLength={LIMITS.slugChars}
          aria-describedby={`${id}-hint${error === undefined ? '' : ` ${id}-error`}`}
          aria-invalid={error !== undefined || undefined}
          onChange={(e) => {
            setText(e.target.value)
            setError(undefined)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              apply()
            }
          }}
        />
        <Button disabled={text.trim() === role.loginName} onClick={apply}>
          Change login name
        </Button>
      </div>
      <div className="wrx-admin-hint" id={`${id}-hint`}>
        The role&rsquo;s XMPP account name, which players type to log in. It can change until the
        first publish, then it is fixed.
      </div>
      {error !== undefined && (
        <p className="wrx-admin-issue wrx-admin-issue-error" id={`${id}-error`} role="alert">
          Error: {error}
        </p>
      )}
    </div>
  )
}
