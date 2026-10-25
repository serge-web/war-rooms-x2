// Ready-wired scopes for the three themed surfaces (D19): the welcome page and app default, a
// force panel, and a room panel. Each resolves its theme live from the pane's store (ADM-22).
import type { ReactNode } from 'react'
import { useForceTheme, useGameTheme, useRoomTheme } from './hooks.ts'
import { ThemeScope } from './ThemeScope.tsx'
import type { ThemeScopeProps } from './ThemeScope.tsx'

type ScopeProps = Omit<ThemeScopeProps, 'tokens'> & { readonly children?: ReactNode }

export function GameThemeScope(props: ScopeProps) {
  const { theme } = useGameTheme()
  return <ThemeScope tokens={theme.tokens} {...props} />
}

export function ForceThemeScope({ forceId, ...props }: ScopeProps & { readonly forceId: string }) {
  const { theme } = useForceTheme(forceId)
  return <ThemeScope tokens={theme.tokens} {...props} />
}

export function RoomThemeScope({ roomId, ...props }: ScopeProps & { readonly roomId: string }) {
  const { theme } = useRoomTheme(roomId)
  return <ThemeScope tokens={theme.tokens} {...props} />
}
