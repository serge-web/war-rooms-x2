// MIL-STD-2525/APP-6 symbols for the map (PLY-57), drawn by milsymbol, bundled (NFR-7). Each
// symbol is milsymbol's SVG as a `data:` URL for an `<img>`: an image cannot run script or reach
// the page, so nothing milsymbol writes enters the DOM as markup. Only the code is passed (no text
// modifiers), and the code is one `sidcSchema` accepted. Symbols are cached per map, by code.
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
  /** How many are held. */
  readonly size: number
}

/** A cache of drawn symbols, one per map (each pane its own, ARC-2). */
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
    get size() {
      return cache.size
    },
  }
}
