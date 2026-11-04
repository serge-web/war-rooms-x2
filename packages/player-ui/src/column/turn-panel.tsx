// The turn panel (PLY-55, PLY-36, ADM-43; WP 5.4): the top of the out-of-game column, in the
// wide column and in the narrow-window tab alike. It shows the turn number and phase from
// `game-state`, live, and what the phase means for this role (PLY-56). The admin, in its own game
// view, also gets the control that moves the game on, behind a confirmation; the server lets only
// the admin publish `game-state` (§3 rule 15), so no one else is offered it. The admin backend
// shows the same control, compact, in its header (`variant="bar"`).
//
// When the admin holds a world-state draft (WP 5.6, ADM-45), the confirmation shows its change
// summary (ADM-46) and the change publishes it first, its turn the next phase's; with no
// differences it says the world state is not published. If the world state went out and the
// phase change then failed (WP 5.9, review L3), the error says so, the draft is cleared as
// published, and the confirmation stays open so that confirming again moves only the phase.
import {
  diffWorldStates,
  isEmptyDiff,
  nextGameState,
  parseWorldDraft,
  phaseLabel,
  postingPaused,
  sameGameState,
  worldDraftKey,
} from '@wrx/domain'
import type { AdvancePhaseResult, WorldDraft } from '@wrx/domain'
import { useForces, useGameState, useMe, useSessionStore, useWorldState } from '@wrx/hooks'
import type { GameState } from '@wrx/schemas'
import { Button, Dialog, DialogClose, Spinner } from '@wrx/ui'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { WorldStateSummary } from '../map/change-summary.tsx'
import type { JustPublished } from '../map/draft-storage.ts'
import {
  draftForTurn,
  sizeRefusal,
  useDraftSnapshot,
  useMapRoomId,
  useWorldDraftStorage,
  worldPublishErrorText,
} from '../map/world-draft.tsx'
import { errorText } from './errors.ts'

export interface TurnPanelCoreProps {
  /** The turn state; undefined before a first publish, or while loading. */
  readonly state: GameState | undefined
  readonly loading?: boolean
  /** Why the turn state could not be read, if it could not. */
  readonly problem?: string | undefined
  /** Posting is paused for this role now (PLY-56). */
  readonly paused?: boolean
  /**
   * The admin's control (ADM-43): moves the game on from `from`. Resolves with an error message,
   * or undefined when the change went through. Without it, no control is offered.
   */
  readonly onAdvance?: ((from: GameState) => Promise<string | undefined>) | undefined
  /** More for the confirmation, e.g. the world-state change summary (WP 5.6). */
  readonly confirmDetails?: ReactNode
  /** The confirmation cannot be confirmed yet, e.g. the world state is too large (WP 5.6). */
  readonly confirmBlocked?: boolean
  /** Called when the confirmation closes: cancelled, or the change went through. */
  readonly onConfirmClosed?: (() => void) | undefined
  /** `column` (default) in the out-of-game column; `bar` in the admin backend's header. */
  readonly variant?: 'column' | 'bar'
}

/** "Turn 3". */
export function turnLabel(state: GameState): string {
  return `Turn ${String(state.turn)}`
}

/** The admin's button and the confirmation's title and action, for the next phase. */
export function advanceWords(state: GameState): {
  readonly action: string
  readonly title: string
  readonly description: string
} {
  const next = nextGameState(state)
  if (next === undefined) {
    return { action: '', title: '', description: '' }
  }
  if (next.phase === 'adjudication') {
    return {
      action: 'Start adjudication',
      title: 'Start adjudication?',
      description: `${turnLabel(state)} moves from planning to adjudication. Every role sees the change at once, and roles outside the White Force can no longer post until turn ${String(state.turn + 1)} planning.`,
    }
  }
  return {
    action: `Start ${turnLabel(next).toLowerCase()}`,
    title: `Start ${turnLabel(next).toLowerCase()}?`,
    description: `${turnLabel(state)} adjudication ends and ${turnLabel(next).toLowerCase()} planning begins. Every role sees the change at once, and every role that may post can post again.`,
  }
}

/** What the phase means for this role, under the turn and phase. */
function phaseNote(state: GameState, paused: boolean): string | undefined {
  if (state.phase !== 'adjudication') return undefined
  return paused
    ? 'The umpires are adjudicating. You can read your rooms; posting resumes when the next turn’s planning starts.'
    : 'Roles outside the White Force cannot post until the next turn’s planning starts.'
}

function AdvanceControl({
  state,
  onAdvance,
  confirmDetails,
  confirmBlocked,
  onConfirmClosed,
  bar,
}: {
  readonly state: GameState
  readonly onAdvance: (from: GameState) => Promise<string | undefined>
  readonly confirmDetails: ReactNode
  readonly confirmBlocked: boolean
  readonly onConfirmClosed: (() => void) | undefined
  readonly bar: boolean
}) {
  const [from, setFrom] = useState<GameState | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const next = nextGameState(state)
  if (next === undefined) return null
  const open = from !== undefined
  // The words come from the state the admin opened the confirmation on, which a change from
  // another admin tab does not rewrite; it disables the confirmation instead.
  const words = advanceWords(from ?? state)
  const moved = from !== undefined && !sameGameState(from, state)
  const close = () => {
    setFrom(undefined)
    onConfirmClosed?.()
  }
  const confirm = async () => {
    if (from === undefined || busy || moved || confirmBlocked) return
    setBusy(true)
    setError(undefined)
    const problem = await onAdvance(from)
    if (!mounted.current) return
    setBusy(false)
    if (problem === undefined) close()
    else setError(problem)
  }
  return (
    <>
      <Button
        size="small"
        // On the admin header's primary colour, the secondary button stands out.
        variant={bar ? 'secondary' : 'primary'}
        className="wrx-turn__advance"
        onClick={() => {
          setError(undefined)
          setFrom(state)
        }}
      >
        {`${advanceWords(state).action}…`}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !busy) close()
        }}
        title={words.title}
        description={words.description}
        dismissible={!busy}
        actions={
          <>
            <DialogClose>
              <Button disabled={busy}>Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              busy={busy}
              disabled={moved || confirmBlocked}
              onClick={() => {
                void confirm()
              }}
            >
              {words.action}
            </Button>
          </>
        }
      >
        {confirmDetails}
        {moved ? (
          <p className="wrx-field__error" role="alert">
            The game has moved on to {turnLabel(state).toLowerCase()}{' '}
            {phaseLabel(state.phase).toLowerCase()} since this was opened. Cancel and check the turn
            panel.
          </p>
        ) : null}
        {error === undefined ? null : (
          <p className="wrx-field__error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </>
  )
}

/** The turn and phase, and for the admin the control that moves them on (PLY-55, ADM-43). */
export function TurnPanelCore({
  state,
  loading = false,
  problem,
  paused = false,
  onAdvance,
  confirmDetails,
  confirmBlocked = false,
  onConfirmClosed,
  variant = 'column',
}: TurnPanelCoreProps) {
  const noteId = useId()
  const note = state === undefined ? undefined : phaseNote(state, paused)
  const status = loading ? (
    <Spinner label="Loading the turn" />
  ) : problem !== undefined ? (
    <p className="wrx-empty">The turn cannot be shown: {problem}</p>
  ) : state === undefined ? (
    <p className="wrx-empty">No turn yet: the game has not been published.</p>
  ) : null
  const bar = variant === 'bar'
  const Root = bar ? 'div' : 'section'
  return (
    <Root
      className={bar ? 'wrx-turn wrx-turn--bar' : 'wrx-column__section wrx-turn'}
      aria-label="Turn"
      {...(bar ? { role: 'group' } : {})}
      data-phase={state?.phase}
    >
      {status}
      {/* Always rendered, so the live region exists before the first change arrives. */}
      <p
        className="wrx-turn__status"
        role="status"
        aria-atomic="true"
        hidden={state === undefined || status !== null}
        aria-describedby={note === undefined || bar ? undefined : noteId}
      >
        {state === undefined ? null : (
          <>
            <span className="wrx-turn__number">{turnLabel(state)}</span>
            <span className="wrx-visually-hidden">, </span>
            <span className="wrx-turn__phase" data-phase={state.phase}>
              {phaseLabel(state.phase)}
            </span>
          </>
        )}
      </p>
      {note === undefined || bar || status !== null ? null : (
        <p id={noteId} className="wrx-turn__note">
          {note}
        </p>
      )}
      {state === undefined || status !== null || onAdvance === undefined ? null : (
        <AdvanceControl
          state={state}
          onAdvance={onAdvance}
          confirmDetails={confirmDetails}
          confirmBlocked={confirmBlocked}
          onConfirmClosed={onConfirmClosed}
          bar={bar}
        />
      )}
    </Root>
  )
}

export interface TurnPanelProps {
  readonly variant?: 'column' | 'bar'
  readonly confirmDetails?: ReactNode
}

/**
 * The turn panel over the pane's store; needs a SessionStoreProvider. For the admin holding a
 * world-state draft of the game's map room, the phase change carries it (WP 5.6).
 */
export function TurnPanel(props: TurnPanelProps) {
  const store = useSessionStore()
  const me = useMe().data
  const storage = useWorldDraftStorage()
  const mapRoomId = useMapRoomId()
  // The admin's own view only: a preview as a role (ADM-30) reports the role, not the admin.
  const key =
    me.identity.isAdmin && storage !== undefined && mapRoomId !== undefined
      ? worldDraftKey(store.identity.domain, mapRoomId)
      : undefined
  const snapshot = useDraftSnapshot(storage, key)
  const draft = useMemo(() => {
    if (snapshot.text === undefined) return undefined
    const parsed = parseWorldDraft(snapshot.text)
    return parsed.ok ? parsed.value : undefined
  }, [snapshot.text])
  // A draft that a failed phase change published (L3): its panel stays, with the confirmation
  // and its error open, until the confirmation closes; the stored draft is already cleared.
  const [held, setHeld] = useState<{ readonly key: string; readonly draft: WorldDraft }>()
  const shown = draft ?? (held !== undefined && held.key === key ? held.draft : undefined)
  if (key !== undefined && mapRoomId !== undefined && shown !== undefined) {
    return (
      <TurnPanelWithWorld
        {...props}
        roomId={mapRoomId}
        draft={shown}
        draftKey={key}
        draftText={snapshot.text}
        recent={snapshot.published}
        sent={draft === undefined}
        onWorldSent={(sentDraft) => {
          setHeld({ key, draft: sentDraft })
        }}
        onConfirmClosed={() => {
          setHeld(undefined)
        }}
      />
    )
  }
  return <TurnPanelPlain {...props} />
}

function TurnPanelPlain({ variant, confirmDetails }: TurnPanelProps) {
  const store = useSessionStore()
  const me = useMe().data
  const onAdvance = me.identity.isAdmin
    ? async (from: GameState) => advanceResult(await store.advancePhase({ from }))
    : undefined
  return <TurnPanelView variant={variant} confirmDetails={confirmDetails} onAdvance={onAdvance} />
}

/**
 * The admin's panel while a world-state draft is held (ADM-45, ADM-46): the confirmation shows
 * the change summary against the published state, and the change publishes the draft first.
 */
function TurnPanelWithWorld({
  variant,
  confirmDetails,
  roomId,
  draft,
  draftKey,
  draftText,
  recent,
  sent,
  onWorldSent,
  onConfirmClosed,
}: TurnPanelProps & {
  readonly roomId: string
  readonly draft: WorldDraft
  readonly draftKey: string
  readonly draftText: string | undefined
  /** A state just published from the draft, until the room's echo replaces the one before. */
  readonly recent: JustPublished | undefined
  /** The draft was published by a phase change that then failed (L3); only the phase is left. */
  readonly sent: boolean
  readonly onWorldSent: (draft: WorldDraft) => void
  readonly onConfirmClosed: () => void
}) {
  const store = useSessionStore()
  const storage = useWorldDraftStorage()
  const forces = useForces().data
  const world = useWorldState(roomId)
  const current = useGameState().data
  const view = world.data
  const searching =
    world.status === 'loading' ||
    view === undefined ||
    (view.state === undefined && !view.none && world.status !== 'error')
  // Until the room echoes a state just published, compare with it, not with the one it replaces.
  const published =
    recent !== undefined && view !== undefined && view.stanzaId === recent.replacing
      ? recent.state
      : view?.state
  const diff = useMemo(() => diffWorldStates(published, draft.state), [published, draft])
  const dirty = !isEmptyDiff(diff)
  const next = current === undefined ? undefined : nextGameState(current)
  const toPublish = draftForTurn(draft, next?.turn)
  const tooLarge = dirty ? sizeRefusal(toPublish) : undefined
  const details = (
    <>
      {confirmDetails}
      <section className="wrx-turn__world" aria-label="World state">
        <h3 className="wrx-world-summary__heading">World state</h3>
        {view?.unreached === true && view.state === undefined ? (
          <p className="wrx-field__error" role="alert">
            The published world state was not found among the map room’s recent messages, so your
            draft cannot be compared with it. Open the map room and look further back first.
          </p>
        ) : searching ? (
          <Spinner label="Checking the world-state draft against the published one" />
        ) : dirty ? (
          <>
            <p>
              Your world-state draft is published with this change, for turn {toPublish.turn},
              before the phase moves.
            </p>
            <WorldStateSummary diff={diff} state={toPublish} forces={forces} />
          </>
        ) : sent ? (
          <p>
            Your world-state draft is published, so confirming now moves only the phase; the world
            state is not sent again.
          </p>
        ) : (
          <p>
            Your world-state draft has no changes from the published one, so no world state is
            published with this change.
          </p>
        )}
        {tooLarge === undefined ? null : (
          <p className="wrx-field__error" role="alert">
            Not possible with this draft: {tooLarge}
          </p>
        )}
      </section>
    </>
  )
  const onAdvance = async (from: GameState): Promise<string | undefined> => {
    const to = nextGameState(from)
    const state = draftForTurn(draft, to?.turn)
    const result = await store.advancePhase(
      dirty ? { from, worldState: { roomId, state } } : { from },
    )
    if (!result.ok) {
      const out = result.error.worldStateSent
      if (out !== undefined) {
        // L3: the world state is out and players see it; only the phase is left to move. The
        // draft is published, so it is cleared as after a successful change, and held in view.
        onWorldSent(draft)
        if (draftText !== undefined) {
          storage?.published(draftKey, draftText, out.state, view?.stanzaId)
        }
        return `The world state for turn ${String(out.state.turn)} was published and players see it, but the phase did not move: ${errorText(result.error)} Confirm again to move the phase; the world state is not sent again.`
      }
      return dirty && result.error.code !== 'stale'
        ? `Not changed: the world state was not published, so the phase did not move: ${worldPublishErrorText(result.error)}`
        : advanceResult(result)
    }
    if (dirty && draftText !== undefined) {
      storage?.published(draftKey, draftText, state, view?.stanzaId)
    }
    return undefined
  }
  return (
    <TurnPanelView
      variant={variant}
      confirmDetails={details}
      confirmBlocked={searching || tooLarge !== undefined}
      onAdvance={onAdvance}
      onConfirmClosed={onConfirmClosed}
    />
  )
}

function TurnPanelView({
  variant,
  confirmDetails,
  confirmBlocked,
  onAdvance,
  onConfirmClosed,
}: TurnPanelProps & {
  readonly confirmBlocked?: boolean
  readonly onAdvance: ((from: GameState) => Promise<string | undefined>) | undefined
  readonly onConfirmClosed?: () => void
}) {
  const snapshot = useGameState()
  const me = useMe().data
  const state = snapshot.data
  return (
    <TurnPanelCore
      state={state}
      loading={snapshot.status === 'loading' && state === undefined}
      // A missing node is a game not yet published: "No turn yet", not a problem.
      problem={
        snapshot.status === 'error' && state === undefined && snapshot.error?.code !== 'not-found'
          ? errorText(snapshot.error)
          : undefined
      }
      paused={postingPaused(me, state)}
      onAdvance={onAdvance}
      confirmDetails={confirmDetails}
      confirmBlocked={confirmBlocked === true}
      onConfirmClosed={onConfirmClosed}
      {...(variant === undefined ? {} : { variant })}
    />
  )
}

function advanceResult(result: AdvancePhaseResult): string | undefined {
  if (result.ok) return undefined
  return result.error.code === 'stale'
    ? 'Not changed: the game moved on since this was opened. Cancel and check the turn panel.'
    : `Not changed: ${errorText(result.error)}`
}
