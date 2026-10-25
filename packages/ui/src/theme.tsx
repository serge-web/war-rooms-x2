// ThemeScope (PLY-26, D24): sets the `--wrx-*` custom properties on its own root element only,
// so one panel's theme cannot leak into another. The five colour tokens and the font come from
// the theme; `--wrx-border`, `--wrx-muted`, `--wrx-focus` and `--wrx-danger` derive from them in
// ui.css (`.wrx-theme`) until WP 2.8's `packages/theme` takes over the derivation.
import type { ComponentPropsWithRef, ReactNode } from 'react'

declare module 'react' {
  // An interface, not a Record: module augmentation can only merge interfaces.
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
  interface CSSProperties {
    [property: `--wrx-${string}`]: string | undefined
  }
}

/** Font families bundled with the client (NFR-7); the same ids as `BUNDLED_FONTS` in schemas. */
export type FontId = 'sans' | 'serif' | 'mono'

/** Theme tokens. Structurally the same as `ThemeTokens` in `@wrx/schemas`; unset ones inherit. */
export interface ThemeTokens {
  readonly primary?: string
  readonly secondary?: string
  readonly background?: string
  readonly surface?: string
  readonly text?: string
  readonly fontFamily?: FontId
}

/** The default theme, used when a document sets no token, or there is no game (PLY-27). */
export const DEFAULT_THEME: Readonly<Required<ThemeTokens>> = Object.freeze({
  primary: '#1d4ed8',
  secondary: '#475569',
  background: '#f8fafc',
  surface: '#ffffff',
  text: '#0f172a',
  fontFamily: 'sans',
})

/** CSS font stacks for the bundled font ids. WP 2.8 swaps these for the bundled files. */
export const FONT_STACKS: Readonly<Record<FontId, string>> = Object.freeze({
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
})

/**
 * The custom properties for a set of tokens. With `inherit` (the default) unset tokens are left
 * out, so they inherit from the enclosing scope; without it they fall back to the default theme.
 */
export function themeStyle(
  tokens: ThemeTokens | undefined,
  options: { readonly inherit?: boolean } = {},
): Record<`--wrx-${string}`, string> {
  const inherit = options.inherit ?? true
  const pick = <K extends keyof ThemeTokens>(key: K): ThemeTokens[K] =>
    tokens?.[key] ?? (inherit ? undefined : DEFAULT_THEME[key])
  const style: Record<`--wrx-${string}`, string> = {}
  const set = (name: `--wrx-${string}`, value: string | undefined) => {
    if (value !== undefined) style[name] = value
  }
  set('--wrx-primary', pick('primary'))
  set('--wrx-secondary', pick('secondary'))
  set('--wrx-background', pick('background'))
  set('--wrx-surface', pick('surface'))
  set('--wrx-text', pick('text'))
  const font = pick('fontFamily')
  set('--wrx-font-family', font === undefined ? undefined : FONT_STACKS[font])
  return style
}

export type ThemeScopeProps = Omit<ComponentPropsWithRef<'div'>, 'style'> & {
  /** The theme's tokens; unset ones inherit (or, at the root, take the default theme). */
  readonly tokens?: ThemeTokens | undefined
  /**
   * The outermost scope: unset tokens take the default theme instead of inheriting. Use once,
   * at the top of the app or of a multi-client pane.
   */
  readonly root?: boolean
  readonly children?: ReactNode
}

/** Sets the `--wrx-*` properties on its own root element (PLY-26). */
export function ThemeScope({
  tokens,
  root = false,
  className,
  children,
  ...rest
}: ThemeScopeProps) {
  return (
    <div
      {...rest}
      className={['wrx-theme', className].filter(Boolean).join(' ')}
      style={themeStyle(tokens, { inherit: !root })}
    >
      {children}
    </div>
  )
}
