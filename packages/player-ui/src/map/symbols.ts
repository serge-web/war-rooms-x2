// MIL-STD-2525/APP-6 symbols for the map (PLY-57), drawn by milsymbol, bundled (NFR-7). Each
// symbol is milsymbol's SVG as a `data:` URL for an `<img>`: an image cannot run script or reach
// the page, so nothing milsymbol writes enters the DOM as markup. Only the code is passed (no text
// modifiers), and the code is one `sidcSchema` accepted. Symbols are cached by code and size, in
// one cache for every map of the page (`sharedSymbols`): a symbol is derived from its code alone,
// so the cache holds nothing of any game or session.
import ms from 'milsymbol'

export interface SymbolImage {
  /** `data:image/svg+xml,…` */
  readonly url: string
  readonly width: number
  readonly height: number
  /** The symbol's anchor (its centre of the frame) from the image's top left, in pixels. */
  readonly anchorX: number
  readonly anchorY: number
  /** Whether milsymbol knows the code; an unknown one still draws its frame. */
  readonly valid: boolean
}

/** The symbol size milsymbol is asked for, in pixels (about the frame's height). */
export const SYMBOL_SIZE = 26

/** Distinct codes a cache keeps; a game holds far fewer. Past this it starts again. */
const CACHE_LIMIT = 2000

/** Draws one symbol code (uncached). */
export function drawSymbol(sidc: string, size = SYMBOL_SIZE): SymbolImage {
  const symbol = new ms.Symbol(sidc, { size })
  const { width, height } = symbol.getSize()
  const anchor = symbol.getAnchor()
  return Object.freeze({
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(symbol.asSVG())}`,
    width: Math.ceil(width),
    height: Math.ceil(height),
    anchorX: Math.round(anchor.x),
    anchorY: Math.round(anchor.y),
    valid: symbol.isValid() === true,
  })
}

export interface SymbolCache {
  /** The image of a symbol code, drawn once per code and size. */
  image(sidc: string, size?: number): SymbolImage
  /** Whether the image of a code and size is held. */
  has(sidc: string, size?: number): boolean
  /** How many are held. */
  readonly size: number
}

/**
 * A cache of drawn symbols. A symbol is derived from its code alone, so one cache can serve every
 * map of the page (`sharedSymbols`) without sharing anything of a session between panes (ARC-2).
 */
export function createSymbolCache(): SymbolCache {
  const cache = new Map<string, SymbolImage>()
  return {
    image(sidc, size = SYMBOL_SIZE) {
      const key = `${size}:${sidc}`
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      const image = drawSymbol(sidc, size)
      if (cache.size >= CACHE_LIMIT) cache.clear()
      cache.set(key, image)
      return image
    },
    has(sidc, size = SYMBOL_SIZE) {
      return cache.has(`${size}:${sidc}`)
    },
    get size() {
      return cache.size
    },
  }
}

/** The symbols every map draws from (WP 5.9): a remount, a popout or another pane reuses them. */
export const sharedSymbols: SymbolCache = createSymbolCache()

/**
 * Codes that between them run milsymbol's one-time set-up (letter-based friend and hostile, and
 * number-based): the first symbol drawn costs about 100 ms, the rest well under 1 ms each.
 */
const WARM_CODES = ['SFGPUCI----K---', 'SHGPUCA----K---', '10031000001211000000'] as const

/**
 * Draws a few symbols into `sharedSymbols`, so the map's first render does not pay milsymbol's
 * set-up (WP 5.9, NFR-11). Each call draws the next code; returns false when all are drawn, so a
 * caller can spread the work over idle periods.
 */
export function warmSymbols(): boolean {
  const next = WARM_CODES.find((code) => !sharedSymbols.has(code))
  if (next === undefined) return false
  sharedSymbols.image(next)
  return true
}
