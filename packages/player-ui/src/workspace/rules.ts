// The workspace's layout rules, free of any layout library (ARC-9): the PLY-40 default columns,
// and when a layout no longer fits the role's rooms (PLY-5). The FlexLayout adapter in
// `model.ts` applies them; they are kept apart so a library switch keeps the rules.
//
// Since the Nov 3, 2026 revision a layout is never adapted to new or lost rooms in place (PLY-6
// and PLY-41 are retired): a structural design change resets it to the default (PLY-5).

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

/**
 * PLY-5: whether a layout holding the room tabs `present` fits the rooms `wanted`: the same
 * rooms, in any arrangement. One that does not is replaced by the default, never adapted.
 */
export function sameRooms(present: readonly string[], wanted: readonly string[]): boolean {
  const want = new Set(wanted)
  return new Set(present).size === want.size && present.every((id) => want.has(id))
}
