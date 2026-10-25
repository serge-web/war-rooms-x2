// Theme inheritance (SRD §3 rules 10–11): each token comes from the object's own theme, else the
// game theme, else the built-in default. The logo and icon follow the same order, except that
// the default has none.
import type { BundledFont, Theme, ThemeTokens } from '@wrx/schemas'

export const COLOUR_TOKENS = Object.freeze([
  'primary',
  'secondary',
  'background',
  'surface',
  'text',
] as const)
export type ColourToken = (typeof COLOUR_TOKENS)[number]
export type TokenName = ColourToken | 'fontFamily'
export const TOKEN_NAMES: readonly TokenName[] = Object.freeze([...COLOUR_TOKENS, 'fontFamily'])

/** Every token with a value. */
export type ResolvedTokens = Readonly<Record<ColourToken, string>> & {
  readonly fontFamily: BundledFont
}

/** Where a resolved value came from. */
export type TokenSource = 'own' | 'game' | 'default'

export interface ResolvedTheme {
  readonly tokens: ResolvedTokens
  readonly logoAssetId: string | undefined
  readonly iconAssetId: string | undefined
  /** The source of each token, for the editor's "inherited from" hints. */
  readonly sources: Readonly<Record<TokenName | 'logoAssetId' | 'iconAssetId', TokenSource>>
}

/**
 * The built-in default: dark text on a light page, with a blue primary. Every pair that
 * `contrastFailures` checks passes WCAG 2.2 AA.
 */
export const DEFAULT_TOKENS: ResolvedTokens = Object.freeze({
  primary: '#1d4ed8',
  secondary: '#475569',
  background: '#f9fafb',
  surface: '#ffffff',
  text: '#111827',
  fontFamily: 'sans',
})

/**
 * Resolves a theme. `own` is the force's or room's theme; for the game theme itself, pass it as
 * `own` and leave `game` out. Either may be missing.
 */
export function resolveTheme(
  own: Theme | undefined,
  game?: Theme,
  defaults: ResolvedTokens = DEFAULT_TOKENS,
): ResolvedTheme {
  const pick = <K extends keyof ThemeTokens>(key: K) => {
    const mine = own?.tokens[key]
    if (mine !== undefined) return { value: mine, source: 'own' as const }
    const inherited = game?.tokens[key]
    if (inherited !== undefined) return { value: inherited, source: 'game' as const }
    return { value: defaults[key], source: 'default' as const }
  }
  const asset = (key: 'logoAssetId' | 'iconAssetId') => {
    if (own?.[key] !== undefined) return { value: own[key], source: 'own' as const }
    if (game?.[key] !== undefined) return { value: game[key], source: 'game' as const }
    return { value: undefined, source: 'default' as const }
  }
  const primary = pick('primary')
  const secondary = pick('secondary')
  const background = pick('background')
  const surface = pick('surface')
  const text = pick('text')
  const fontFamily = pick('fontFamily')
  const logo = asset('logoAssetId')
  const icon = asset('iconAssetId')
  return {
    tokens: {
      primary: primary.value.toLowerCase(),
      secondary: secondary.value.toLowerCase(),
      background: background.value.toLowerCase(),
      surface: surface.value.toLowerCase(),
      text: text.value.toLowerCase(),
      fontFamily: fontFamily.value,
    },
    logoAssetId: logo.value,
    iconAssetId: icon.value,
    sources: {
      primary: primary.source,
      secondary: secondary.source,
      background: background.source,
      surface: surface.source,
      text: text.source,
      fontFamily: fontFamily.source,
      logoAssetId: logo.source,
      iconAssetId: icon.source,
    },
  }
}

/** True when a theme sets nothing, so it inherits everything. */
export function isEmptyTheme(theme: Theme | undefined): boolean {
  if (theme === undefined) return true
  return (
    TOKEN_NAMES.every((name) => theme.tokens[name] === undefined) &&
    theme.logoAssetId === undefined &&
    theme.iconAssetId === undefined
  )
}
