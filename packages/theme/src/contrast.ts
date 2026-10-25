// WCAG 2.2 AA contrast checks for a theme (ADM-20, NFR-14). The admin is warned about each
// failing pair but may still save. The pairs are the ones the UI uses (ui-stack.md):
// text on the page and on panels, the page background colour as text on primary (headers and
// primary buttons), and primary and secondary as UI accents on panels.
import { contrastRatio } from './colour.ts'
import type { ColourToken, ResolvedTokens } from './resolve.ts'

/** SC 1.4.3: normal text. */
export const AA_TEXT = 4.5
/** SC 1.4.3 large text, and SC 1.4.11 non-text contrast (UI components, focus indicators). */
export const AA_NON_TEXT = 3

export interface ContrastPair {
  readonly id: string
  readonly foreground: ColourToken
  readonly background: ColourToken
  readonly minimum: number
  /** What the pair is used for, for the warning. */
  readonly use: string
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = Object.freeze([
  {
    id: 'text-on-background',
    foreground: 'text',
    background: 'background',
    minimum: AA_TEXT,
    use: 'Text on the page background',
  },
  {
    id: 'text-on-surface',
    foreground: 'text',
    background: 'surface',
    minimum: AA_TEXT,
    use: 'Text on panels',
  },
  {
    id: 'background-on-primary',
    foreground: 'background',
    background: 'primary',
    minimum: AA_TEXT,
    use: 'Text on primary (headers and primary buttons)',
  },
  {
    id: 'primary-on-surface',
    foreground: 'primary',
    background: 'surface',
    minimum: AA_NON_TEXT,
    use: 'Primary buttons and accents on panels',
  },
  {
    id: 'secondary-on-surface',
    foreground: 'secondary',
    background: 'surface',
    minimum: AA_NON_TEXT,
    use: 'Secondary accents on panels',
  },
])

export interface ContrastResult {
  readonly pair: ContrastPair
  readonly foreground: string
  readonly background: string
  /** The ratio, e.g. 4.62 for 4.62:1. */
  readonly ratio: number
  readonly passes: boolean
}

/** Every pair's result, in `CONTRAST_PAIRS` order. */
export function contrastResults(tokens: ResolvedTokens): ContrastResult[] {
  return CONTRAST_PAIRS.map((pair) => {
    const foreground = tokens[pair.foreground]
    const background = tokens[pair.background]
    const ratio = contrastRatio(foreground, background)
    return { pair, foreground, background, ratio, passes: meets(ratio, pair.minimum) }
  })
}

/** The pairs that fail WCAG 2.2 AA (ADM-20). Empty when the theme passes. */
export function contrastFailures(tokens: ResolvedTokens): ContrastResult[] {
  return contrastResults(tokens).filter((r) => !r.passes)
}

/**
 * Whether a ratio meets a minimum. WCAG does not round: 4.499:1 fails 4.5:1. A tiny tolerance
 * absorbs floating-point error only.
 */
export function meets(ratio: number, minimum: number): boolean {
  return ratio + 1e-9 >= minimum
}

/** A ratio as WCAG writes it, e.g. "4.62:1", truncated (not rounded up) to two places. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100 + 1e-6) / 100).toFixed(2)}:1`
}
