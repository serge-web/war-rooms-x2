// Builds a frozen snapshot of the app for a blog post (DOC-24): the mock-only build of the
// phase-branch commit the post names. Run from a clone of the repo.
//
//   node tools/site/snapshot.ts --slug <post> --branch <phase branch> --commit <sha> --out <dir>
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isPhaseBranch } from './lib/blog.ts'
import { SNAPSHOT_MARKER, git } from './lib/gh-pages.ts'
import { isSlug } from './lib/paths.ts'

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    branch: { type: 'string' },
    commit: { type: 'string' },
    out: { type: 'string' },
  },
})
const { slug, branch, commit, out } = values
if (slug === undefined || branch === undefined || commit === undefined || out === undefined) {
  console.error('usage: snapshot --slug <post> --branch <phase branch> --commit <sha> --out <dir>')
  process.exit(2)
}
if (!isSlug(slug)) throw new Error(`Not a post slug: ${slug}`)
if (!isPhaseBranch(branch)) throw new Error(`Not a phase branch: ${branch} (DOC-24)`)
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('The commit must be a full 40-character id')

const repo = process.cwd()
const shallow = git(repo, ['rev-parse', '--is-shallow-repository']) === 'true'
git(repo, [
  'fetch',
  '--no-tags',
  '--filter=blob:none',
  ...(shallow ? ['--unshallow'] : []),
  'origin',
  `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
])
try {
  git(repo, ['merge-base', '--is-ancestor', commit, `refs/remotes/origin/${branch}`])
} catch {
  throw new Error(
    `${commit} is not on ${branch}; a snapshot must come from its phase branch (DOC-24)`,
  )
}

const work = join(mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'snapshot-')), 'src')
git(repo, ['worktree', 'add', '--detach', work, commit])
try {
  const run = (args: string[]) => execFileSync('pnpm', args, { cwd: work, stdio: 'inherit' })
  run(['install', '--frozen-lockfile'])
  run(['--filter', '@wrx/web', 'build'])
  const dest = resolve(out)
  cpSync(join(work, 'apps/web/dist'), dest, { recursive: true })
  writeFileSync(
    join(dest, SNAPSHOT_MARKER),
    `${JSON.stringify({ commit, branch, post: slug }, null, 2)}\n`,
  )
  console.log(`Snapshot of ${commit.slice(0, 12)} on ${branch} built in ${dest}`)
} finally {
  git(repo, ['worktree', 'remove', '--force', work])
}
