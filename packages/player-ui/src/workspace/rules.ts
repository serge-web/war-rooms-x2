// The workspace's layout rules, free of any layout library (ARC-9): the PLY-40 default columns,
// the PLY-41 choice of tabset, and the D6/PLY-6 reconciliation plan. The FlexLayout adapter in
// `model.ts` applies them; they are kept apart so a library switch keeps the rules.

/** PLY-40: at most this many side-by-side columns in the default layout. */
export const MAX_COLUMNS = 3

/**
 * PLY-40: spreads items evenly over up to `maxColumns` columns, with only as many columns as
 * items. Columns hold contiguous runs, so the order reads left to right, and their sizes differ
 * by at most one, larger first (7 rooms: 3, 2, 2).
 */
export function defaultColumns<T>(items: readonly T[], maxColumns = MAX_COLUMNS): T[][] {
  const columns = Math.min(Math.max(1, Math.floor(maxColumns)), items.length)
  const out: T[][] = []
  let next = 0
  for (let c = 0; c < columns; c++) {
    const size = Math.ceil((items.length - next) / (columns - c))
    out.push(items.slice(next, next + size))
    next += size
  }
  return out
}

/** PLY-41: the index of the smallest count, the first on a tie; -1 when there are none. */
export function pickFewest(counts: readonly number[]): number {
  let best = -1
  for (const [i, count] of counts.entries()) {
    if (best === -1 || count < (counts[best] ?? Infinity)) best = i
  }
  return best
}

export interface ReconcilePlan {
  /** Present but no longer wanted, in present order. */
  readonly remove: readonly string[]
  /** Wanted but not present, in wanted order. */
  readonly add: readonly string[]
}

/** D6, PLY-6: what to drop from, and add to, a layout so it holds exactly `wanted`. */
export function reconcilePlan(
  present: readonly string[],
  wanted: readonly string[],
): ReconcilePlan {
  const want = new Set(wanted)
  const have = new Set(present)
  return {
    remove: present.filter((id) => !want.has(id)),
    add: wanted.filter((id) => !have.has(id)),
  }
}
