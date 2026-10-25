// One room's messages (ARC-4): keyed by stanza-id, ordered by server timestamp with ties broken
// by stanza-id, and merged idempotently from MAM pages and live delivery (PLY-10, PLY-49).
//
// Sized for 10,000 messages a room (NFR-11): a Map gives O(1) de-duplication, and the ordered
// array takes live messages (newest, the common case) by push and an older MAM page by one
// merge pass. Snapshots are frozen copies made only when read after a change, so a burst of
// stanzas costs one copy, not one per stanza.
import type { MessageBody } from '@wrx/schemas'

/** Who sent a message, from the stanza alone (§3 rule 3); display data comes from documents. */
export interface Sender {
  /** The occupant nickname. Shared by every session of a role (D22). */
  readonly nick: string
  /** The sender's bare JID, as the non-anonymous room reveals it. */
  readonly jid: string | undefined
  /** The role id: the JID's local part when it is on this game's domain. */
  readonly roleId: string | undefined
  /** The sender is the server's `admin` account (D3). */
  readonly isAdmin: boolean
}

interface EntryBase {
  /** The stanza-id: the key across live delivery and MAM. */
  readonly id: string
  readonly roomId: string
  /** Server time, ISO 8601, as received. */
  readonly timestamp: string
  readonly sender: Sender
}

export interface ReadableEntry extends EntryBase {
  readonly kind: 'message'
  readonly body: MessageBody
}

/** A message whose body failed validation: shown as unreadable, never a crash (R9, NFR-5). */
export interface UnreadableEntry extends EntryBase {
  readonly kind: 'unreadable'
  readonly reason: string
}

export type TimelineEntry = ReadableEntry | UnreadableEntry

interface Keyed {
  readonly entry: TimelineEntry
  readonly ms: number
  /** Sub-millisecond digits of the timestamp, so ejabberd's microseconds still order. */
  readonly micros: number
}

/** Sort key of an ISO 8601 timestamp, or `undefined` if it is not one. */
export function timeKey(timestamp: string): { ms: number; micros: number } | undefined {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(timestamp)) return undefined
  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms)) return undefined
  const fraction = /\.(\d+)/.exec(timestamp)?.[1] ?? ''
  const micros = Number(fraction.slice(3, 6).padEnd(3, '0'))
  return { ms, micros }
}

function compare(a: Keyed, b: Keyed): number {
  return (
    a.ms - b.ms ||
    a.micros - b.micros ||
    (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0)
  )
}

export class Timeline {
  private readonly byId = new Map<string, Keyed>()
  private ordered: Keyed[] = []
  private snapshot: readonly TimelineEntry[] = Object.freeze([])
  private dirty = false

  get size(): number {
    return this.ordered.length
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  /** Oldest entry, or `undefined` when empty. */
  oldest(): TimelineEntry | undefined {
    return this.ordered[0]?.entry
  }

  newest(): TimelineEntry | undefined {
    return this.ordered[this.ordered.length - 1]?.entry
  }

  /**
   * Adds entries not already present; returns how many were added. Entries with a timestamp
   * that is not ISO 8601 are rejected by the caller, via {@link timeKey}.
   */
  merge(entries: readonly TimelineEntry[]): number {
    const fresh: Keyed[] = []
    for (const entry of entries) {
      if (this.byId.has(entry.id)) continue
      const key = timeKey(entry.timestamp)
      if (key === undefined) continue
      const keyed = { entry, ...key }
      this.byId.set(entry.id, keyed)
      fresh.push(keyed)
    }
    if (fresh.length === 0) return 0
    fresh.sort(compare)
    const last = this.ordered[this.ordered.length - 1]
    const first = this.ordered[0]
    const freshFirst = fresh[0]
    const freshLast = fresh[fresh.length - 1]
    if (freshFirst === undefined || freshLast === undefined) return 0
    if (last === undefined || compare(freshFirst, last) > 0) {
      for (const keyed of fresh) this.ordered.push(keyed)
    } else if (first !== undefined && compare(freshLast, first) < 0) {
      this.ordered = [...fresh, ...this.ordered]
    } else if (fresh.length === 1) {
      this.ordered.splice(this.insertionIndex(freshFirst), 0, freshFirst)
    } else {
      this.ordered = mergeSorted(this.ordered, fresh)
    }
    this.dirty = true
    return fresh.length
  }

  /** Drops everything, e.g. when a reconnection gap is too large to bridge. */
  clear(): void {
    this.byId.clear()
    this.ordered = []
    this.dirty = true
  }

  /** The entries, oldest first. The same array until the next change. */
  entries(): readonly TimelineEntry[] {
    if (this.dirty) {
      this.snapshot = Object.freeze(this.ordered.map((k) => k.entry))
      this.dirty = false
    }
    return this.snapshot
  }

  private insertionIndex(keyed: Keyed): number {
    let lo = 0
    let hi = this.ordered.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      const probe = this.ordered[mid]
      if (probe !== undefined && compare(probe, keyed) < 0) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}

function mergeSorted(a: readonly Keyed[], b: readonly Keyed[]): Keyed[] {
  const out: Keyed[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const x = a[i]
    const y = b[j]
    if (y === undefined || (x !== undefined && compare(x, y) <= 0)) {
      if (x !== undefined) out.push(x)
      i++
    } else {
      out.push(y)
      j++
    }
  }
  return out
}
