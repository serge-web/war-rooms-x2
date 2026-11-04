// The turn panel (PLY-55, PLY-36, ADM-43; WP 5.4): the top of the out-of-game column, in the
// wide column and in the narrow-window tab alike. It shows the turn number and phase from
// `game-state`, live, and what the phase means for this role (PLY-56). The admin, in its own game
// view, also gets the control that moves the game on, behind a confirmation; the server lets only
// the admin publish `game-state` (§3 rule 15), so no one else is offered it. The admin backend
// shows the same control, compact, in its header (`variant="bar"`).
import { nextGameState, phaseLabel, postingPaused, sameGameState } from '@wrx/domain'
import type { DomainResult, PhaseChange } from '@wrx/domain'
import { useGameState, useMe, useSessionStore } from '@wrx/hooks'
import type { GameState } from '@wrx/schemas'
import { Button, Dialog, DialogClose, Spinner } from '@wrx/ui'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
  bar,
}: {
  readonly state: GameState
  readonly onAdvance: (from: GameState) => Promise<string | undefined>
  readonly confirmDetails: ReactNode
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
  const confirm = async () => {
    if (from === undefined || busy || moved) return
    setBusy(true)
    setError(undefined)
    const problem = await onAdvance(from)
    if (!mounted.current) return
    setBusy(false)
    if (problem === undefined) setFrom(undefined)
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
          if (!value && !busy) setFrom(undefined)
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
              disabled={moved}
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

/** The turn panel over the pane's store; needs a SessionStoreProvider. */
export function TurnPanel({ variant, confirmDetails }: TurnPanelProps) {
  const store = useSessionStore()
  const snapshot = useGameState()
  const me = useMe().data
  const state = snapshot.data
  // The admin's own view only: a preview as a role (ADM-30) reports the role, not the admin.
  const onAdvance = me.identity.isAdmin
    ? async (from: GameState) => advanceResult(await store.advancePhase({ from }))
    : undefined
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
      {...(variant === undefined ? {} : { variant })}
    />
  )
}

function advanceResult(result: DomainResult<PhaseChange>): string | undefined {
  if (result.ok) return undefined
  return result.error.code === 'stale'
    ? 'Not changed: the game moved on since this was opened. Cancel and check the turn panel.'
    : `Not changed: ${errorText(result.error)}`
}
