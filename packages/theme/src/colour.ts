// Colour arithmetic for themes: `#rrggbb` parsing, mixing, and the WCAG 2.2 relative luminance
// and contrast ratio (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio). Pure functions.

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const HEX = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/

export function isHexColour(value: string): boolean {
  return HEX.test(value)
}

/** Parses `#rrggbb` (either case). Throws on anything else: theme colours are validated first. */
export function parseHex(hex: string): Rgb {
  const m = HEX.exec(hex)
  if (m === null) throw new RangeError(`Not a #rrggbb colour: "${hex}"`)
  const [, r = '', g = '', b = ''] = m
  return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) }
}

/** `#rrggbb`, lowercase, with each channel rounded and clamped to 0…255. */
export function toHex({ r, g, b }: Rgb): string {
  const channel = (c: number) =>
    Math.min(255, Math.max(0, Math.round(c)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** `from` moved `amount` (0…1) of the way towards `to`, in sRGB. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  const t = Math.min(1, Math.max(0, amount))
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t })
}

/** WCAG 2.2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  const linear = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG 2.2 contrast ratio, 1 to 21. Symmetric in its arguments. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [light, dark] = la >= lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

/** True for a background on which dark text reads better than light text. */
export function isLight(hex: string): boolean {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff')
}
