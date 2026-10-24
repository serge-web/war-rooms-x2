import { describe, expect, it } from 'vitest'
import {
  checkPosts,
  classifyPr,
  frontMatter,
  isPhaseBranch,
  linksTo,
  parsePost,
  postSlug,
  reviewBlogPr,
  snapshotOps,
} from './blog.ts'
import type { Post } from './blog.ts'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const file = 'site/pages/blog/layout-library.md'

function post(fields: string, body = '\n# Post\n'): string {
  return `---\n${fields}\n---\n${body}`
}
const valid =
  'title: "Choosing a layout library: FlexLayout"\ndate: 2026-11-02\nphase: 0\nstatus: work-in-progress'

describe('frontMatter', () => {
  it('reads flat key: value lines, quoted or not, with comments', () => {
    expect(frontMatter(post('a: 1\nb: "x: y"\n# note\nc: \'z\' # trailing')).data).toEqual({
      a: '1',
      b: 'x: y',
      c: 'z',
    })
  })
  it('reports nesting and missing front matter', () => {
    expect(frontMatter(post('snapshot:\n  commit: abc')).problems).toEqual([
      'Front matter line 3 is not `key: value`',
    ])
    expect(frontMatter('# no front matter').problems).toEqual(['No front matter'])
  })
})

describe('parsePost', () => {
  it('reads a valid work-in-progress post', () => {
    const parsed = parsePost(file, post(valid))
    expect(parsed.problems).toEqual([])
    expect(parsed.post).toMatchObject({
      slug: 'layout-library',
      title: 'Choosing a layout library: FlexLayout',
      phase: 0,
      status: 'work-in-progress',
    })
  })
  it('requires the DOC-26 status and the other fields', () => {
    const { problems } = parsePost(file, post('title: T\ndate: 2 Nov\nphase: 7\nstatus: draft'))
    expect(problems).toEqual([
      `${file}: date is YYYY-MM-DD`,
      `${file}: phase is 0 to 3`,
      `${file}: status is work-in-progress or gate (DOC-26)`,
    ])
  })
  it('reads a snapshot from a phase branch, as a full commit id (DOC-24)', () => {
    const parsed = parsePost(
      file,
      post(`${valid}\nsnapshotBranch: phase-1\nsnapshotCommit: ${SHA}`),
    )
    expect(parsed.post?.snapshot).toEqual({ branch: 'phase-1', commit: SHA })
  })
  it('rejects a snapshot from another branch, a short id, or half a snapshot', () => {
    expect(
      parsePost(file, post(`${valid}\nsnapshotBranch: main\nsnapshotCommit: ${SHA}`)).problems,
    ).toEqual([`${file}: snapshotBranch must be a phase branch, not main (DOC-24)`])
    expect(
      parsePost(file, post(`${valid}\nsnapshotBranch: phase-1\nsnapshotCommit: 0123abc`)).problems,
    ).toEqual([`${file}: snapshotCommit must be a full 40-character commit id (DOC-24)`])
    expect(parsePost(file, post(`${valid}\nsnapshotBranch: phase-1`)).problems).toEqual([
      `${file}: snapshotBranch and snapshotCommit go together (DOC-24)`,
    ])
  })
})

describe('postSlug and isPhaseBranch', () => {
  it('knows posts from other blog files', () => {
    expect(postSlug('site/pages/blog/a-post.md')).toBe('a-post')
    expect(postSlug('site/pages/blog/index.md')).toBeUndefined()
    expect(postSlug('site/pages/blog/img/a.png')).toBeUndefined()
    expect(postSlug('site/pages/background.md')).toBeUndefined()
  })
  it('accepts phase branches and the Phase 0 stand-in', () => {
    expect(isPhaseBranch('phase-2')).toBe(true)
    expect(isPhaseBranch('claude/gracious-thompson-aowbqs')).toBe(true)
    expect(isPhaseBranch('main')).toBe(false)
    expect(isPhaseBranch('phase-2-wip')).toBe(false)
  })
})

describe('checkPosts (DOC-26)', () => {
  const make = (slug: string, status: Post['status'], phase: number, body = ''): Post => ({
    slug,
    title: slug,
    date: '2026-11-01',
    phase,
    status,
    body,
  })
  it('requires a gate post to link every work-in-progress post of its phase', () => {
    const posts = [
      make('one', 'work-in-progress', 1),
      make('two', 'work-in-progress', 1),
      make('other-phase', 'work-in-progress', 2),
      make('gate-1', 'gate', 1, 'See [one](./one) and [x](/blog/three.html).'),
    ]
    expect(checkPosts(posts)).toEqual(['Gate post gate-1 must link the phase 1 post two (DOC-26)'])
  })
  it('accepts the link forms authors use', () => {
    expect(linksTo('[a](./one.md#top)', 'one')).toBe(true)
    expect(linksTo('[a](one)', 'one')).toBe(true)
    expect(linksTo('[a](/blog/one.html)', 'one')).toBe(true)
    expect(linksTo('[a](./one-more)', 'one')).toBe(false)
  })
})

describe('classifyPr and reviewBlogPr (DOC-23 to DOC-25)', () => {
  const blogFacts = { labels: ['blog'], headRef: 'blog/layout' }
  const parsed = parsePost(file, post(`${valid}\nsnapshotBranch: phase-0\nsnapshotCommit: ${SHA}`))

  it('treats only labelled PRs or blog/ branches as blog PRs', () => {
    expect(classifyPr({ files: [file], labels: [], headRef: 'wp-0.6' }).blogPr).toBe(false)
    expect(classifyPr({ files: [file], labels: ['blog'], headRef: 'x' }).blogPr).toBe(true)
    expect(classifyPr({ files: [file], labels: [], headRef: 'blog/x' }).blogPr).toBe(true)
  })
  it('allows a blog-only PR and lists its snapshots', () => {
    const decision = reviewBlogPr({
      classification: classifyPr({
        files: [file, 'site/pages/blog/layout/shot.png'],
        ...blogFacts,
      }),
      posts: [parsed],
      flagged: [],
      published: new Set(),
    })
    expect(decision).toEqual({
      eligible: true,
      reasons: [],
      snapshots: [{ slug: 'layout-library', branch: 'phase-0', commit: SHA, replace: true }],
    })
  })
  it('refuses a PR that changes anything outside the blog folder (DOC-23)', () => {
    const decision = reviewBlogPr({
      classification: classifyPr({ files: [file, 'apps/web/src/App.tsx'], ...blogFacts }),
      posts: [parsed],
      flagged: [],
      published: new Set(),
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reasons).toEqual([
      'Changes files outside site/pages/blog/: apps/web/src/App.tsx (DOC-23)',
    ])
  })
  it('refuses a post the deny-list flags (DOC-25)', () => {
    const decision = reviewBlogPr({
      classification: classifyPr({ files: [file], ...blogFacts }),
      posts: [parsed],
      flagged: [`${file}:12 admin-rule-ids`],
      published: new Set(),
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reasons[0]).toMatch(/Deny-list match.*DOC-25/)
  })
  it('turns snapshots into deploy ops', () => {
    expect(
      snapshotOps([
        { slug: 'a', branch: 'phase-0', commit: SHA, replace: true },
        { slug: 'b', branch: 'phase-0', commit: SHA, replace: false },
      ]),
    ).toBe('snapshot-replace:a=snapshot-a snapshot:b=snapshot-b')
    expect(snapshotOps([])).toBe('')
  })
  it('freezes the snapshot of a post already published (DOC-24)', () => {
    const decision = reviewBlogPr({
      classification: classifyPr({ files: [file], ...blogFacts }),
      posts: [parsed],
      flagged: [],
      published: new Set(['layout-library']),
    })
    expect(decision.snapshots[0]?.replace).toBe(false)
  })
})
