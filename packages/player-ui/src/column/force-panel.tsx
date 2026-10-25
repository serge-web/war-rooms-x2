// The force panel at the bottom of the out-of-game column (PLY-25, PLY-35): in the role's force
// theme, the force logo, the role name and the force's objectives in Markdown. White Force roles
// and the admin (the umpire) may choose any force; the admin and White Force roles that are not
// observers may also edit its objectives with a preview. The edit is published through the
// store, one item per author, and readers show the newest (§3 rule 14).
import { UMPIRE_NAME } from '@wrx/domain'
import type { DomainResult } from '@wrx/domain'
import { useForces, useMe, useObjectives, useSessionStore } from '@wrx/hooks'
import { LIMITS } from '@wrx/schemas'
import { AssetImage, ForceThemeScope, useForceTheme } from '@wrx/theme/react'
import { Button, Dialog, DialogClose, MarkdownView, Spinner } from '@wrx/ui'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { errorText } from './errors.ts'

// ---- Objectives editor (PLY-35) -----------------------------------------------------------------

export interface ObjectivesEditorCoreProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly forceName: string
  /** The text the editor starts from: the objectives as currently shown. */
  readonly initial: string
  /** Resolves with an error message, or undefined once published (the editor then closes). */
  readonly onPublish: (markdown: string) => Promise<string | undefined>
}

/** A Markdown text box with a live preview of what the force will see (PLY-35). */
export function ObjectivesEditorCore({
  open,
  onOpenChange,
  forceName,
  initial,
  onPublish,
}: ObjectivesEditorCoreProps) {
  const id = useId()
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // Each opening starts from the objectives as they are now.
  useEffect(() => {
    if (open) {
      setText(initial)
      setError(undefined)
      setBusy(false)
    }
    // `initial` is read on opening only, so a live update does not wipe an edit in progress.
  }, [open])
  const publish = async () => {
    setBusy(true)
    setError(undefined)
    const problem = await onPublish(text)
    if (!mounted.current) return
    setBusy(false)
    if (problem === undefined) onOpenChange(false)
    else setError(problem)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={`Edit ${forceName} objectives`}
      description={`Publishing updates ${forceName}'s force panel straight away.`}
      actions={
        <>
          <DialogClose>
            <Button disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => {
              void publish()
            }}
          >
            Publish objectives
          </Button>
        </>
      }
    >
      <div className="wrx-objectives-editor">
        <div className="wrx-field wrx-objectives-editor__write">
          <label className="wrx-field__label" htmlFor={`${id}-text`}>
            Objectives (Markdown)
          </label>
          <textarea
            id={`${id}-text`}
            className="wrx-field__input wrx-objectives-editor__input"
            rows={12}
            maxLength={LIMITS.objectivesChars}
            value={text}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : `${id}-error`}
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
        </div>
        <div className="wrx-objectives-editor__preview">
          <h3 className="wrx-field__label">Preview</h3>
          {text.trim() === '' ? (
            <p className="wrx-empty">No objectives: the force will see none.</p>
          ) : (
            <MarkdownView markdown={text} label="Objectives preview" />
          )}
        </div>
      </div>
      {error === undefined ? null : (
        <p id={`${id}-error`} className="wrx-field__error" role="alert">
          Not published: {error}
        </p>
      )}
    </Dialog>
  )
}

// ---- The panel ------------------------------------------------------------------------------------

export interface ForceOption {
  readonly id: string
  readonly name: string
}

export interface ForcePanelCoreProps {
  /** The logged-in role's name, or "Umpire" for the admin. */
  readonly roleName: string
  /** The role's force; the White Force for the admin. */
  readonly forceName?: string | undefined
  /** The force logo, if the theme has one. */
  readonly logo?: ReactNode
  /** Whose objectives are shown. */
  readonly objectivesForce: ForceOption | undefined
  /** The objectives' Markdown; undefined when the force has none. */
  readonly objectives: string | undefined
  readonly loading?: boolean
  readonly problem?: string | undefined
  /** The White Force and the admin: choose whose objectives to show (PLY-35). */
  readonly forceChoice?:
    | {
        readonly forces: readonly ForceOption[]
        readonly onSelect: (forceId: string) => void
      }
    | undefined
  /** The admin and White Force non-observers: opens the editor for the shown force (PLY-35). */
  readonly onEdit?: (() => void) | undefined
}

export function ForcePanelCore({
  roleName,
  forceName,
  logo,
  objectivesForce,
  objectives,
  loading = false,
  problem,
  forceChoice,
  onEdit,
}: ForcePanelCoreProps) {
  const id = useId()
  const own = objectivesForce === undefined || objectivesForce.name === forceName
  const title =
    objectivesForce === undefined
      ? 'Objectives'
      : own
        ? 'Objectives'
        : `${objectivesForce.name} objectives`
  return (
    <div className="wrx-force-panel__inner">
      <div className="wrx-force-panel__identity">
        {logo === undefined || logo === null ? null : (
          <div className="wrx-force-panel__logo">{logo}</div>
        )}
        <div>
          <h2 className="wrx-force-panel__role">{roleName}</h2>
          {forceName === undefined ? null : <p className="wrx-force-panel__force">{forceName}</p>}
        </div>
      </div>
      {forceChoice === undefined || forceChoice.forces.length === 0 ? null : (
        <div className="wrx-field wrx-force-panel__choice">
          <label className="wrx-field__label" htmlFor={`${id}-force`}>
            Show objectives for
          </label>
          <select
            id={`${id}-force`}
            className="wrx-field__input"
            value={objectivesForce?.id ?? ''}
            onChange={(event) => {
              forceChoice.onSelect(event.target.value)
            }}
          >
            {forceChoice.forces.map((force) => (
              <option key={force.id} value={force.id}>
                {force.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <section className="wrx-force-panel__objectives" aria-labelledby={`${id}-objectives`}>
        <div className="wrx-force-panel__objectives-header">
          <h3 id={`${id}-objectives`} className="wrx-column__heading">
            {title}
          </h3>
          {onEdit === undefined || objectivesForce === undefined ? null : (
            <Button
              size="small"
              onClick={onEdit}
              aria-label={`Edit ${objectivesForce.name} objectives`}
            >
              Edit
            </Button>
          )}
        </div>
        {loading ? (
          <Spinner label="Loading objectives" />
        ) : problem !== undefined ? (
          <p className="wrx-empty">Objectives cannot be shown: {problem}</p>
        ) : objectives === undefined || objectives.trim() === '' ? (
          <p className="wrx-empty">No objectives yet.</p>
        ) : (
          <MarkdownView markdown={objectives} className="wrx-force-panel__markdown" />
        )}
      </section>
    </div>
  )
}

/** Shows a force's logo from its theme (inherits the game logo when it has none, §3 rule 11). */
function ForceLogo({ forceId, alt }: { readonly forceId: string; readonly alt: string }) {
  const { theme } = useForceTheme(forceId)
  if (theme.logoAssetId === undefined) return null
  return <AssetImage assetId={theme.logoAssetId} alt={alt} className="wrx-force-panel__img" />
}

/** The force panel over the pane's store (PLY-25, PLY-35); needs a SessionStoreProvider. */
export function ForcePanel() {
  const store = useSessionStore()
  const me = useMe().data
  const forces = useForces().data
  // White Force observers read every force's objectives; only editors edit (PLY-35, F5).
  const canChoose = me.isUmpire || me.identity.isAdmin
  const canEdit = me.canEditObjectives
  const ownForce = me.force
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)

  // Whose objectives: the role's own force; the White Force may pick another (PLY-35).
  const shownId =
    canChoose && chosen !== undefined && forces.some((f) => f.id === chosen)
      ? chosen
      : (ownForce?.id ?? (canChoose ? forces[0]?.id : undefined))
  const shown =
    forces.find((f) => f.id === shownId) ?? (shownId === ownForce?.id ? ownForce : undefined)
  const objectives = useObjectivesOf(shownId)

  const roleName = me.role?.name ?? (me.identity.isAdmin ? UMPIRE_NAME : '')
  const option = shown === undefined ? undefined : { id: shown.id, name: shown.name }
  const core = (
    <ForcePanelCore
      roleName={roleName}
      forceName={ownForce?.name}
      logo={
        ownForce === undefined ? undefined : (
          <ForceLogo forceId={ownForce.id} alt={`${ownForce.name} logo`} />
        )
      }
      objectivesForce={option}
      objectives={objectives.markdown}
      loading={objectives.loading}
      problem={objectives.problem}
      forceChoice={
        canChoose
          ? {
              forces: forces.map((f) => ({ id: f.id, name: f.name })),
              onSelect: setChosen,
            }
          : undefined
      }
      onEdit={
        canEdit
          ? () => {
              setEditing(true)
            }
          : undefined
      }
    />
  )
  const editor =
    canEdit && option !== undefined ? (
      <ObjectivesEditorCore
        open={editing}
        onOpenChange={setEditing}
        forceName={option.name}
        initial={objectives.markdown ?? ''}
        onPublish={async (markdown) =>
          publishResult(await store.publishObjectives(option.id, markdown))
        }
      />
    ) : null
  return (
    <>
      {ownForce === undefined ? (
        <section className="wrx-force-panel" aria-label="Force panel">
          {core}
        </section>
      ) : (
        // The role's force theme, on this panel only (PLY-25, PLY-26).
        <ForceThemeScope
          forceId={ownForce.id}
          as="section"
          className="wrx-force-panel"
          aria-label="Force panel"
          data-force={ownForce.id}
        >
          {core}
        </ForceThemeScope>
      )}
      {editor}
    </>
  )
}

/** A force's objectives as display data; nothing when no force is chosen. */
function useObjectivesOf(forceId: string | undefined): {
  readonly markdown: string | undefined
  readonly loading: boolean
  readonly problem: string | undefined
} {
  // Hooks cannot be skipped, so with no force an id no node has is read: its snapshot is empty.
  const snapshot = useObjectives(forceId ?? '')
  if (forceId === undefined) return { markdown: undefined, loading: false, problem: undefined }
  if (snapshot.data !== undefined) {
    return { markdown: snapshot.data.markdown, loading: false, problem: undefined }
  }
  if (snapshot.status === 'loading')
    return { markdown: undefined, loading: true, problem: undefined }
  // A force with no objectives yet has no node, or an empty one: not a problem.
  if (snapshot.error === undefined || snapshot.error.code === 'not-found') {
    return { markdown: undefined, loading: false, problem: undefined }
  }
  return { markdown: undefined, loading: false, problem: errorText(snapshot.error) }
}

function publishResult(result: DomainResult<void>): string | undefined {
  return result.ok ? undefined : errorText(result.error)
}
