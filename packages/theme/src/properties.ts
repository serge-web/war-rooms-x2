// Resolved tokens as the `--wrx-*` custom properties (ui-stack.md). The first five are the
// colour tokens; the font family is the bundled font's stack; border, muted, focus and danger
// are derived from the five colours so every theme gets them without the admin choosing them.
import { contrastRatio, isLight, mix } from './colour.ts'
import { AA_NON_TEXT, AA_TEXT, meets } from './contrast.ts'
import { fontStack } from './fonts.ts'
import type { ColourToken, ResolvedTokens } from './resolve.ts'

export const WRX_PROPERTIES = Object.freeze([
  '--wrx-primary',
  '--wrx-secondary',
  '--wrx-background',
  '--wrx-surface',
  '--wrx-text',
  '--wrx-font-family',
  '--wrx-border',
  '--wrx-muted',
  '--wrx-focus',
  '--wrx-danger',
] as const)
export type WrxProperty = (typeof WRX_PROPERTIES)[number]
export type WrxProperties = Readonly<Record<WrxProperty, string>>

/** The property each colour token sets. */
export const TOKEN_PROPERTY: Readonly<Record<ColourToken, WrxProperty>> = Object.freeze({
  primary: '--wrx-primary',
  secondary: '--wrx-secondary',
  background: '--wrx-background',
  surface: '--wrx-surface',
  text: '--wrx-text',
})

export interface DerivedColours {
  /** Dividers and control outlines: the text colour, faded towards the surface. */
  readonly border: string
  /** Secondary text: as faded as it can be while keeping 4.5:1 on the page and on panels. */
  readonly muted: string
  /** Focus outlines: primary when it keeps 3:1 against the page and panels, else the text colour. */
  readonly focus: string
  /** Errors and destructive actions: a red with 4.5:1 on the page and panels where one exists. */
  readonly danger: string
}

const DANGER_ON_LIGHT = ['#b91c1c', '#991b1b', '#7f1d1d', '#450a0a'] as const
const DANGER_ON_DARK = ['#f87171', '#fca5a5', '#fecaca', '#fef2f2'] as const

export function deriveColours(tokens: ResolvedTokens): DerivedColours {
  const { primary, background, surface, text } = tokens
  const worst = (colour: string) =>
    Math.min(contrastRatio(colour, surface), contrastRatio(colour, background))

  let muted = text
  for (let amount = 0.4; amount > 0; amount -= 0.05) {
    const candidate = mix(text, surface, amount)
    if (meets(worst(candidate), AA_TEXT)) {
      muted = candidate
      break
    }
  }

  const focus = meets(worst(primary), AA_NON_TEXT) ? primary : text

  const reds = isLight(surface) ? DANGER_ON_LIGHT : DANGER_ON_DARK
  const danger =
    reds.find((red) => meets(worst(red), AA_TEXT)) ??
    [...reds].sort((a, b) => worst(b) - worst(a))[0] ??
    text

  return { border: mix(surface, text, 0.3), muted, focus, danger }
}

/** Every `--wrx-*` property for a theme. */
export function themeProperties(tokens: ResolvedTokens): WrxProperties {
  const derived = deriveColours(tokens)
  return {
    '--wrx-primary': tokens.primary,
    '--wrx-secondary': tokens.secondary,
    '--wrx-background': tokens.background,
    '--wrx-surface': tokens.surface,
    '--wrx-text': tokens.text,
    '--wrx-font-family': fontStack(tokens.fontFamily),
    '--wrx-border': derived.border,
    '--wrx-muted': derived.muted,
    '--wrx-focus': derived.focus,
    '--wrx-danger': derived.danger,
  }
}

/**
 * The properties as a CSS declaration block, for a rule such as `:root { … }` in a page with no
 * React (the static welcome page, say). Values come from validated tokens and the fixed font
 * stacks, so they need no escaping.
 */
export function themeDeclarations(tokens: ResolvedTokens): string {
  const props = themeProperties(tokens)
  return WRX_PROPERTIES.map((name) => `${name}: ${props[name]};`).join(' ')
}
