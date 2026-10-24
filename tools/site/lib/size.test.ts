import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { areas, formatBytes, renderSizeReport, sizeReport } from './size.ts'

function tree(files: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), 'size-'))
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), 'x'.repeat(bytes))
  }
  return dir
}

describe('areas', () => {
  it('splits gh-pages into the site, the demo, previews and snapshots, ignoring .git', () => {
    const dir = tree({
      'index.html': 100,
      'assets/a.js': 50,
      'demo/index.html': 30,
      'pr/1/index.html': 20,
      'pr/2/index.html': 10,
      'snapshots/post/index.html': 5,
      '.git/objects/x': 1000,
    })
    expect(areas(dir).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'demo', bytes: 30 },
      { name: 'pr/1', bytes: 20 },
      { name: 'pr/2', bytes: 10 },
      { name: 'site', bytes: 150 },
      { name: 'snapshots/post', bytes: 5 },
    ])
  })
})

describe('sizeReport (DOC-14)', () => {
  it('is ok below 70%, warns from 70%, and is over at 100%', () => {
    expect(sizeReport([{ name: 'site', bytes: 699 }], 1000).level).toBe('ok')
    expect(sizeReport([{ name: 'site', bytes: 700 }], 1000).level).toBe('warn')
    expect(sizeReport([{ name: 'site', bytes: 1000 }], 1000).level).toBe('over')
  })
  it('renders the total, the warning and the largest areas', () => {
    const report = sizeReport(
      [
        { name: 'site', bytes: 100_000_000 },
        { name: 'pr/1', bytes: 650_000_000 },
      ],
      1_000_000_000,
    )
    const markdown = renderSizeReport(report, 'gh-pages size')
    expect(markdown).toContain('Size: 750.0 MB, 75.0% of the 1.00 GB Pages limit')
    expect(markdown).toContain('**Warning:**')
    expect(markdown).toContain('1 previews, 0 snapshots.')
    expect(markdown.indexOf('| pr/1 |')).toBeLessThan(markdown.indexOf('| site |'))
  })
  it('has no warning when small', () => {
    expect(renderSizeReport(sizeReport([{ name: 'site', bytes: 10 }]), 'x')).not.toContain(
      'Warning',
    )
  })
})

describe('formatBytes', () => {
  it('uses decimal units', () => {
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(6_700_000)).toBe('6.70 MB')
    expect(formatBytes(1_000_000_000)).toBe('1.00 GB')
  })
})
