// The bundled font families (NFR-7): each `BUNDLED_FONTS` id maps to an IBM Plex family, shipped
// as local Latin-subset woff2 files (regular and bold) in `packages/theme/fonts`, declared in
// `fonts.css`. Nothing is fetched from a CDN. Each stack ends in system fallbacks, so text shows
// while the files load and for characters outside the Latin subset.
import type { BundledFont } from '@wrx/schemas'

export interface BundledFontInfo {
  readonly id: BundledFont
  /** The `font-family` name declared in `fonts.css`. */
  readonly family: string
  /** The full `font-family` value, with fallbacks. */
  readonly stack: string
  /** A label for the admin's font choice. */
  readonly label: string
  readonly licence: 'OFL-1.1'
  /** The licence text shipped beside the files. */
  readonly licenceFile: string
  /** Where the files came from. */
  readonly source: string
}

export const BUNDLED_FONT_INFO: Readonly<Record<BundledFont, BundledFontInfo>> = Object.freeze({
  sans: {
    id: 'sans',
    family: 'WRX IBM Plex Sans',
    stack: "'WRX IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    label: 'Sans serif (IBM Plex Sans)',
    licence: 'OFL-1.1',
    licenceFile: 'fonts/OFL-IBM-Plex-Sans.txt',
    source: '@fontsource/ibm-plex-sans 5.3.0, latin subset, weights 400 and 700',
  },
  serif: {
    id: 'serif',
    family: 'WRX IBM Plex Serif',
    stack: "'WRX IBM Plex Serif', Georgia, 'Times New Roman', serif",
    label: 'Serif (IBM Plex Serif)',
    licence: 'OFL-1.1',
    licenceFile: 'fonts/OFL-IBM-Plex-Serif.txt',
    source: '@fontsource/ibm-plex-serif 5.3.0, latin subset, weights 400 and 700',
  },
  mono: {
    id: 'mono',
    family: 'WRX IBM Plex Mono',
    stack: "'WRX IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
    label: 'Monospace (IBM Plex Mono)',
    licence: 'OFL-1.1',
    licenceFile: 'fonts/OFL-IBM-Plex-Mono.txt',
    source: '@fontsource/ibm-plex-mono 5.3.0, latin subset, weights 400 and 700',
  },
})

/** The `font-family` value for a bundled font id. */
export function fontStack(id: BundledFont): string {
  return BUNDLED_FONT_INFO[id].stack
}
