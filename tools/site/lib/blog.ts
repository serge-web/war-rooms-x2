// Blog posts and blog-only PRs (DOC-5, DOC-23 to DOC-26).
import { isSlug } from './paths.ts'

/** The blog folder. A blog-only PR may change nothing else (DOC-23). */
export const BLOG_DIR = 'site/pages/blog/'

/** Phase branches a snapshot may be built from: `phase-0` to `phase-3`, and Phase 0's stand-in. */
export const PHASE_BRANCHES: readonly RegExp[] = Object.freeze([
  /^phase-\d+$/,
  /^claude\/gracious-thompson-aowbqs$/,
])

export function isPhaseBranch(name: string): boolean {
  return PHASE_BRANCHES.some((pattern) => pattern.test(name))
}

export interface FrontMatter {
  readonly data: Readonly<Record<string, string>>
  readonly problems: readonly string[]
}

/**
 * Reads the front matter as flat `key: value` lines, the only form posts may use, so that this
 * reader and VitePress's YAML parser agree on it.
 */
export function frontMatter(text: string): FrontMatter {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { data: {}, problems: ['No front matter'] }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) return { data: {}, problems: ['Front matter is not closed with ---'] }
  const data: Record<string, string> = {}
  const problems: string[] = []
  lines.slice(1, end).forEach((line, i) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return
    const match = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) {
      problems.push(`Front matter line ${i + 2} is not \`key: value\``)
      return
    }
    const raw = match[2]
    const quoted = /^"([^"]*)"(?:\s+#.*)?$/.exec(raw) ?? /^'([^']*)'(?:\s+#.*)?$/.exec(raw)
    data[match[1]] = quoted?.[1] ?? raw.replace(/\s+#.*$/, '')
  })
  return { data, problems }
}

export type PostStatus = 'work-in-progress' | 'gate'

export interface Post {
  readonly slug: string
  readonly title: string
  readonly date: string
  readonly phase: number
  readonly status: PostStatus
  readonly snapshot?: { readonly branch: string; readonly commit: string }
  readonly body: string
}

export interface ParsedPost {
  readonly post?: Post
  readonly problems: readonly string[]
}

/** `site/pages/blog/<slug>.md` → `<slug>`; undefined for the index and other files. */
export function postSlug(file: string): string | undefined {
  if (!file.startsWith(BLOG_DIR)) return undefined
  const match = /^([^/]+)\.md$/.exec(file.slice(BLOG_DIR.length))
  return match?.[1] === undefined || match[1] === 'index' ? undefined : match[1]
}

export function parsePost(file: string, text: string): ParsedPost {
  const slug = postSlug(file)
  if (slug === undefined) return { problems: [`${file} is not a post`] }
  const { data, problems: fm } = frontMatter(text)
  const problems = fm.map((p) => `${file}: ${p}`)
  const need = (key: string) => {
    const value = data[key]
    if (value === undefined || value === '') problems.push(`${file}: front matter needs \`${key}\``)
    return value ?? ''
  }
  if (!isSlug(slug)) problems.push(`${file}: the file name must be a lower-case slug`)
  const title = need('title')
  const date = need('date')
  if (date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`${file}: date is YYYY-MM-DD`)
  const phaseText = need('phase')
  const phase = Number(phaseText)
  if (phaseText !== '' && !/^[0-3]$/.test(phaseText)) problems.push(`${file}: phase is 0 to 3`)
  const status = need('status')
  if (status !== '' && status !== 'work-in-progress' && status !== 'gate') {
    problems.push(`${file}: status is work-in-progress or gate (DOC-26)`)
  }
  const branch = data.snapshotBranch
  const commit = data.snapshotCommit
  if ((branch === undefined) !== (commit === undefined)) {
    problems.push(`${file}: snapshotBranch and snapshotCommit go together (DOC-24)`)
  }
  if (branch !== undefined && !isPhaseBranch(branch)) {
    problems.push(`${file}: snapshotBranch must be a phase branch, not ${branch} (DOC-24)`)
  }
  if (commit !== undefined && !/^[0-9a-f]{40}$/.test(commit)) {
    problems.push(`${file}: snapshotCommit must be a full 40-character commit id (DOC-24)`)
  }
  if (problems.length > 0) return { problems }
  const body = text
    .split('\n')
    .slice(text.split('\n').indexOf('---', 1) + 1)
    .join('\n')
  return {
    post: {
      slug,
      title,
      date,
      phase,
      status: status === 'gate' ? 'gate' : 'work-in-progress',
      ...(branch !== undefined && commit !== undefined ? { snapshot: { branch, commit } } : {}),
      body,
    },
    problems,
  }
}

/** Does the post link to another post? Accepts `./slug`, `slug`, `/blog/slug`, with or without `.md` or `.html`. */
export function linksTo(body: string, slug: string): boolean {
  const target = new RegExp(`\\]\\((?:\\./|/blog/)?${slug}(?:\\.md|\\.html)?(?:#[^)]*)?\\)`)
  return target.test(body)
}

/**
 * Checks across posts: each gate post links every work-in-progress post of its phase (DOC-26),
 * and two posts never claim the same snapshot.
 */
export function checkPosts(posts: readonly Post[]): string[] {
  const problems: string[] = []
  for (const gate of posts.filter((p) => p.status === 'gate')) {
    for (const wip of posts.filter(
      (p) => p.status === 'work-in-progress' && p.phase === gate.phase,
    )) {
      if (!linksTo(gate.body, wip.slug)) {
        problems.push(
          `Gate post ${gate.slug} must link the phase ${gate.phase} post ${wip.slug} (DOC-26)`,
        )
      }
    }
  }
  return problems
}

export interface PrFacts {
  readonly files: readonly string[]
  readonly labels: readonly string[]
  readonly headRef: string
}

export interface Classification {
  /** Labelled `blog` or on a `blog/` branch: the author wants it auto-merged (DOC-23). */
  readonly blogPr: boolean
  /** Changed files outside the blog folder. */
  readonly outside: readonly string[]
  /** Post files the PR adds or changes. */
  readonly posts: readonly string[]
}

export function classifyPr(facts: PrFacts): Classification {
  return {
    blogPr: facts.labels.includes('blog') || facts.headRef.startsWith('blog/'),
    outside: facts.files.filter((f) => !f.startsWith(BLOG_DIR)),
    posts: facts.files.filter((f) => postSlug(f) !== undefined),
  }
}

export interface SnapshotRequest {
  readonly slug: string
  readonly branch: string
  readonly commit: string
  /** The post is not on the base branch yet, so its snapshot may still change (DOC-24). */
  readonly replace: boolean
}

export interface BlogPrInput {
  readonly classification: Classification
  /** Each changed post, parsed from the PR's head. */
  readonly posts: readonly ParsedPost[]
  /** Deny-list matches in the changed blog files, as `file:line term`. */
  readonly flagged: readonly string[]
  /** Slugs of changed posts already published on the base branch. */
  readonly published: ReadonlySet<string>
}

export interface BlogPrDecision {
  /** May auto-merge once CI is green (DOC-23). */
  readonly eligible: boolean
  readonly reasons: readonly string[]
  readonly snapshots: readonly SnapshotRequest[]
}

/**
 * Deploy ops for the snapshots, each from an artifact named `snapshot-<slug>`. A published
 * post's snapshot is frozen; an unpublished one may still be replaced (DOC-24).
 */
export function snapshotOps(snapshots: readonly SnapshotRequest[]): string {
  return snapshots
    .map((s) => `snapshot${s.replace ? '-replace' : ''}:${s.slug}=snapshot-${s.slug}`)
    .join(' ')
}

/** Decides whether a blog PR may auto-merge, and which snapshots it needs (DOC-23 to DOC-26). */
export function reviewBlogPr(input: BlogPrInput): BlogPrDecision {
  const reasons: string[] = []
  const { outside } = input.classification
  if (outside.length > 0) {
    const shown = outside.slice(0, 10).join(', ')
    reasons.push(
      `Changes files outside ${BLOG_DIR}: ${shown}${outside.length > 10 ? ', …' : ''} (DOC-23)`,
    )
  }
  for (const parsed of input.posts) reasons.push(...parsed.problems)
  for (const hit of input.flagged) {
    reasons.push(`Deny-list match, needs human review: ${hit} (DOC-25)`)
  }
  const snapshots = input.posts.flatMap(({ post }) =>
    post?.snapshot === undefined
      ? []
      : [{ slug: post.slug, ...post.snapshot, replace: !input.published.has(post.slug) }],
  )
  return { eligible: reasons.length === 0, reasons, snapshots }
}
