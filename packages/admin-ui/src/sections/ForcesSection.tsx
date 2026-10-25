// Forces (ADM-4): name, colour, icon and umpire flag, reordered by drag and drop (ADM-8), with
// each force's objectives (ADM-23).
import { LIMITS } from '@wrx/schemas'
import type { Force } from '@wrx/schemas'
import { useState } from 'react'
import {
  AddForm,
  CheckboxField,
  ColourField,
  ConfirmDialog,
  EditForm,
  IssueList,
  ListAndForm,
  MarkdownEditor,
  SectionFrame,
  SelectField,
  SortableList,
  TextField,
} from '../components/index.ts'
import {
  addForce,
  deleteForce,
  moveForce,
  objectivesOf,
  referencesTo,
  setObjectives,
  updateForce,
} from '../draft/index.ts'
import { IdLine, NodeNamesNotice } from './common.tsx'
import type { SectionProps } from './common.tsx'
import { ReferenceList } from './ReferenceList.tsx'

export interface ForcesSectionProps extends SectionProps {
  /** The clock for objectives' `updatedAt`. */
  readonly now?: () => Date
}

export function ForcesSectionCore({
  draft,
  validation,
  onChange,
  now = () => new Date(),
}: ForcesSectionProps) {
  const forces = draft.design.forces
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const selected = forces.find((f) => f.id === chosen) ?? forces[0]
  const collectionIssues = validation.issues.filter((i) => i.path === 'forces')

  return (
    <SectionFrame title="Forces" intro={<NodeNamesNotice kind="force" />}>
      <IssueList issues={collectionIssues} />
      <ListAndForm
        listLabel="Force list"
        list={
          <>
            <SortableList
              label="Forces"
              items={forces.map((f) => ({ ...f, label: f.name }))}
              selectedId={selected?.id}
              onSelect={setChosen}
              onMove={(id, index) => {
                onChange(moveForce(draft, id, index))
              }}
              decorate={(f) => <ForceMark force={f} />}
              emptyText="No forces yet."
            />
            <AddForm
              label="New force name"
              buttonLabel="Add force"
              onAdd={(name) => {
                const added = addForce(draft, name)
                onChange(added.draft)
                setChosen(added.id)
              }}
            />
          </>
        }
        form={
          selected === undefined ? (
            <p className="wrx-admin-muted">Add a force to edit it.</p>
          ) : (
            <ForceForm
              key={selected.id}
              force={selected}
              umpireCount={forces.filter((f) => f.isUmpire).length}
              {...{ draft, validation, onChange, now }}
            />
          )
        }
      />
    </SectionFrame>
  )
}

/** A colour swatch, and the umpire flag in words (not by colour alone). */
export function ForceMark({ force }: { readonly force: Force }) {
  return (
    <>
      <span className="wrx-admin-swatch" style={{ background: force.colour }} aria-hidden="true" />
      {force.isUmpire && <span className="wrx-admin-tag">Umpire flag</span>}
    </>
  )
}

function ForceForm({
  force,
  umpireCount,
  draft,
  validation,
  onChange,
  now,
}: SectionProps & {
  readonly force: Force
  readonly umpireCount: number
  readonly now: () => Date
}) {
  const design = draft.design
  const at = `forces[${design.forces.findIndex((f) => f.id === force.id)}]`
  const objectivesIndex = design.objectives.findIndex((o) => o.forceId === force.id)
  const refs = referencesTo(design, 'forces', force.id)
  const blocked = refs.some((r) => r.blocks)
  const update = (patch: Parameters<typeof updateForce>[2]) => {
    onChange(updateForce(draft, force.id, patch))
  }
  return (
    <EditForm
      title={`Force: ${force.name.trim() === '' ? '(unnamed)' : force.name}`}
      actions={
        <ConfirmDialog
          triggerLabel={`Delete ${force.name}`}
          title={blocked ? `${force.name} cannot be deleted yet` : `Delete ${force.name}?`}
          confirmLabel="Delete force"
          canConfirm={!blocked}
          onConfirm={() => {
            const result = deleteForce(draft, force.id)
            if (result.ok) onChange(result.value)
          }}
        >
          <ReferenceList
            references={refs}
            none="Nothing else refers to this force."
            footer={
              blocked
                ? 'Move its roles to another force, or delete them, first.'
                : 'Its id is never reused.'
            }
          />
        </ConfirmDialog>
      }
    >
      <IdLine id={force.id} />
      <TextField
        label="Name"
        value={force.name}
        maxLength={LIMITS.nameChars}
        issues={validation.at(`${at}.name`)}
        onChange={(name) => {
          update({ name })
        }}
      />
      <ColourField
        label="Colour"
        hint="Marks this force's message authors. Not a theme colour."
        value={force.colour}
        issues={validation.at(`${at}.colour`)}
        onChange={(colour) => {
          update({ colour })
        }}
      />
      <SelectField
        label="Icon"
        hint={
          design.assets.length === 0
            ? 'No images yet; upload them in Themes.'
            : 'An uploaded image, by id.'
        }
        value={force.iconAssetId ?? ''}
        options={[
          { value: '', label: 'No icon' },
          ...design.assets.map((a) => ({ value: a.id, label: `${a.id} (${a.mimeType})` })),
          ...(force.iconAssetId !== undefined &&
          !design.assets.some((a) => a.id === force.iconAssetId)
            ? [{ value: force.iconAssetId, label: `${force.iconAssetId} (missing)` }]
            : []),
        ]}
        issues={validation.at(`${at}.iconAssetId`)}
        onChange={(id) => {
          update({ iconAssetId: id === '' ? null : id })
        }}
      />
      <CheckboxField
        label="Umpire flag (White Force)"
        hint="You play as this force's umpire. Its roles write in every room; its observers read only the rooms that name them, or every room. Exactly one force has this flag: setting it here clears it elsewhere."
        checked={force.isUmpire}
        issues={
          force.isUmpire && umpireCount > 1
            ? [
                {
                  severity: 'warning',
                  path: `${at}.isUmpire`,
                  message: `${umpireCount} forces carry the umpire flag; exactly one is expected`,
                },
              ]
            : []
        }
        onChange={(isUmpire) => {
          update({ isUmpire })
        }}
      />
      <MarkdownEditor
        label="Objectives"
        hint={`Markdown. Only ${force.name}'s roles, the White Force and you can read them; you and White Force roles that are not observers can edit them in play.`}
        value={objectivesOf(design, force.id)?.markdown ?? ''}
        maxLength={LIMITS.objectivesChars}
        issues={objectivesIndex === -1 ? [] : validation.at(`objectives[${objectivesIndex}]`)}
        onChange={(markdown) => {
          onChange(setObjectives(draft, force.id, markdown, now()))
        }}
      />
    </EditForm>
  )
}
