import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commentSection, compare, hashDir, parseManifest, skippedSection } from './manifest.ts'
import type { Manifest } from './manifest.ts'

const h = (c: string) => c.repeat(64)
const manifest = (shots: Record<string, string>): Manifest => ({ version: 1, shots })

describe('hashDir', () => {
  it('hashes PNGs by name and ignores other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shots-'))
    writeFileSync(join(dir, 'page-home.png'), 'a')
    writeFileSync(join(dir, 'manifest.json'), '{}')
    expect(hashDir(dir)).toEqual({
      version: 1,
      shots: { 'page-home': 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb' },
    })
  })
  it('refuses names that are not slugs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shots-'))
    writeFileSync(join(dir, 'Home Page.png'), 'a')
    expect(() => hashDir(dir)).toThrow('Bad screenshot name')
  })
})

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    expect(parseManifest({ version: 1, shots: { a: h('0') } })).toEqual(manifest({ a: h('0') }))
  })
  it.each([
    null,
    { version: 2, shots: {} },
    { version: 1, shots: { a: 'x' } },
    { version: 1, shots: { 'A/b': h('0') } },
  ])('rejects %j', (value) => {
    expect(parseManifest(value)).toBeUndefined()
  })
})

describe('compare (DOC-21)', () => {
  it('classifies every shot against main', () => {
    const base = manifest({ kept: h('1'), edited: h('2'), dropped: h('3') })
    const head = manifest({ kept: h('1'), edited: h('4'), added: h('5') })
    expect(compare(base, head)).toEqual([
      { name: 'added', status: 'new' },
      { name: 'dropped', status: 'removed' },
      { name: 'edited', status: 'changed' },
      { name: 'kept', status: 'unchanged' },
    ])
  })
  it('treats everything as new when main has no shots', () => {
    expect(compare(undefined, manifest({ a: h('1') }))).toEqual([{ name: 'a', status: 'new' }])
  })
})

describe('commentSection (DOC-19)', () => {
  const url = 'https://example.github.io/repo/pr/9/screenshots/'
  it('shows changed shots side by side and new shots alone', () => {
    const section = commentSection(
      [
        { name: 'edited', status: 'changed' },
        { name: 'added', status: 'new' },
        { name: 'kept', status: 'unchanged' },
        { name: 'gone', status: 'removed' },
      ],
      { shotsUrl: url, hasBase: true },
    )
    expect(section).toContain('1 changed, 1 new, 1 removed, 1 unchanged.')
    expect(section).toContain(
      `<img src="${url}before/edited.png" alt="edited on main" width="400">`,
    )
    expect(section).toContain(`<img src="${url}edited.png" alt="edited in this PR" width="400">`)
    expect(section).toContain(`<img src="${url}added.png" alt="added" width="400">`)
    expect(section).not.toContain('kept.png')
    expect(section).toContain('Removed: `gone`.')
  })
  it('says when main has nothing to compare with', () => {
    expect(commentSection([], { shotsUrl: url, hasBase: false })).toContain(
      'main has no screenshots yet',
    )
  })
  it('has a section for PRs that skip screenshots', () => {
    expect(skippedSection()).toContain('no screenshots were taken')
  })
})
