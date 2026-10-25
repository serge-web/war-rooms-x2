// Pure helpers of the chat panel (WP 2.6): the rows of the message list with their date dividers
// and shared headers (PLY-43, PLY-45), local wall-clock times, links found in plain text
// (PLY-14), and the composer's size check against the stanza cap (PLY-53). No React, no store.
import { fitsInStanza } from '@wrx/domain'
import { LIMITS } from '@wrx/schemas'

/** One message as the panel shows it: display data resolved, nothing left to look up. */
export interface ChatMessage {
  /** The stanza-id. */
  readonly id: string
  /** Server time, ISO 8601. */
  readonly timestamp: string
  /** Who sent it, for grouping: a role id, `admin`, or `nick:<nick>` for anyone else. */
  readonly senderKey: string
  /** The role's name, resolved live from the role document (§3 rule 6). */
  readonly senderName: string
  /** The sender's force name, when known. */
  readonly forceName?: string | undefined
  /** The force colour (PLY-43). */
  readonly colour?: string | undefined
  /** Sent by this role, from any of its sessions (D22). */
  readonly self: boolean
  /** The plain text; `undefined` when the body could not be read (R9). */
  readonly text: string | undefined
}

/** A row of the list: one message, with what is drawn above it. */
export interface ChatRow {
  readonly key: string
  readonly message: ChatMessage
  /** The date divider above this message: it is the first of its local day (PLY-45). */
  readonly divider: string | undefined
  /** The first of a run from one sender, so it carries the header (PLY-43). */
  readonly header: boolean
  /** The last of its run, so its card closes. */
  readonly last: boolean
}

export interface TimeFormat {
  /** BCP 47 locale; default the browser's. */
  readonly locale?: string | undefined
  /** IANA time zone; default the browser's. Tests and stories pin it. */
  readonly timeZone?: string | undefined
}

/** Formatters for one locale and zone. Make one per panel, not one per message. */
export interface ChatClock {
  /** `YYYY-MM-DD` in local time, for comparing days. */
  dayKey(ms: number): string
  /** The date divider's text, e.g. "Saturday, 24 October 2026". */
  dayLabel(ms: number): string
  /** Local wall-clock time only, e.g. "08:40" (PLY-45). */
  time(ms: number): string
}

export function chatClock({ locale, timeZone }: TimeFormat = {}): ChatClock {
  const zone = timeZone === undefined ? {} : { timeZone }
  const day = new Intl.DateTimeFormat('en-CA', {
    ...zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const label = new Intl.DateTimeFormat(locale, {
    ...zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const time = new Intl.DateTimeFormat(locale, { ...zone, hour: '2-digit', minute: '2-digit' })
  return {
    dayKey: (ms) => day.format(ms),
    dayLabel: (ms) => label.format(ms),
    time: (ms) => time.format(ms),
  }
}

/**
 * The list's rows, oldest first. A message opens a new run, with a header, after a different
 * sender or a date divider. O(n), one date format a message: fine for 10,000 (NFR-11).
 */
export function chatRows(messages: readonly ChatMessage[], clock: ChatClock): readonly ChatRow[] {
  const rows: ChatRow[] = []
  let previousDay: string | undefined
  let previousSender: string | undefined
  for (const message of messages) {
    const ms = Date.parse(message.timestamp)
    const day = Number.isNaN(ms) ? '' : clock.dayKey(ms)
    const divider = day !== previousDay && !Number.isNaN(ms) ? clock.dayLabel(ms) : undefined
    const header = divider !== undefined || message.senderKey !== previousSender
    const before = rows[rows.length - 1]
    if (header && before !== undefined && !before.last) {
      rows[rows.length - 1] = { ...before, last: true }
    }
    rows.push({ key: message.id, message, divider, header, last: false })
    previousDay = day
    previousSender = message.senderKey
  }
  const final = rows[rows.length - 1]
  if (final !== undefined) rows[rows.length - 1] = { ...final, last: true }
  return Object.freeze(rows)
}

// ---- Links (PLY-14) ---------------------------------------------------------------------------

export type TextPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }

const TRAILING = '.,;:!?\'"'

/** Trims punctuation that ends a sentence rather than the URL; keeps balanced brackets. */
function trimUrl(candidate: string): string {
  let url = candidate
  for (;;) {
    const last = url.at(-1)
    if (last === undefined) return url
    if (TRAILING.includes(last)) {
      url = url.slice(0, -1)
      continue
    }
    const pairs: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' }
    const open = pairs[last]
    if (open !== undefined && url.split(open).length < url.split(last).length) {
      url = url.slice(0, -1)
      continue
    }
    return url
  }
}

/** A safe link target: an absolute http or https URL, or `undefined`. */
export function safeHref(text: string): string | undefined {
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Splits plain text into text and links. Only `http://` and `https://` URLs become links, so
 * no other scheme (`javascript:`, `data:`) can ever reach an `href`. Never parses HTML or
 * Markdown: the parts are rendered as React text (PLY-14).
 */
export function linkify(text: string): readonly TextPart[] {
  const parts: TextPart[] = []
  const pattern = /\bhttps?:\/\/[^\s<>"]+/gi
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const url = trimUrl(match[0])
    const href = safeHref(url)
    if (href === undefined || url.length <= 'https://'.length) continue
    if (match.index > at) parts.push({ kind: 'text', text: text.slice(at, match.index) })
    parts.push({ kind: 'link', text: url, href })
    at = match.index + url.length
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) })
  return parts
}

// ---- Size (PLY-53) ----------------------------------------------------------------------------

export interface MessageSize {
  readonly chars: number
  readonly charLimit: number
  /** The stanza's size: UTF-8 after XML escaping, with the envelope allowance. */
  readonly bytes: number
  readonly byteLimit: number
  /** Which cap the text is over, if any. */
  readonly over: 'chars' | 'bytes' | undefined
  /** Within 10% of a cap, so the composer shows the count. */
  readonly near: boolean
}

/** The size of `text` as a chat message, against both caps, as the store will check it. */
export function messageSize(text: string): MessageSize {
  const body = JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text } })
  const { bytes, limitBytes } = fitsInStanza(body)
  const charLimit = LIMITS.messageTextChars
  const over: MessageSize['over'] =
    text.length > charLimit ? 'chars' : bytes > limitBytes ? 'bytes' : undefined
  return {
    chars: text.length,
    charLimit,
    bytes,
    byteLimit: limitBytes,
    over,
    near: text.length > charLimit * 0.9 || bytes > limitBytes * 0.9,
  }
}

/** What the composer says about the size, or `undefined` when nothing needs saying. */
export function sizeNote(size: MessageSize): string | undefined {
  if (size.over === 'chars') {
    return `Too long: ${size.chars.toLocaleString('en')} of ${size.charLimit.toLocaleString('en')} characters. Shorten it to send.`
  }
  if (size.over === 'bytes') {
    return `Too large to send: ${kib(size.bytes)} of ${kib(size.byteLimit)}. Shorten it to send.`
  }
  if (size.chars > size.charLimit * 0.9) {
    return `${(size.charLimit - size.chars).toLocaleString('en')} characters left.`
  }
  if (size.near) return `Nearly at the size limit: ${kib(size.bytes)} of ${kib(size.byteLimit)}.`
  return undefined
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}
