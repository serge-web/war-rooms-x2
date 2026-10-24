// Deploys against real git repos in a temp folder: a bare "origin" and a clone that deploys.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Op } from './gh-pages.ts'
import { SNAPSHOT_MARKER, applyOps, deploy, git, parseOp, snapshotDecision } from './gh-pages.ts'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'gh-pages-test-'))
  const origin = join(root, 'origin.git')
  git(root, ['init', '--quiet', '--bare', '-b', 'main', origin])
  const repo = join(root, 'repo')
  git(root, ['clone', '--quiet', origin, repo])
  writeFileSync(join(repo, 'README.md'), 'main\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '--quiet', '-m', 'main'])
  git(repo, ['push', '--quiet', 'origin', 'HEAD:main'])
  let n = 0
  return {
    root,
    origin,
    repo,
    /** A build folder holding the given files. */
    build(files: Record<string, string>): string {
      const dir = join(root, `build-${++n}`)
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true })
        writeFileSync(join(dir, path), text)
      }
      return dir
    },
    run(ops: Op[], extra: { beforePush?: (attempt: number) => void } = {}) {
      return deploy(ops, {
        repoDir: repo,
        workDir: join(root, `work-${++n}`),
        message: 'deploy',
        delayMs: () => 0,
        ...extra,
      })
    },
    files(): string[] {
      return git(origin, ['ls-tree', '-r', '--name-only', 'gh-pages']).split('\n')
    },
    show(path: string): string {
      return git(origin, ['show', `gh-pages:${path}`])
    },
    /** Pushes a change to gh-pages from another clone, as a parallel deploy would. */
    pushElsewhere(path: string, text: string) {
      const other = join(root, `other-${++n}`)
      git(root, ['clone', '--quiet', '--branch', 'gh-pages', origin, other])
      mkdirSync(dirname(join(other, path)), { recursive: true })
      writeFileSync(join(other, path), text)
      git(other, ['add', '-A'])
      git(other, ['commit', '--quiet', '-m', `elsewhere ${path}`])
      git(other, ['push', '--quiet', 'origin', 'HEAD:gh-pages'])
    },
  }
}

const pr = (number: number, from: string): Op => ({
  kind: 'put',
  target: { kind: 'pr', number },
  from,
})

describe('deploy', () => {
  it('creates gh-pages as an orphan branch, then deploys a preview (DOC-6)', async () => {
    const t = setup()
    const result = await t.run([pr(1, t.build({ 'index.html': 'one', 'app/index.html': 'app' }))])
    expect(result.outcome).toBe('pushed')
    expect(result.log[0]).toBe('gh-pages: created')
    expect(t.files()).toEqual(['.nojekyll', 'pr/1/app/index.html', 'pr/1/index.html'])
    expect(git(t.origin, ['log', '--format=%s', 'gh-pages'])).toBe('deploy\nCreate gh-pages')
    expect(git(t.origin, ['log', '--format=%s', 'main'])).toBe('main')
  })

  it('replaces the root site but keeps previews, the demo and snapshots (DOC-16)', async () => {
    const t = setup()
    await t.run([
      pr(1, t.build({ 'index.html': 'one' })),
      { kind: 'put', target: { kind: 'demo' }, from: t.build({ 'index.html': 'demo' }) },
      { kind: 'root', from: t.build({ 'index.html': 'old', 'old.html': 'x' }) },
    ])
    await t.run([{ kind: 'root', from: t.build({ 'index.html': 'new', 'assets/a.js': 'a' }) }])
    expect(t.files()).toEqual([
      '.nojekyll',
      'assets/a.js',
      'demo/index.html',
      'index.html',
      'pr/1/index.html',
    ])
    expect(t.show('index.html')).toBe('new')
  })

  it('does not replace the root site with a build of an older commit', async () => {
    const t = setup()
    const info = (commit: string, committedAt: string) => JSON.stringify({ commit, committedAt })
    await t.run([
      {
        kind: 'root',
        from: t.build({ 'index.html': 'newer', 'build.json': info('b', '2026-10-24T12:00:00Z') }),
      },
    ])
    const result = await t.run([
      {
        kind: 'root',
        from: t.build({ 'index.html': 'older', 'build.json': info('a', '2026-10-24T11:00:00Z') }),
      },
    ])
    expect(result.outcome).toBe('unchanged')
    expect(result.log).toContain('root: kept the newer site, built from b')
    expect(t.show('index.html')).toBe('newer')
  })

  it('removes an unmerged preview and reports no change when there is nothing to do (DOC-8)', async () => {
    const t = setup()
    await t.run([pr(1, t.build({ 'index.html': 'one' })), pr(2, t.build({ 'index.html': 'two' }))])
    await t.run([{ kind: 'remove', target: { kind: 'pr', number: 1 } }])
    expect(t.files()).toEqual(['.nojekyll', 'pr/2/index.html'])
    const again = await t.run([{ kind: 'remove', target: { kind: 'pr', number: 1 } }])
    expect(again.outcome).toBe('unchanged')
  })

  it('rebases and retries when another deploy pushed first (DOC-13)', async () => {
    const t = setup()
    await t.run([pr(1, t.build({ 'index.html': 'one' }))])
    const result = await t.run([pr(3, t.build({ 'index.html': 'three' }))], {
      beforePush: (attempt) => {
        if (attempt === 1) t.pushElsewhere('pr/2/index.html', 'two')
      },
    })
    expect(result.attempts).toBe(2)
    expect(t.files()).toEqual([
      '.nojekyll',
      'pr/1/index.html',
      'pr/2/index.html',
      'pr/3/index.html',
    ])
  })

  it('re-applies its folders when the rebase conflicts', async () => {
    const t = setup()
    await t.run([pr(1, t.build({ 'index.html': 'one' }))])
    const result = await t.run([pr(1, t.build({ 'index.html': 'ours' }))], {
      beforePush: (attempt) => {
        if (attempt === 1) t.pushElsewhere('pr/1/index.html', 'theirs')
      },
    })
    expect(result.log).toContain('rebase conflicted; re-applying onto the new tip')
    expect(t.show('pr/1/index.html')).toBe('ours')
  })

  it('gives up after the last attempt', async () => {
    const t = setup()
    await t.run([pr(1, t.build({ 'index.html': 'one' }))])
    let n = 0
    const failing = deploy([pr(2, t.build({ 'index.html': 'two' }))], {
      repoDir: t.repo,
      workDir: join(t.root, 'work-fail'),
      message: 'deploy',
      attempts: 2,
      delayMs: () => 0,
      beforePush: () => {
        t.pushElsewhere(`pr/9/f${++n}.html`, 'x')
      },
    })
    await expect(failing).rejects.toThrow()
  })
})

describe('snapshots (DOC-24)', () => {
  const marker = (commit: string) => JSON.stringify({ commit, branch: 'phase-0', post: 'post' })

  it('are frozen: the same commit is a no-op, another is refused unless replaceable', async () => {
    const t = setup()
    const first = t.build({ 'index.html': 'a', [SNAPSHOT_MARKER]: marker('a'.repeat(40)) })
    await t.run([{ kind: 'snapshot', slug: 'post', from: first, replace: false }])
    expect(t.files()).toContain('snapshots/post/index.html')
    expect(
      (await t.run([{ kind: 'snapshot', slug: 'post', from: first, replace: false }])).outcome,
    ).toBe('unchanged')
    const second = t.build({ 'index.html': 'b', [SNAPSHOT_MARKER]: marker('b'.repeat(40)) })
    await expect(
      t.run([{ kind: 'snapshot', slug: 'post', from: second, replace: false }]),
    ).rejects.toThrow(/frozen/)
    await t.run([{ kind: 'snapshot', slug: 'post', from: second, replace: true }])
    expect(t.show('snapshots/post/index.html')).toBe('b')
  })

  it('decides by commit', () => {
    expect(snapshotDecision(undefined, 'a', false)).toBe('deploy')
    expect(snapshotDecision('a', 'a', false)).toBe('skip')
    expect(snapshotDecision('a', 'b', false)).toBe('refuse')
    expect(snapshotDecision('a', 'b', true)).toBe('deploy')
  })
})

describe('applyOps', () => {
  it('refuses a root build that would overwrite reserved folders', () => {
    const tree = mkdtempSync(join(tmpdir(), 'tree-'))
    const from = mkdtempSync(join(tmpdir(), 'from-'))
    writeFileSync(join(from, 'index.html'), '')
    mkdirSync(join(from, 'pr'))
    expect(() => applyOps(tree, [{ kind: 'root', from }])).toThrow(/may not contain pr/)
  })
  it('always writes .nojekyll', () => {
    const tree = mkdtempSync(join(tmpdir(), 'tree-'))
    applyOps(tree, [])
    expect(readFileSync(join(tree, '.nojekyll'), 'utf8')).toBe('')
  })
})

describe('parseOp', () => {
  it('reads each op', () => {
    expect(parseOp('root=site')).toEqual({ kind: 'root', from: 'site' })
    expect(parseOp('put:pr/4=site')).toEqual(pr(4, 'site'))
    expect(parseOp('put:demo=app')).toEqual({ kind: 'put', target: { kind: 'demo' }, from: 'app' })
    expect(parseOp('remove:pr/4')).toEqual({ kind: 'remove', target: { kind: 'pr', number: 4 } })
    expect(parseOp('snapshot-replace:my-post=snap')).toEqual({
      kind: 'snapshot',
      slug: 'my-post',
      from: 'snap',
      replace: true,
    })
  })
  it('rejects unsafe or unknown ops', () => {
    for (const bad of ['put:root=x', 'remove:demo', 'put:pr/../x=y', 'snapshot:../x=y', 'deploy']) {
      expect(() => parseOp(bad), bad).toThrow()
    }
  })
})
