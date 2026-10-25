// Theme images (SRD §3 rule 12, R11): PNG, WebP or SVG, within the admin's size limit and inside
// one PubSub item. The type is read from the bytes, not trusted from the file name or browser.
// SVG is sanitised with DOMPurify's SVG profile on upload, and every image is shown only through
// `<img>` from a data URL, never inlined, so an SVG cannot run script even if one got through.
import DOMPurify from 'dompurify'
import { ASSET_MIME_TYPES, LIMITS, assetSchema, checkItemSize } from '@wrx/schemas'
import type { Asset, AssetMimeType, Result } from '@wrx/schemas'

export type AssetProblemCode =
  | 'empty'
  | 'type'
  | 'type-mismatch'
  | 'too-large'
  | 'item-limit'
  | 'svg'
  | 'sanitiser-unavailable'
  | 'invalid'

export interface AssetProblem {
  readonly code: AssetProblemCode
  readonly message: string
}

export interface AssetOptions {
  /**
   * The admin's asset limit in decoded bytes; defaults to `LIMITS.assetDefaultBytes` (100 KB) and
   * is capped at `LIMITS.assetHardBytes`, the largest asset whose base64 form fits an item.
   */
  readonly limitBytes?: number
  /** The server's PubSub item limit; defaults to ejabberd's (`LIMITS.pubsubItemBytes`). */
  readonly itemLimitBytes?: number
}

/** What an upload `<input>` should accept. */
export const ASSET_ACCEPT = ASSET_MIME_TYPES.join(',')

/** The limit that applies, after the hard cap. */
export function assetLimitBytes(options: AssetOptions = {}): number {
  return Math.min(options.limitBytes ?? LIMITS.assetDefaultBytes, LIMITS.assetHardBytes)
}

function problem(code: AssetProblemCode, message: string): { ok: false; error: AssetProblem } {
  return { ok: false, error: { code, message } }
}

/**
 * The quick check before a file is read: its declared type and size. `createAsset` checks the
 * bytes themselves afterwards.
 */
export function checkUpload(
  file: { readonly type: string; readonly size: number },
  options: AssetOptions = {},
): AssetProblem | undefined {
  if (file.size === 0) return { code: 'empty', message: 'The file is empty.' }
  if (file.type !== '' && !isAssetMimeType(file.type)) {
    return { code: 'type', message: `Use a PNG, WebP or SVG image, not ${file.type}.` }
  }
  const limit = assetLimitBytes(options)
  if (file.size > limit) return tooLarge(file.size, limit)
  return undefined
}

export function isAssetMimeType(type: string): type is AssetMimeType {
  return (ASSET_MIME_TYPES as readonly string[]).includes(type)
}

/** The image type from the file's first bytes, or undefined when it is none of the three. */
export function sniffMimeType(bytes: Uint8Array): AssetMimeType | undefined {
  const starts = (sig: readonly number[], at = 0) => sig.every((b, i) => bytes[at + i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  const text = decodeUtf8(bytes.subarray(0, 4096), false)
  if (text === undefined) return undefined
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (/^\s*</.test(body) && /<svg[\s>/]/i.test(body)) return 'image/svg+xml'
  return undefined
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const FORBIDDEN_ELEMENTS: readonly string[] = Object.freeze([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
])

function unavailable() {
  return problem('sanitiser-unavailable', 'SVG cannot be checked in this browser.')
}

/**
 * Sanitises an SVG document with DOMPurify's SVG profile (scripts, event handlers, foreign
 * objects and `javascript:` links are removed), drops links to anything outside the image, and
 * serialises it as a standalone SVG file. Fails closed: where DOMPurify cannot work (no real
 * DOM, as under happy-dom or Node), it returns an error rather than the input.
 */
export function sanitizeSvg(svg: string): Result<string, AssetProblem> {
  if (!DOMPurify.isSupported || typeof XMLSerializer === 'undefined') return unavailable()
  const fragment = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
  })
  const elements = [...fragment.children]
  const root = elements[0]
  if (elements.length !== 1 || root?.namespaceURI !== SVG_NS || root.localName !== 'svg') {
    return problem('svg', 'The file is not a single SVG image.')
  }
  for (const el of [root, ...root.querySelectorAll('*')]) {
    // A DOM emulation can report support and still not sanitise; never trust its output.
    if (FORBIDDEN_ELEMENTS.includes(el.localName.toLowerCase())) return unavailable()
    for (const attr of [...el.attributes]) {
      if (attr.localName.toLowerCase().startsWith('on')) return unavailable()
      const isLink =
        attr.localName === 'href' && (attr.namespaceURI === null || attr.namespaceURI === XLINK_NS)
      if (isLink && !attr.value.trim().startsWith('#')) el.removeAttributeNode(attr)
    }
  }
  return { ok: true, value: new XMLSerializer().serializeToString(root) }
}

export interface AssetInput {
  /** The new asset's id (a slug). */
  readonly id: string
  readonly bytes: Uint8Array
  /** The type the browser reported, or '' when it reported none. */
  readonly declaredType?: string
}

/**
 * Builds an asset document from uploaded bytes: checks the type from the bytes (and that it
 * matches the declared one), sanitises SVG, checks the size against the limit, hashes the stored
 * bytes, and checks the document fits in one PubSub item.
 */
export async function createAsset(
  input: AssetInput,
  options: AssetOptions = {},
): Promise<Result<Asset, AssetProblem>> {
  if (input.bytes.length === 0) return problem('empty', 'The file is empty.')
  const declared = input.declaredType ?? ''
  if (declared !== '' && !isAssetMimeType(declared)) {
    return problem('type', `Use a PNG, WebP or SVG image, not ${declared}.`)
  }
  const mimeType = sniffMimeType(input.bytes)
  if (mimeType === undefined) return problem('type', 'The file is not a PNG, WebP or SVG image.')
  if (declared !== '' && declared !== mimeType) {
    return problem('type-mismatch', `The file says it is ${declared} but its contents are not.`)
  }

  let bytes = input.bytes
  if (mimeType === 'image/svg+xml') {
    const text = decodeUtf8(input.bytes, true)
    if (text === undefined) return problem('svg', 'The SVG is not valid UTF-8 text.')
    const clean = sanitizeSvg(text)
    if (!clean.ok) return clean
    bytes = new TextEncoder().encode(clean.value)
  }

  const limit = assetLimitBytes(options)
  if (bytes.length > limit) return { ok: false, error: tooLarge(bytes.length, limit) }

  const candidate = {
    schemaVersion: 1,
    id: input.id,
    mimeType,
    size: bytes.length,
    sha256: await sha256Hex(bytes),
    data: bytesToBase64(bytes),
  }
  const parsed = assetSchema.safeParse(candidate)
  if (!parsed.success) {
    return problem('invalid', parsed.error.issues[0]?.message ?? 'The asset is not valid.')
  }
  const fit = checkItemSize(parsed.data, options.itemLimitBytes)
  if (!fit.ok) {
    return problem(
      'item-limit',
      `The image needs ${fit.bytes} bytes once encoded, more than the server's ${fit.limitBytes}-byte item limit.`,
    )
  }
  return { ok: true, value: parsed.data }
}

/** `createAsset` from a `File` or `Blob`, after the quick `checkUpload`. */
export async function assetFromFile(
  file: Blob,
  id: string,
  options: AssetOptions = {},
): Promise<Result<Asset, AssetProblem>> {
  const early = checkUpload(file, options)
  if (early !== undefined) return { ok: false, error: early }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return createAsset({ id, bytes, declaredType: file.type }, options)
}

/** SHA-256 with WebCrypto, as lowercase hex (the `sha256` field). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The asset as a `data:` URL for an `<img src>`, or undefined when its type is not an image type
 * we show. Never put the decoded SVG into the page: an `<img>` is what keeps it inert.
 */
export function assetDataUrl(asset: Pick<Asset, 'mimeType' | 'data'>): string | undefined {
  if (!isAssetMimeType(asset.mimeType)) return undefined
  return `data:${asset.mimeType};base64,${asset.data}`
}

function tooLarge(bytes: number, limit: number): AssetProblem {
  return {
    code: 'too-large',
    message: `The image is ${formatKb(bytes)}; the limit is ${formatKb(limit)}.`,
  }
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function decodeUtf8(bytes: Uint8Array, fatal: boolean): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal }).decode(bytes)
  } catch {
    return undefined
  }
}
