// Deploys to the gh-pages branch (DOC-6, DOC-8, DOC-13, DOC-16, DOC-24). Each deploy is one
// commit of whole-folder replacements; on a push conflict it fetches, rebases that commit and
// retries, and if the rebase conflicts it re-applies the folders onto the new tip instead.
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { field, str } from './json.ts'
import type { Target } from './paths.ts'
import { RESERVED, isSlug, parseTarget, targetDir } from './paths.ts'

export type Op =
  | { readonly kind: 'root'; readonly from: string }
  | { readonly kind: 'put'; readonly target: Target; readonly from: string }
  | { readonly kind: 'remove'; readonly target: Target }
  | {
      readonly kind: 'snapshot'
      readonly slug: string
      readonly from: string
      readonly replace: boolean
    }

/** Written into each snapshot, so a later deploy can tell whether it is frozen (DOC-24). */
export const SNAPSHOT_MARKER = '.snapshot.json'

/** Written into each site build: the commit it was built from, and that commit's date. */
export const BUILD_INFO = 'build.json'

export interface BuildInfo {
  readonly commit: string
  readonly committedAt: string
}

export function readBuildInfo(dir: string): BuildInfo | undefined {
  const path = join(dir, BUILD_INFO)
  if (!existsSync(path)) return undefined
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return {
    commit: str(field(json, 'commit'), 'commit'),
    committedAt: str(field(json, 'committedAt'), 'committedAt'),
  }
}

/**
 * Deploys wait in one queue whose order is not guaranteed, so a root build of an older `main`
 * may arrive after a newer one. It is skipped rather than published over it.
 */
export function isOlderBuild(incoming: BuildInfo | undefined, current: BuildInfo | undefined) {
  if (incoming === undefined || current === undefined) return false
  return Date.parse(incoming.committedAt) < Date.parse(current.committedAt)
}

/**
 * Parses one op: `root=<dir>`, `put:<target>=<dir>`, `remove:<target>`,
 * `snapshot:<slug>=<dir>` or `snapshot-replace:<slug>=<dir>`.
 */
export function parseOp(spec: string, dir: (name: string) => string = (d) => d): Op {
  const root = /^root=(.+)$/.exec(spec)
  if (root?.[1] !== undefined) return { kind: 'root', from: dir(root[1]) }
  const put = /^put:([^=]+)=(.+)$/.exec(spec)
  if (put?.[1] !== undefined && put[2] !== undefined) {
    const target = parseTarget(put[1])
    if (target.kind === 'root' || target.kind === 'snapshot') {
      throw new Error(`Use root= or snapshot: for ${put[1]}`)
    }
    return { kind: 'put', target, from: dir(put[2]) }
  }
  const remove = /^remove:(.+)$/.exec(spec)
  if (remove?.[1] !== undefined) {
    const target = parseTarget(remove[1])
    if (target.kind !== 'pr') throw new Error('Only previews (pr/<n>) can be removed')
    return { kind: 'remove', target }
  }
  const snapshot = /^snapshot(-replace)?:([^=]+)=(.+)$/.exec(spec)
  if (snapshot?.[2] !== undefined && snapshot[3] !== undefined && isSlug(snapshot[2])) {
    return {
      kind: 'snapshot',
      slug: snapshot[2],
      from: dir(snapshot[3]),
      replace: snapshot[1] !== undefined,
    }
  }
  throw new Error(`Not a deploy op: ${spec}`)
}

export interface SnapshotMarker {
  readonly commit: string
  readonly branch: string
  readonly post: string
}

export function readSnapshotMarker(dir: string): SnapshotMarker | undefined {
  const path = join(dir, SNAPSHOT_MARKER)
  if (!existsSync(path)) return undefined
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return {
    commit: str(field(json, 'commit'), 'commit'),
    branch: str(field(json, 'branch'), 'branch'),
    post: str(field(json, 'post'), 'post'),
  }
}

/**
 * A snapshot is frozen once deployed (DOC-24): the same commit is a no-op, and a different
 * one is refused unless the caller knows the post is not yet published.
 */
export function snapshotDecision(
  existing: string | undefined,
  wanted: string,
  replace: boolean,
): 'deploy' | 'skip' | 'refuse' {
  if (existing === undefined) return 'deploy'
  if (existing === wanted) return 'skip'
  return replace ? 'deploy' : 'refuse'
}

function replaceDir(from: string, to: string) {
  if (!existsSync(join(from, 'index.html'))) throw new Error(`${from} has no index.html`)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
}

/** Applies ops to a gh-pages working tree. Returns one log line per op. */
export function applyOps(tree: string, ops: readonly Op[]): string[] {
  const log: string[] = []
  // Vite and VitePress emit `_`-prefixed chunks, which Jekyll would drop.
  writeFileSync(join(tree, '.nojekyll'), '')
  for (const op of ops) {
    switch (op.kind) {
      case 'root': {
        const clash = readdirSync(op.from).filter((n) => RESERVED.includes(n) || n === '.git')
        if (clash.length > 0) throw new Error(`The site build may not contain ${clash.join(', ')}`)
        if (!existsSync(join(op.from, 'index.html'))) {
          throw new Error(`${op.from} has no index.html`)
        }
        const current = readBuildInfo(tree)
        if (isOlderBuild(readBuildInfo(op.from), current)) {
          log.push(`root: kept the newer site, built from ${current?.commit ?? ''}`)
          break
        }
        for (const name of readdirSync(tree)) {
          if (name !== '.git' && name !== '.nojekyll' && !RESERVED.includes(name)) {
            rmSync(join(tree, name), { recursive: true, force: true })
          }
        }
        cpSync(op.from, tree, { recursive: true })
        log.push('root: replaced the site, kept pr/, demo/ and snapshots/')
        break
      }
      case 'put':
        replaceDir(op.from, join(tree, targetDir(op.target)))
        log.push(`${targetDir(op.target)}: replaced`)
        break
      case 'remove': {
        const path = join(tree, targetDir(op.target))
        const existed = existsSync(path)
        rmSync(path, { recursive: true, force: true })
        log.push(`${targetDir(op.target)}: ${existed ? 'removed' : 'already absent'}`)
        break
      }
      case 'snapshot': {
        const wanted = readSnapshotMarker(op.from)
        if (wanted === undefined) throw new Error(`${op.from} has no ${SNAPSHOT_MARKER}`)
        const path = join(tree, 'snapshots', op.slug)
        const existing = readSnapshotMarker(path)?.commit
        const decision = snapshotDecision(existing, wanted.commit, op.replace)
        if (decision === 'refuse') {
          throw new Error(
            `snapshots/${op.slug} is frozen at ${existing ?? ''}; refusing to replace it with ${wanted.commit} (DOC-24)`,
          )
        }
        if (decision === 'deploy') replaceDir(op.from, path)
        log.push(`snapshots/${op.slug}: ${decision === 'skip' ? 'unchanged' : 'deployed'}`)
        break
      }
    }
  }
  return log
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'github-actions[bot]',
  GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'github-actions[bot]',
  GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
}

export function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(input === undefined ? {} : { input }),
    maxBuffer: 64 * 1024 * 1024,
  }).trim()
}

/** Creates the branch as an orphan holding only `.nojekyll`, if the remote lacks it. */
export function ensureBranch(
  repoDir: string,
  remote: string,
  branch: string,
): 'exists' | 'created' {
  if (git(repoDir, ['ls-remote', '--heads', remote, branch]) !== '') return 'exists'
  const blob = git(repoDir, ['hash-object', '-w', '--stdin'], '')
  const tree = git(repoDir, ['mktree'], `100644 blob ${blob}\t.nojekyll\n`)
  const commit = git(repoDir, ['commit-tree', tree, '-m', `Create ${branch}`])
  try {
    git(repoDir, ['push', remote, `${commit}:refs/heads/${branch}`])
    return 'created'
  } catch (error) {
    // Another deploy may have created it first.
    if (git(repoDir, ['ls-remote', '--heads', remote, branch]) !== '') return 'exists'
    throw error
  }
}

export interface DeployOptions {
  /** A clone of the repo, with push access to `remote`. */
  readonly repoDir: string
  /** Where to check out gh-pages; must not exist yet. */
  readonly workDir: string
  readonly message: string
  readonly remote?: string
  readonly branch?: string
  readonly attempts?: number
  readonly delayMs?: (attempt: number) => number
  /** Test hook, run before each push. */
  readonly beforePush?: (attempt: number) => void
  /** Runs on the published tree before it is removed, e.g. to measure it (DOC-14). */
  readonly inspect?: (tree: string) => void
}

export interface DeployResult {
  readonly outcome: 'pushed' | 'unchanged'
  readonly attempts: number
  readonly log: readonly string[]
}

export async function deploy(ops: readonly Op[], options: DeployOptions): Promise<DeployResult> {
  const remote = options.remote ?? 'origin'
  const branch = options.branch ?? 'gh-pages'
  const attempts = options.attempts ?? 5
  const delay = options.delayMs ?? ((n) => 2000 * 2 ** (n - 1) + Math.random() * 1000)
  const tracking = `refs/remotes/${remote}/${branch}`
  const work = options.workDir
  const log: string[] = []
  const fetchTip = () =>
    git(options.repoDir, [
      'fetch',
      '--depth=1',
      '--no-tags',
      remote,
      `+refs/heads/${branch}:${tracking}`,
    ])
  const commit = (): boolean => {
    git(work, ['add', '-A'])
    if (git(work, ['status', '--porcelain']) === '') return false
    git(work, ['commit', '--quiet', '-m', options.message])
    return true
  }

  log.push(`${branch}: ${ensureBranch(options.repoDir, remote, branch)}`)
  fetchTip()
  git(options.repoDir, ['worktree', 'add', '--detach', work, tracking])
  try {
    log.push(...applyOps(work, ops))
    if (!commit()) {
      options.inspect?.(work)
      return { outcome: 'unchanged', attempts: 0, log }
    }
    for (let attempt = 1; ; attempt++) {
      options.beforePush?.(attempt)
      try {
        git(work, ['push', '--quiet', remote, `HEAD:refs/heads/${branch}`])
        log.push(`pushed on attempt ${attempt}`)
        options.inspect?.(work)
        return { outcome: 'pushed', attempts: attempt, log }
      } catch (error) {
        if (attempt >= attempts) throw error
        log.push(`push rejected on attempt ${attempt}; fetching and rebasing`)
      }
      await new Promise((resolve) => setTimeout(resolve, delay(attempt)))
      fetchTip()
      try {
        git(work, ['rebase', '--quiet', '--onto', tracking, 'HEAD~1'])
      } catch {
        try {
          git(work, ['rebase', '--abort'])
        } catch {
          // Nothing to abort.
        }
        log.push('rebase conflicted; re-applying onto the new tip')
        git(work, ['reset', '--quiet', '--hard', tracking])
        git(work, ['clean', '-fdq'])
        applyOps(work, ops)
        if (!commit()) {
          options.inspect?.(work)
          return { outcome: 'unchanged', attempts: attempt, log }
        }
      }
    }
  } finally {
    git(options.repoDir, ['worktree', 'remove', '--force', work])
  }
}
