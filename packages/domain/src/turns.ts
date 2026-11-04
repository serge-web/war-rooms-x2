// The turn rules (D7, ADM-43, PLY-56; WP 5.4). A game has numbered turns, each a planning phase
// then an adjudication phase, and only the admin moves it on. During adjudication, roles outside
// the White Force do not post. That rule is advisory (R27): the store and the UI apply it, and
// the server does not, so a modified client can still post.
import { LIMITS } from '@wrx/schemas'
import type { GamePhase, GameState } from '@wrx/schemas'

/**
 * The state the admin's next change leads to: planning to adjudication in the same turn, then
 * adjudication to the next turn's planning (ADM-43). Undefined after the last turn's
 * adjudication, which has no next.
 */
export function nextGameState(state: GameState): GameState | undefined {
  if (state.phase === 'planning') return Object.freeze({ ...state, phase: 'adjudication' })
  if (state.turn >= LIMITS.turnMax) return undefined
  return Object.freeze({ schemaVersion: 1, turn: state.turn + 1, phase: 'planning' })
}

/** The same turn and phase. */
export function sameGameState(a: GameState | undefined, b: GameState | undefined): boolean {
  return a?.turn === b?.turn && a?.phase === b?.phase
}

/**
 * PLY-56: posting is paused for this session, because the game is in adjudication and the
 * session is outside the White Force. The admin is the umpire, in the White Force, and White
 * Force roles keep posting (confirmed Nov 4, 2026); its observers stay read-only as always
 * (PLY-12). Advisory only (R27).
 */
export function postingPaused(
  me: { readonly isUmpire: boolean },
  state: GameState | undefined,
): boolean {
  return state?.phase === 'adjudication' && !me.isUmpire
}

const PHASE_LABELS: Readonly<Record<GamePhase, string>> = Object.freeze({
  planning: 'Planning',
  adjudication: 'Adjudication',
})

/** The phase as the UI names it. */
export function phaseLabel(phase: GamePhase): string {
  return PHASE_LABELS[phase]
}
