// A themed panel's root (PLY-26): sets every `--wrx-*` property on its own element, so the
// panel and its contents take the theme and nothing outside it does. A nested scope sets all
// ten properties again, so an inner panel never shows a mix of its own and its parent's theme.
import { useMemo } from 'react'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { themeProperties } from '../properties.ts'
import type { ResolvedTokens } from '../resolve.ts'
import '../fonts.css'

export type ThemeScopeElement = 'div' | 'section' | 'article' | 'aside' | 'main' | 'header' | 'nav'

export interface ThemeScopeProps extends HTMLAttributes<HTMLElement> {
  readonly tokens: ResolvedTokens
  /** The root element; a `div` unless the panel needs a landmark. */
  readonly as?: ThemeScopeElement
  /**
   * When true (the default), the root also takes the theme's text colour, background and font,
   * so plain content inside is themed without any CSS of its own.
   */
  readonly applyBase?: boolean
  readonly children?: ReactNode
}

export function ThemeScope({
  tokens,
  as: Tag = 'div',
  applyBase = true,
  style,
  children,
  ...rest
}: ThemeScopeProps) {
  const properties = useMemo(() => themeProperties(tokens), [tokens])
  const base: CSSProperties = applyBase
    ? {
        color: 'var(--wrx-text)',
        backgroundColor: 'var(--wrx-background)',
        fontFamily: 'var(--wrx-font-family)',
      }
    : {}
  return (
    <Tag data-wrx-theme="" style={{ ...properties, ...base, ...style }} {...rest}>
      {children}
    </Tag>
  )
}
