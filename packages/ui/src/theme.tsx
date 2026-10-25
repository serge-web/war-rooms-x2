// ThemeScope (PLY-26, D24): sets the `--wrx-*` custom properties on its own root element only,
// so one panel's theme cannot leak into another. It delegates to `@wrx/theme`: inheritance and
// defaults come from `resolveTheme`, the ten properties (derived border, muted, focus and danger
// included) from `themeProperties`, and the element from `@wrx/theme/react`'s `ThemeScope`.
//
// What this wrapper adds is partial tokens: a scope sets only some tokens and takes the rest
// from the nearest enclosing `@wrx/ui` scope, or from the default theme at the root.
import { DEFAULT_TOKENS, fontStack, resolveTheme, themeProperties } from '@wrx/theme'
import type { ResolvedTokens } from '@wrx/theme'
import { ThemeScope as ResolvedThemeScope } from '@wrx/theme/react'
import type { BundledFont, ThemeTokens as SchemaThemeTokens } from '@wrx/schemas'
import { createContext, useContext, useMemo } from 'react'
import type { ComponentPropsWithRef, ReactNode } from 'react'

declare module 'react' {
  // An interface, not a Record: module augmentation can only merge interfaces.
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
  interface CSSProperties {
    [property: `--wrx-${string}`]: string | undefined
  }
}

/** Font families bundled with the client (NFR-7): `BUNDLED_FONTS` in schemas. */
export type FontId = BundledFont

/** Theme tokens, as in `@wrx/schemas`; unset ones inherit. */
export type ThemeTokens = SchemaThemeTokens

/** The default theme, used when a document sets no token, or there is no game (PLY-27). */
export const DEFAULT_THEME: ResolvedTokens = DEFAULT_TOKENS

/** CSS font stacks for the bundled font ids, from `@wrx/theme`. */
export const FONT_STACKS: Readonly<Record<FontId, string>> = Object.freeze({
  sans: fontStack('sans'),
  serif: fontStack('serif'),
  mono: fontStack('mono'),
})

/**
 * The custom properties for a set of tokens. With `inherit` (the default) only the set tokens
 * are returned, so the rest inherit from the enclosing scope; without it, every `--wrx-*`
 * property of the tokens over the default theme.
 */
export function themeStyle(
  tokens: ThemeTokens | undefined,
  options: { readonly inherit?: boolean } = {},
): Record<`--wrx-${string}`, string> {
  if (options.inherit === false) return { ...themeProperties(resolveTokens(tokens)) }
  const style: Record<`--wrx-${string}`, string> = {}
  const set = (name: `--wrx-${string}`, value: string | undefined) => {
    if (value !== undefined) style[name] = value
  }
  set('--wrx-primary', tokens?.primary)
  set('--wrx-secondary', tokens?.secondary)
  set('--wrx-background', tokens?.background)
  set('--wrx-surface', tokens?.surface)
  set('--wrx-text', tokens?.text)
  set(
    '--wrx-font-family',
    tokens?.fontFamily === undefined ? undefined : fontStack(tokens.fontFamily),
  )
  return style
}

function resolveTokens(tokens: ThemeTokens | undefined): ResolvedTokens {
  return resolveTheme(tokens === undefined ? undefined : { tokens }).tokens
}

/** The tokens set by the enclosing scopes, nearest last; undefined outside any scope. */
const Inherited = createContext<ThemeTokens | undefined>(undefined)

const NO_TOKENS: ThemeTokens = Object.freeze({})

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

/** Sets every `--wrx-*` property on its own root element (PLY-26), through `@wrx/theme`. */
export function ThemeScope({
  tokens,
  root = false,
  className,
  children,
  ...rest
}: ThemeScopeProps) {
  const parent = useContext(Inherited)
  const own = tokens ?? NO_TOKENS
  const merged = useMemo(
    () => (root || parent === undefined ? own : { ...parent, ...own }),
    [root, parent, own],
  )
  const resolved = useMemo(() => resolveTokens(merged), [merged])
  return (
    <Inherited.Provider value={merged}>
      <ResolvedThemeScope
        {...rest}
        tokens={resolved}
        applyBase={false}
        className={['wrx-theme', className].filter(Boolean).join(' ')}
      >
        {children}
      </ResolvedThemeScope>
    </Inherited.Provider>
  )
}
