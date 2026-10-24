const AREAS = ['ADM', 'PLY', 'ARC', 'NFR', 'DOC'] as const

/**
 * Requirements that apply to every PR rather than to one WP, as listed in the plan's
 * Traceability paragraph.
 */
export const CROSS_CUTTING: readonly string[] = Object.freeze([
  'ARC-15',
  'DOC-4',
  'DOC-5',
  'DOC-18',
])

export interface WorkPackage {
  readonly id: string
  readonly ids: ReadonlySet<string>
}

/** Live requirement ids in the SRD: list items `- ADM-1 ...`, excluding retired ones. */
export function srdRequirementIds(srd: string): Set<string> {
  const ids = new Set<string>()
  const pattern = new RegExp(`^[-*] ((?:${AREAS.join('|')})-\\d+) (.*)$`, 'gm')
  for (const match of srd.matchAll(pattern)) {
    const [, id, rest] = match
    if (id !== undefined && !rest?.startsWith('Retired')) ids.add(id)
  }
  return ids
}

/**
 * Expands an SRD-ids cell such as `ADM-35–40, ADM-12, NFR-3` or `PLY-4–6, 40–42`. A bare
 * number or range continues the last area named.
 */
export function expandIds(cell: string): Set<string> {
  const ids = new Set<string>()
  let area: string | undefined
  for (const token of cell.split(/,\s*/)) {
    const full = /^(ADM|PLY|ARC|NFR|DOC)-(\d+)(?:[–-](\d+))?$/.exec(token.trim())
    const bare = /^(\d+)(?:[–-](\d+))?$/.exec(token.trim())
    let from: number
    let to: number
    if (full !== null) {
      area = full[1]
      from = Number(full[2])
      to = Number(full[3] ?? full[2])
    } else if (bare !== null && area !== undefined) {
      from = Number(bare[1])
      to = Number(bare[2] ?? bare[1])
    } else {
      continue
    }
    for (let n = from; n <= to; n++) ids.add(`${area ?? ''}-${n}`)
  }
  return ids
}

/** Work packages from the plan's table: rows `| 0.5 | name | SRD ids | depends |`. */
export function planWorkPackages(plan: string): WorkPackage[] {
  const wps: WorkPackage[] = []
  for (const line of plan.split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    const id = cells[1]
    if (id === undefined || !/^\d\.\d+$/.test(id)) continue
    wps.push({ id, ids: expandIds(cells[3] ?? '') })
  }
  return wps
}

/** The README chart's node id for a WP: `2.10` → `wp210`. */
export function chartNodeId(wpId: string): string {
  return `wp${wpId.replace('.', '')}`
}

/** Node ids declared in the README's plan chart, e.g. `wp05["0.5 Scaffold"]`. */
export function chartNodes(readme: string): Set<string> {
  return new Set([...readme.matchAll(/\b(wp\d+)\["/g)].map((m) => m[1] ?? ''))
}

export interface TraceReport {
  readonly unassigned: string[]
  readonly unknown: string[]
  readonly missingFromChart: string[]
}

export function trace(srd: string, plan: string, readme: string): TraceReport {
  const live = srdRequirementIds(srd)
  const wps = planWorkPackages(plan)
  const assigned = new Set(wps.flatMap((wp) => [...wp.ids]))
  const byId = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
  const nodes = chartNodes(readme)
  return {
    unassigned: [...live]
      .filter((id) => !assigned.has(id) && !CROSS_CUTTING.includes(id))
      .sort(byId),
    unknown: [...assigned].filter((id) => !live.has(id)).sort(byId),
    missingFromChart: wps.map((wp) => wp.id).filter((id) => !nodes.has(chartNodeId(id))),
  }
}
