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

export interface Scenario {
  /** `SC-1` */
  readonly id: string
  /** The SRD's "Traces to" list, as written, without the final full stop. */
  readonly traces: string
}

/** The user scenarios of SRD §12: `### SC-1 Title` headings and their `**Traces to:**` line. */
export function srdScenarios(srd: string): Scenario[] {
  const scenarios: Scenario[] = []
  for (const block of srd.split(/^### /m).slice(1)) {
    const id = /^(SC-\d+) /.exec(block)?.[1]
    const traces = /\*\*Traces to:\*\* (.+?)\.?\s*$/m.exec(block)?.[1]
    if (id !== undefined && traces !== undefined) scenarios.push({ id, traces })
  }
  return scenarios
}

/**
 * NFR-17: each scenario has one Playwright spec, `sc-<n>-<name>.spec.ts`, whose header names the
 * scenario and lists the SRD ids it covers, the same as the SRD's "Traces to" line. Problems,
 * one per line; `specs` maps file names to their text.
 */
export function scenarioProblems(
  scenarios: readonly Scenario[],
  specs: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = []
  for (const { id, traces } of scenarios) {
    const prefix = `sc-${id.slice(3)}-`
    const files = [...specs.keys()].filter((f) => f.startsWith(prefix) && f.endsWith('.spec.ts'))
    if (files.length !== 1) {
      problems.push(
        `${id} needs one spec ${prefix}*.spec.ts in the scenarios folder; found ${files.length}`,
      )
      continue
    }
    const file = files[0] ?? ''
    // The header comment, joined across its lines.
    const header = (specs.get(file) ?? '')
      .split('\n')
      .filter((line) => line.startsWith('//'))
      .map((line) => line.replace(/^\/\/ ?/, ''))
      .join(' ')
    if (!header.includes(id)) problems.push(`${file} does not name ${id} in its header`)
    if (!header.replace(/\s+/g, ' ').includes(`Traces to: ${traces}.`)) {
      problems.push(`${file} must say "Traces to: ${traces}." as SRD §12 does`)
    }
  }
  return problems
}
