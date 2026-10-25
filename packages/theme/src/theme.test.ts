import { LIMITS } from '@wrx/schemas'
import type { Theme } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
import {
  CONTRAST_PAIRS,
  DEFAULT_TOKENS,
  WRX_PROPERTIES,
  assetDataUrl,
  assetLimitBytes,
  base64ToBytes,
  bytesToBase64,
  checkUpload,
  contrastFailures,
  contrastRatio,
  createAsset,
  deriveColours,
  fontStack,
  formatRatio,
  isEmptyTheme,
  meets,
  mix,
  relativeLuminance,
  resolveTheme,
  sanitizeSvg,
  sha256Hex,
  sniffMimeType,
  themeDeclarations,
  themeProperties,
} from './index.ts'
import type { ResolvedTokens } from './index.ts'

const PNG = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
)
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
])
const utf8 = (s: string) => new TextEncoder().encode(s)

describe('resolveTheme (§3 rule 11)', () => {
  const game: Theme = {
    tokens: { primary: '#112233', text: '#000000', fontFamily: 'serif' },
    logoAssetId: 'game-logo',
  }

  it('takes the built-in default when nothing is set', () => {
    const resolved = resolveTheme(undefined)
    expect(resolved.tokens).toEqual(DEFAULT_TOKENS)
    expect(resolved.logoAssetId).toBeUndefined()
    expect(Object.values(resolved.sources).every((s) => s === 'default')).toBe(true)
  })

  it('resolves own, then game, then default, token by token', () => {
    const own: Theme = { tokens: { primary: '#AABBCC' }, iconAssetId: 'room-icon' }
    const resolved = resolveTheme(own, game)
    expect(resolved.tokens).toEqual({
      ...DEFAULT_TOKENS,
      primary: '#aabbcc',
      text: '#000000',
      fontFamily: 'serif',
    })
    expect(resolved.sources).toMatchObject({
      primary: 'own',
      text: 'game',
      fontFamily: 'game',
      background: 'default',
      logoAssetId: 'game',
      iconAssetId: 'own',
    })
    expect(resolved.logoAssetId).toBe('game-logo')
    expect(resolved.iconAssetId).toBe('room-icon')
  })

  it('treats the game theme as the object itself when no parent is given', () => {
    expect(resolveTheme(game).sources.primary).toBe('own')
  })

  it('knows an empty theme', () => {
    expect(isEmptyTheme(undefined)).toBe(true)
    expect(isEmptyTheme({ tokens: {} })).toBe(true)
    expect(isEmptyTheme({ tokens: { text: '#000000' } })).toBe(false)
    expect(isEmptyTheme({ tokens: {}, logoAssetId: 'x' })).toBe(false)
  })
})

describe('contrast (WCAG 2.2, ADM-20)', () => {
  it('matches known ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
    // The classic AA threshold pair: #767676 passes 4.5:1 on white, #777777 does not.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(contrastRatio('#595959', '#ffffff')).toBeCloseTo(7.0, 1)
    expect(contrastRatio('#ff0000', '#ffffff')).toBeCloseTo(4.0, 1)
    expect(contrastRatio('#0000ff', '#ffffff')).toBeCloseTo(8.59, 2)
  })

  it('is symmetric and uses the WCAG 2.2 luminance', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBe(contrastRatio('#fedcba', '#123456'))
    expect(relativeLuminance('#ffffff')).toBe(1)
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4)
  })

  it('does not round a ratio up to pass', () => {
    expect(meets(4.499, 4.5)).toBe(false)
    expect(meets(4.5, 4.5)).toBe(true)
    expect(formatRatio(4.4999)).toBe('4.49:1')
    expect(formatRatio(21)).toBe('21.00:1')
  })

  it('passes the default theme', () => {
    expect(contrastFailures(DEFAULT_TOKENS)).toEqual([])
  })

  it('lists each failing pair', () => {
    const tokens: ResolvedTokens = { ...DEFAULT_TOKENS, text: '#777777', primary: '#fde047' }
    const failures = contrastFailures(tokens)
    expect(failures.map((f) => f.pair.id)).toEqual([
      'text-on-background',
      'text-on-surface',
      'background-on-primary',
      'primary-on-surface',
    ])
    expect(failures[1]).toMatchObject({ foreground: '#777777', background: '#ffffff' })
    expect(failures[1]!.ratio).toBeCloseTo(4.48, 2)
    expect(CONTRAST_PAIRS.every((p) => p.minimum === 4.5 || p.minimum === 3)).toBe(true)
  })
})

describe('properties (ui-stack.md)', () => {
  it('sets all ten --wrx-* properties', () => {
    const props = themeProperties(DEFAULT_TOKENS)
    expect(Object.keys(props).sort()).toEqual([...WRX_PROPERTIES].sort())
    expect(props['--wrx-primary']).toBe(DEFAULT_TOKENS.primary)
    expect(props['--wrx-text']).toBe(DEFAULT_TOKENS.text)
    expect(props['--wrx-font-family']).toBe(fontStack('sans'))
    expect(fontStack('mono')).toMatch(/Plex Mono.*monospace$/)
  })

  it('derives muted, focus and danger that keep AA where possible', () => {
    for (const tokens of [
      DEFAULT_TOKENS,
      { ...DEFAULT_TOKENS, background: '#0b1120', surface: '#111827', text: '#f9fafb' },
      { ...DEFAULT_TOKENS, primary: '#fde047' },
    ]) {
      const d = deriveColours(tokens)
      for (const bg of [tokens.surface, tokens.background]) {
        expect(contrastRatio(d.muted, bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(d.danger, bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(d.focus, bg)).toBeGreaterThanOrEqual(3)
      }
      expect(d.muted).not.toBe(tokens.text)
    }
  })

  it('falls back to the text colour for focus when primary is too faint', () => {
    const tokens = { ...DEFAULT_TOKENS, primary: '#fde047' }
    expect(deriveColours(tokens).focus).toBe(tokens.text)
    expect(deriveColours(DEFAULT_TOKENS).focus).toBe(DEFAULT_TOKENS.primary)
  })

  it('mixes in sRGB', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#102030', '#102030', 0.3)).toBe('#102030')
    expect(themeDeclarations(DEFAULT_TOKENS)).toContain('--wrx-surface: #ffffff;')
  })
})

describe('assets (§3 rule 12)', () => {
  it('hashes with WebCrypto', async () => {
    expect(await sha256Hex(utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('round-trips base64, including large inputs', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251)
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big)
  })

  it('reads the type from the bytes', () => {
    expect(sniffMimeType(PNG)).toBe('image/png')
    expect(sniffMimeType(WEBP)).toBe('image/webp')
    expect(sniffMimeType(utf8('<?xml version="1.0"?>\n<svg xmlns="x"></svg>'))).toBe(
      'image/svg+xml',
    )
    expect(sniffMimeType(utf8('GIF89a'))).toBeUndefined()
    expect(sniffMimeType(utf8('<html><body>no</body></html>'))).toBeUndefined()
  })

  it('checks the declared type and size before reading', () => {
    expect(checkUpload({ type: 'image/png', size: 10 })).toBeUndefined()
    expect(checkUpload({ type: 'image/gif', size: 10 })?.code).toBe('type')
    expect(checkUpload({ type: 'image/png', size: 0 })?.code).toBe('empty')
    expect(checkUpload({ type: 'image/png', size: 100 * 1024 + 1 })?.code).toBe('too-large')
    expect(checkUpload({ type: 'image/png', size: 2000 }, { limitBytes: 1000 })?.code).toBe(
      'too-large',
    )
  })

  it('caps the configurable limit at the hard limit', () => {
    expect(assetLimitBytes()).toBe(100 * 1024)
    expect(assetLimitBytes({ limitBytes: 10 })).toBe(10)
    expect(assetLimitBytes({ limitBytes: 10_000_000 })).toBe(LIMITS.assetHardBytes)
  })

  it('builds a valid asset document from a PNG', async () => {
    const result = await createAsset({ id: 'logo', bytes: PNG, declaredType: 'image/png' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      schemaVersion: 1,
      id: 'logo',
      mimeType: 'image/png',
      size: PNG.length,
      sha256: await sha256Hex(PNG),
    })
    expect(assetDataUrl(result.value)).toBe(`data:image/png;base64,${bytesToBase64(PNG)}`)
  })

  it('refuses a file whose contents do not match its declared type', async () => {
    const result = await createAsset({ id: 'x', bytes: PNG, declaredType: 'image/webp' })
    expect(result).toMatchObject({ ok: false, error: { code: 'type-mismatch' } })
    const gif = await createAsset({ id: 'x', bytes: utf8('GIF89a....') })
    expect(gif).toMatchObject({ ok: false, error: { code: 'type' } })
  })

  it('refuses an image over the limit, or one that would not fit a server item', async () => {
    const big = new Uint8Array(5000)
    big.set(PNG)
    expect(await createAsset({ id: 'x', bytes: big }, { limitBytes: 4000 })).toMatchObject({
      ok: false,
      error: { code: 'too-large' },
    })
    expect(await createAsset({ id: 'x', bytes: big }, { itemLimitBytes: 8000 })).toMatchObject({
      ok: false,
      error: { code: 'item-limit' },
    })
  })

  it('fails closed where DOMPurify cannot sanitise (no real DOM)', async () => {
    // Under Node (and happy-dom) DOMPurify would return its input unchanged. The real-browser
    // sanitiser tests are in e2e/sanitise.spec.ts.
    expect(sanitizeSvg('<svg><script>alert(1)</script></svg>')).toMatchObject({
      ok: false,
      error: { code: 'sanitiser-unavailable' },
    })
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(await createAsset({ id: 'x', bytes: svg })).toMatchObject({ ok: false })
  })

  it('refuses an asset type it does not show as an image', () => {
    expect(assetDataUrl({ mimeType: 'text/html' as 'image/png', data: 'AA==' })).toBeUndefined()
  })
})
