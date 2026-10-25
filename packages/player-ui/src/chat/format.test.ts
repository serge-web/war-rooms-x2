// The chat panel's pure helpers: rows with dividers and shared headers (PLY-43, PLY-45), local
// times, links in plain text (PLY-14) and the size check (PLY-53).
import { LIMITS } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
import { chatClock, chatRows, linkify, messageSize, safeHref, sizeNote } from './format.ts'
import type { ChatMessage } from './format.ts'

const utc = chatClock({ locale: 'en-GB', timeZone: 'UTC' })

function msg(id: string, timestamp: string, senderKey: string): ChatMessage {
  return { id, timestamp, senderKey, senderName: senderKey, self: false, text: id }
}

describe('chatRows', () => {
  it('shares one header across a sender’s run and puts a divider between days', () => {
    const rows = chatRows(
      [
        msg('a', '2026-10-24T08:40:00Z', 'blue-co'),
        msg('b', '2026-10-24T08:41:00Z', 'blue-co'),
        msg('c', '2026-10-24T08:42:00Z', 'red-co'),
        msg('d', '2026-10-25T07:00:00Z', 'red-co'),
        msg('e', '2026-10-25T07:01:00Z', 'red-co'),
      ],
      utc,
    )
    expect(rows.map((r) => [r.key, r.header, r.last, r.divider])).toEqual([
      ['a', true, false, 'Saturday, 24 October 2026'],
      ['b', false, true, undefined],
      ['c', true, true, undefined],
      // A new day opens a new run even from the same sender.
      ['d', true, false, 'Sunday, 25 October 2026'],
      ['e', false, true, undefined],
    ])
  })

  it('uses local wall-clock time and local days (PLY-45)', () => {
    const tokyo = chatClock({ locale: 'en-GB', timeZone: 'Asia/Tokyo' })
    const ms = Date.parse('2026-10-24T20:30:00Z')
    expect(tokyo.time(ms)).toBe('05:30')
    expect(tokyo.dayKey(ms)).toBe('2026-10-25')
    expect(utc.time(ms)).toBe('20:30')
    const rows = chatRows(
      [msg('a', '2026-10-24T14:00:00Z', 'x'), msg('b', '2026-10-24T16:00:00Z', 'x')],
      tokyo,
    )
    expect(rows.map((r) => r.divider)).toEqual([
      'Saturday, 24 October 2026',
      'Sunday, 25 October 2026',
    ])
  })

  it('handles 10,000 messages quickly (NFR-11)', () => {
    const many = Array.from({ length: 10_000 }, (_, i) =>
      msg(`m${i}`, new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(), `r${i % 3}`),
    )
    const start = performance.now()
    const rows = chatRows(many, utc)
    expect(rows).toHaveLength(10_000)
    expect(performance.now() - start).toBeLessThan(500)
  })
})

describe('linkify (PLY-14)', () => {
  it('links http and https URLs and leaves the rest as text', () => {
    expect(linkify('See https://example.org/a?b=1, then (http://x.test/y).')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://example.org/a?b=1', href: 'https://example.org/a?b=1' },
      { kind: 'text', text: ', then (' },
      { kind: 'link', text: 'http://x.test/y', href: 'http://x.test/y' },
      { kind: 'text', text: ').' },
    ])
    expect(linkify('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      {
        kind: 'link',
        text: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        href: 'https://en.wikipedia.org/wiki/Foo_(bar)',
      },
    ])
  })

  it('never links another scheme, and treats markup as text', () => {
    for (const hostile of [
      'javascript:alert(1)',
      '<a href="javascript:alert(1)">x</a>',
      'data:text/html,<script>alert(1)</script>',
      '[x](javascript:alert(1))',
      '<img src=x onerror=alert(1)>',
    ]) {
      expect(linkify(hostile)).toEqual([{ kind: 'text', text: hostile }])
    }
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('https://ok.test/')).toBe('https://ok.test/')
  })
})

describe('messageSize (PLY-53)', () => {
  it('measures against both caps, as the store checks them', () => {
    const fine = messageSize('hello')
    expect(fine).toMatchObject({ chars: 5, over: undefined, near: false })
    expect(fine.byteLimit).toBe(LIMITS.messageStanzaBytes)
    expect(sizeNote(fine)).toBeUndefined()

    const near = messageSize('x'.repeat(LIMITS.messageTextChars - 10))
    expect(near).toMatchObject({ over: undefined, near: true })
    expect(sizeNote(near)).toBe('10 characters left.')

    const over = messageSize('x'.repeat(LIMITS.messageTextChars + 1))
    expect(over.over).toBe('chars')
    expect(sizeNote(over)).toMatch(/^Too long: 8,001 of 8,000 characters/)
  })

  it('counts bytes after JSON and XML escaping', () => {
    const quotes = messageSize('"'.repeat(1000))
    // `"` becomes `\"` in JSON, then `\&quot;` in XML: 7 bytes each.
    expect(quotes.bytes).toBeGreaterThan(7000)
    expect(quotes.over).toBeUndefined()
  })
})
