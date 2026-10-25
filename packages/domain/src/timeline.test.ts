import { describe, expect, it } from 'vitest'
import { Timeline, timeKey } from './timeline.ts'
import type { TimelineEntry } from './timeline.ts'

function entry(id: string, timestamp: string): TimelineEntry {
  return {
    kind: 'message',
    id,
    roomId: 'r',
    timestamp,
    sender: { nick: 'n', jid: undefined, roleId: undefined, isAdmin: false },
    body: { type: 'chat', schemaVersion: 1, content: { text: id } },
  }
}

const t = (s: number) => `2026-10-24T10:00:${String(s).padStart(2, '0')}.000Z`
const ids = (timeline: Timeline) => timeline.entries().map((e) => e.id)

describe('timeKey', () => {
  it('orders sub-millisecond digits and offsets', () => {
    const a = timeKey('2026-10-24T10:00:00.123456Z')
    const b = timeKey('2026-10-24T10:00:00.123457Z')
    expect(a?.ms).toBe(b?.ms)
    expect(a?.micros).toBe(456)
    expect(b?.micros).toBe(457)
    expect(timeKey('2026-10-24T12:00:00+02:00')?.ms).toBe(timeKey('2026-10-24T10:00:00Z')?.ms)
    expect(timeKey('2026-10-24T10:00:00Z')?.micros).toBe(0)
  })

  it('rejects what is not ISO 8601', () => {
    expect(timeKey('yesterday')).toBeUndefined()
    expect(timeKey('2026-13-45T99:99:99Z')).toBeUndefined()
    expect(timeKey('')).toBeUndefined()
  })
})

describe('Timeline (ARC-4)', () => {
  it('orders by server time, then stanza-id', () => {
    const timeline = new Timeline()
    timeline.merge([entry('c', t(2)), entry('b', t(1)), entry('a', t(2))])
    expect(ids(timeline)).toEqual(['b', 'a', 'c'])
  })

  it('merges idempotently: duplicates by stanza-id are dropped', () => {
    const timeline = new Timeline()
    expect(timeline.merge([entry('a', t(1)), entry('b', t(2))])).toBe(2)
    expect(timeline.merge([entry('b', t(2)), entry('a', t(1))])).toBe(0)
    expect(timeline.merge([entry('a', t(9))])).toBe(0)
    expect(ids(timeline)).toEqual(['a', 'b'])
  })

  it('appends newer, prepends older, and interleaves overlapping batches', () => {
    const timeline = new Timeline()
    timeline.merge([entry('m', t(10))])
    timeline.merge([entry('n', t(11))])
    timeline.merge([entry('a', t(1)), entry('b', t(2))])
    timeline.merge([entry('x', t(5))])
    timeline.merge([entry('y', t(3)), entry('z', t(12)), entry('w', t(0))])
    expect(ids(timeline)).toEqual(['w', 'a', 'b', 'y', 'x', 'm', 'n', 'z'])
    expect(timeline.oldest()?.id).toBe('w')
    expect(timeline.newest()?.id).toBe('z')
    expect(timeline.size).toBe(8)
  })

  it('skips entries with a bad timestamp', () => {
    const timeline = new Timeline()
    expect(timeline.merge([entry('a', 'nonsense')])).toBe(0)
    expect(timeline.has('a')).toBe(false)
  })

  it('keeps the snapshot identity until something changes', () => {
    const timeline = new Timeline()
    timeline.merge([entry('a', t(1))])
    const first = timeline.entries()
    expect(timeline.entries()).toBe(first)
    timeline.merge([entry('a', t(1))])
    expect(timeline.entries()).toBe(first)
    timeline.merge([entry('b', t(2))])
    expect(timeline.entries()).not.toBe(first)
    expect(Object.isFrozen(timeline.entries())).toBe(true)
  })

  it('clears', () => {
    const timeline = new Timeline()
    timeline.merge([entry('a', t(1))])
    timeline.clear()
    expect(timeline.entries()).toEqual([])
    expect(timeline.oldest()).toBeUndefined()
    expect(timeline.newest()).toBeUndefined()
  })

  it('holds 10,000 messages from MAM pages and live delivery quickly (NFR-11)', () => {
    const timeline = new Timeline()
    const all: TimelineEntry[] = []
    for (let i = 0; i < 10_000; i++) {
      const ts = new Date(Date.UTC(2026, 9, 24, 0, 0, 0, i * 7)).toISOString()
      all.push(entry(`id-${String(i).padStart(5, '0')}`, ts))
    }
    const started = performance.now()
    // Live delivery of the newest 2,000, then MAM pages of 50 backwards, with overlaps.
    for (const e of all.slice(8_000)) {
      timeline.merge([e])
      timeline.entries()
    }
    for (let end = 8_050; end > 0; end -= 50) {
      timeline.merge(all.slice(Math.max(0, end - 60), end))
      timeline.entries()
    }
    const elapsed = performance.now() - started
    expect(timeline.size).toBe(10_000)
    expect(ids(timeline)).toEqual(all.map((e) => e.id))
    expect(elapsed).toBeLessThan(1_000)
  })
})
