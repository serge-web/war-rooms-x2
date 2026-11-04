// The admin's world-state editor in the map room (ADM-44, ADM-45, ADM-46, R25, R26; WP 5.6): the
// parts the map panel adds for the admin's own game view. The draft's banner says that unpublished
// edits exist and that they are held only in this browser; "Publish world state" shows the change
// summary and sends the draft as one full-state message; "Discard draft" removes it. Every
// confirmation is inline in the panel, not a modal, so it works in a popped-out map (PLY-4).
import { diffSize } from '@wrx/domain'
import type { WorldEditResult, WorldStateDiff } from '@wrx/domain'
import { newEntityId } from '@wrx/schemas'
import type { Force, WorldAsset, WorldState } from '@wrx/schemas'
import { Banner, Button } from '@wrx/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { WorldStateSummary } from './change-summary.tsx'
import { sizeRefusal } from './world-draft.tsx'

/** What the map panel needs to edit (from `useAdminWorldDraft`, or a test). */
export interface MapEditing {
  /** The draft differs from the published state: there are unpublished edits (ADM-45). */
  readonly dirty: boolean
  /** A draft is held in this browser, even one with no differences. */
  readonly hasDraft: boolean
  /** From the published state to the draft (ADM-46). */
  readonly diff: WorldStateDiff
  /** The state a publish now would send, its turn the current one. */
  readonly toPublish: WorldState | undefined
  /** A world state has been published to the room. */
  readonly anyPublished: boolean
  /** A newer state was published since the draft started. */
  readonly stale: boolean
  /** The state the draft started from is gone from the map room, e.g. after a reset. */
  readonly orphaned?: boolean | undefined
  /** Why the browser did not keep the last edit, if it did not. */
  readonly saveProblem?: string | undefined
  /** A stored draft that could not be read, and was set aside. */
  readonly unreadable?: string | undefined
  /** Applies an edit to the draft; returns why it was refused. */
  readonly onEdit: (change: (state: WorldState) => WorldEditResult) => string | undefined
  readonly onDiscard: () => void
  /** Publishes the draft on its own; resolves with why it failed, or undefined. */
  readonly onPublish: () => Promise<string | undefined>
}

/** A new asset's starting values: the first force that is not the umpire's, at `at`. */
export function newAsset(
  forces: readonly Force[],
  at: { readonly lat: number; readonly lon: number },
  id: string = newEntityId(),
): WorldAsset {
  const force = forces.find((f) => !f.isUmpire) ?? forces[0]
  return {
    id,
    forceId: force?.id ?? '',
    title: '',
    category: '',
    // A friendly ground unit; the admin sets the real code.
    sidc: 'SFGPU----------',
    lat: at.lat,
    lon: at.lon,
    state: 'operational',
    health: 100,
    fuel: 100,
  }
}

/**
 * The draft's banner: unpublished edits, held only in this browser (ADM-45, R25). A polite
 * status, not an alert, so a drag that changes the count is not announced over the map.
 */
export function DraftBanner({ editing }: { readonly editing: MapEditing }) {
  const problems = (
    <>
      {editing.saveProblem === undefined ? null : (
        <Banner tone="danger" title="This browser did not keep your last edit">
          It is shown until you reload, but not saved: {editing.saveProblem}. Publish soon, or free
          some browser storage.
        </Banner>
      )}
      {editing.unreadable === undefined ? null : (
        <Banner tone="warning" title="A saved draft could not be read">
          {editing.unreadable}; your next edit starts again from the published world state.
        </Banner>
      )}
    </>
  )
  if (!editing.dirty) {
    return (
      <>
        {problems}
        <p className="wrx-map__draft-note">
          {editing.anyPublished
            ? 'Edits you make are kept as a draft in this browser until you publish them.'
            : 'No world state has been published yet. Add assets to set up the starting state, then publish it.'}
        </p>
      </>
    )
  }
  const n = diffSize(editing.diff)
  return (
    <>
      {problems}
      <Banner
        className="wrx-map__draft"
        tone="info"
        title={`Unpublished edits: ${n.toLocaleString('en-GB')} ${n === 1 ? 'asset' : 'assets'} changed`}
      >
        Players do not see them yet. The draft is held only in this browser: clearing its data or
        changing device loses it. Publish it now, or with the next phase change.
        {editing.stale
          ? ' A newer world state was published since this draft began; publishing replaces it with your draft.'
          : null}
      </Banner>
      {editing.orphaned === true ? (
        <Banner tone="warning" title="This draft may belong to an earlier game">
          It began from a world state that the map room no longer holds, so the game may have been
          reset since. Check every asset before you publish, or discard the draft.
        </Banner>
      ) : null}
    </>
  )
}

/** "Publish world state?": the change summary, then the publish (ADM-46). */
export function PublishPanel({
  editing,
  forces,
  onClose,
}: {
  readonly editing: MapEditing
  readonly forces: readonly Force[]
  readonly onClose: () => void
}) {
  const headingId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    mounted.current = true
    heading.current?.focus()
    return () => {
      mounted.current = false
    }
  }, [])
  const state = editing.toPublish
  const tooLarge = state === undefined ? undefined : sizeRefusal(state)
  const publish = async () => {
    if (busy || !editing.dirty || tooLarge !== undefined) return
    setBusy(true)
    setError(undefined)
    const problem = await editing.onPublish()
    if (!mounted.current) return
    setBusy(false)
    if (problem === undefined) onClose()
    else setError(problem)
  }
  return (
    <section className="wrx-map__confirm" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="wrx-map__details-title">
        Publish world state?
      </h3>
      {!editing.dirty || state === undefined ? (
        <p>
          Your draft has no changes from the published world state: there is nothing to publish.
        </p>
      ) : (
        <>
          <p>
            Every player’s map changes to this world state at once, for turn {state.turn}. The turn
            does not change.
          </p>
          <WorldStateSummary diff={editing.diff} state={state} forces={forces} />
        </>
      )}
      {tooLarge === undefined ? null : (
        <p className="wrx-field__error" role="alert">
          Not publishable: {tooLarge}
        </p>
      )}
      {error === undefined ? null : (
        <p className="wrx-field__error" role="alert">
          Not published: {error}
        </p>
      )}
      <div className="wrx-map__details-actions">
        <Button
          size="small"
          variant="primary"
          busy={busy}
          disabled={!editing.dirty || tooLarge !== undefined}
          onClick={() => {
            void publish()
          }}
        >
          Publish world state
        </Button>
        <Button size="small" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

/** A confirmation in the side panel: discard the draft, or delete an asset. */
export function ConfirmPanel({
  title,
  text,
  action,
  onConfirm,
  onClose,
}: {
  readonly title: string
  readonly text: string
  readonly action: string
  readonly onConfirm: () => void
  readonly onClose: () => void
}) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <section className="wrx-map__confirm" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="wrx-map__details-title">
        {title}
      </h3>
      <p>{text}</p>
      <div className="wrx-map__details-actions">
        <Button size="small" variant="danger" onClick={onConfirm}>
          {action}
        </Button>
        <Button size="small" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
