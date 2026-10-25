// Live themes from the pane's session store (ADM-22, PLY-24). The store keeps `game-setup`,
// `forces:*` and `rooms:*` current by subscription, so when the admin publishes a theme these
// hooks re-render with it and the panel restyles without a new login. Each pane in the
// multi-client view has its own store, so each resolves its own themes.
import type { DomainError, LoadStatus } from '@wrx/domain'
import { useForce, useGameSetup, useRoom } from '@wrx/hooks'
import type { Theme } from '@wrx/schemas'
import { useMemo } from 'react'
import { resolveTheme } from '../resolve.ts'
import type { ResolvedTheme } from '../resolve.ts'

export interface ThemeState {
  /** Always usable: while documents load, unset parts come from the built-in default. */
  readonly theme: ResolvedTheme
  readonly status: LoadStatus
  readonly error: DomainError | undefined
}

interface Part {
  readonly status: LoadStatus
  readonly error: DomainError | undefined
}

function combine(parts: readonly Part[]): Pick<ThemeState, 'status' | 'error'> {
  const failed = parts.find((p) => p.status === 'error')
  if (failed !== undefined) return { status: 'error', error: failed.error }
  if (parts.some((p) => p.status === 'loading')) return { status: 'loading', error: undefined }
  return { status: 'ready', error: undefined }
}

function useResolved(own: Theme | undefined, game: Theme | undefined): ResolvedTheme {
  return useMemo(() => resolveTheme(own, game), [own, game])
}

/** The game theme: the welcome page and the app-wide default (D19). */
export function useGameTheme(): ThemeState {
  const game = useGameSetup()
  const theme = useResolved(game.data?.theme, undefined)
  return { theme, ...combine([game]) }
}

/** A force's theme, for its force/role/objectives panel only (D19). */
export function useForceTheme(forceId: string): ThemeState {
  const game = useGameSetup()
  const force = useForce(forceId)
  const theme = useResolved(force.data?.theme, game.data?.theme)
  return { theme, ...combine([game, force]) }
}

/** A room's theme, for that room's panel and tab (D19, PLY-24). */
export function useRoomTheme(roomId: string): ThemeState {
  const game = useGameSetup()
  const room = useRoom(roomId)
  const theme = useResolved(room.data?.theme, game.data?.theme)
  return { theme, ...combine([game, room]) }
}
