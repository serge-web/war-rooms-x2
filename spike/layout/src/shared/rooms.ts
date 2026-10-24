// Library-agnostic layout rules. WP 2.5 keeps these pure and puts one adapter per library
// behind them (ARC-9).

export interface Room {
  id: string
  name: string
  /** Per-room theme token, applied as a scoped CSS custom property (PLY-26). */
  accent: string
}

export function room(id: string): Room {
  const n = Number(id.replace(/^r/, ''))
  return { id, name: `Room ${n}`, accent: `hsl(${(n * 47) % 360} 70% 40%)` }
}

export function makeRooms(count: number, first = 1): Room[] {
  return Array.from({ length: count }, (_, i) => room(`r${first + i}`))
}

export const MAX_COLUMNS = 3

/**
 * PLY-40: spread rooms evenly over up to three side-by-side columns, with only as many
 * columns as rooms. Contiguous runs keep the room order reading left to right; column
 * sizes differ by at most one, larger first (7 rooms: 3, 2, 2).
 */
export function defaultColumns<T>(rooms: readonly T[], maxColumns = MAX_COLUMNS): T[][] {
  const columns = Math.min(maxColumns, rooms.length)
  const out: T[][] = []
  let next = 0
  for (let c = 0; c < columns; c++) {
    const size = Math.ceil((rooms.length - next) / (columns - c))
    out.push(rooms.slice(next, next + size))
    next += size
  }
  return out
}

/** PLY-41: index of the tabset with the fewest tabs; the first such on a tie, -1 if none. */
export function pickFewest(counts: readonly number[]): number {
  let best = -1
  counts.forEach((count, i) => {
    if (best === -1 || count < (counts[best] ?? Infinity)) best = i
  })
  return best
}

/** D6, PLY-6: which rooms to drop from, and add to, a restored layout. */
export function reconcilePlan(
  present: readonly string[],
  wanted: readonly string[],
): { remove: string[]; add: string[] } {
  const want = new Set(wanted)
  const have = new Set(present)
  return {
    remove: present.filter((id) => !want.has(id)),
    add: wanted.filter((id) => !have.has(id)),
  }
}
