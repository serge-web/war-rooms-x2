import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { escapeCell, indexEntries, parsePulls, renderPrIndex } from './pulls.ts'

const fixture: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/pulls.json', import.meta.url), 'utf8'),
)
const repo = 'serge-web/war-rooms-x2'

describe('parsePulls', () => {
  it('reads paged API output and marks forks', () => {
    const pulls = parsePulls(fixture, repo)
    expect(pulls.map((p) => p.number)).toEqual([12, 11, 10, 9, 8, 1])
    expect(pulls.find((p) => p.number === 10)?.fromFork).toBe(true)
    expect(pulls.find((p) => p.number === 1)?.fromFork).toBe(true)
    expect(pulls.find((p) => p.number === 12)?.fromFork).toBe(false)
  })
  it('rejects a malformed item', () => {
    expect(() => parsePulls([{ number: 'x' }], repo)).toThrow()
    expect(() =>
      parsePulls(
        [
          {
            number: 1,
            title: 't',
            state: 'open',
            html_url: 'https://x/(y)',
            user: { login: 'a' },
            head: { repo: null },
          },
        ],
        repo,
      ),
    ).toThrow(/URL/)
  })
})

describe('indexEntries (DOC-9)', () => {
  const entries = indexEntries(parsePulls(fixture, repo))
  it('lists open and merged PRs, newest first, without unmerged closed ones', () => {
    expect(entries.map((e) => [e.number, e.status, e.mergedOn])).toEqual([
      [12, 'draft', null],
      [11, 'open', null],
      [10, 'open', null],
      [8, 'merged', '2026-10-20'],
      [1, 'merged', '2026-10-24'],
    ])
  })
  it('links previews only for PRs the preview workflow deploys (DOC-6)', () => {
    expect(entries.filter((e) => e.hasPreview).map((e) => e.number)).toEqual([12, 11])
  })
})

describe('renderPrIndex', () => {
  const entries = indexEntries(parsePulls(fixture, repo))
  const markdown = renderPrIndex(entries, { pagesRoot: '/war-rooms-x2/' })

  it('renders a table row per PR, with preview links at the gh-pages root', () => {
    expect(markdown).toContain(
      '| [#12](https://github.com/serge-web/war-rooms-x2/pull/12) | Phase 1: transports \\| contracts &lt;draft&gt; | draft |  | <a href="/war-rooms-x2/pr/12/" target="_self">pr/12</a> |',
    )
    expect(markdown).toContain(
      '| [#8](https://github.com/serge-web/war-rooms-x2/pull/8) | Bump zod | merged | 2026-10-20 | none |',
    )
    expect(markdown.indexOf('#12]')).toBeLessThan(markdown.indexOf('#1]'))
  })
  it('links the live demo (DOC-16)', () => {
    expect(markdown).toContain('<a href="/war-rooms-x2/demo/" target="_self">live demo</a>')
  })
  it('keeps titles inert: no links, emphasis or Vue interpolation', () => {
    expect(markdown).toContain('Blog: \\[click\\](javascript:alert(1)) \\*bold\\* {{ secret }}')
    const table = markdown.slice(markdown.indexOf('::: v-pre'), markdown.lastIndexOf(':::'))
    expect(table).toContain('{{ secret }}')
  })
  it('says when there is no data, or no PRs', () => {
    expect(renderPrIndex(null, { pagesRoot: '/' })).toContain('without PR data')
    expect(renderPrIndex([], { pagesRoot: '/' })).toContain('No open or merged PRs yet.')
  })
})

describe('escapeCell', () => {
  it('escapes Markdown and HTML', () => {
    expect(escapeCell('a|b <i>_x_</i>\n`c`')).toBe('a\\|b &lt;i&gt;\\_x\\_&lt;/i&gt; \\`c\\`')
  })
})
