// DOC-14: report the site's size and warn at 70% of the GitHub Pages limit (about 1 GB).
import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** GitHub's published-site limit, taken as 10^9 bytes so the warning comes early. */
export const PAGES_LIMIT = 1_000_000_000
export const WARN_AT = 0.7

export function dirSize(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(path)
    else if (entry.isFile()) total += lstatSync(path).size
  }
  return total
}

export interface Area {
  /** `site` for the root site's own files, else `demo`, `pr/<n>` or `snapshots/<slug>`. */
  readonly name: string
  readonly bytes: number
}

/** Sizes of a gh-pages tree, split into the root site, the demo, each preview and snapshot. */
export function areas(dir: string): Area[] {
  const out: Area[] = []
  let site = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory() && (entry.name === 'pr' || entry.name === 'snapshots')) {
      for (const child of readdirSync(path, { withFileTypes: true })) {
        const childPath = join(path, child.name)
        const bytes = child.isDirectory() ? dirSize(childPath) : lstatSync(childPath).size
        out.push({ name: `${entry.name}/${child.name}`, bytes })
      }
    } else if (entry.isDirectory() && entry.name === 'demo') {
      out.push({ name: 'demo', bytes: dirSize(path) })
    } else {
      site += entry.isDirectory() ? dirSize(path) : entry.isFile() ? lstatSync(path).size : 0
    }
  }
  return [{ name: 'site', bytes: site }, ...out]
}

export type Level = 'ok' | 'warn' | 'over'

export interface SizeReport {
  readonly total: number
  readonly limit: number
  readonly ratio: number
  readonly level: Level
  readonly areas: readonly Area[]
}

export function sizeReport(list: readonly Area[], limit = PAGES_LIMIT): SizeReport {
  const total = list.reduce((sum, a) => sum + a.bytes, 0)
  const ratio = total / limit
  const level = ratio >= 1 ? 'over' : ratio >= WARN_AT ? 'warn' : 'ok'
  return { total, limit, ratio, level, areas: [...list].sort((a, b) => b.bytes - a.bytes) }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let value = bytes
  let unit = ''
  for (const u of units) {
    if (value < 1000) break
    value /= 1000
    unit = u
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${unit}`
}

export function summaryLine(report: SizeReport): string {
  return `Size: ${formatBytes(report.total)}, ${(report.ratio * 100).toFixed(1)}% of the ${formatBytes(report.limit)} Pages limit`
}

/** Markdown for the job summary: the total, a warning if needed, and the largest areas. */
export function renderSizeReport(report: SizeReport, title: string, top = 10): string {
  const lines = [`### ${title}`, '', summaryLine(report), '']
  if (report.level !== 'ok') {
    lines.push(
      `**${report.level === 'over' ? 'Over the limit' : 'Warning'}:** the site is at or above ${WARN_AT * 100}% of the GitHub Pages limit. Prune the oldest merged previews; their PR index entries stay (DOC-14).`,
      '',
    )
  }
  const previews = report.areas.filter((a) => a.name.startsWith('pr/')).length
  const snapshots = report.areas.filter((a) => a.name.startsWith('snapshots/')).length
  lines.push(
    `${previews} previews, ${snapshots} snapshots.`,
    '',
    '| Area | Size |',
    '| --- | --: |',
  )
  for (const area of report.areas.slice(0, top)) {
    lines.push(`| ${area.name} | ${formatBytes(area.bytes)} |`)
  }
  return `${lines.join('\n')}\n`
}
