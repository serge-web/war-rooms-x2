// Reviews a blog PR for auto-merge (DOC-23 to DOC-26). Run in the PR's checkout, on a
// pull_request event. Writes to GITHUB_OUTPUT:
//   blog      true if the PR is a blog PR (labelled `blog`, or on a `blog/` branch)
//   eligible  true if it may auto-merge once CI is green
//   snapshots JSON list of { slug, branch, commit, replace } to build (DOC-24)
//   ops       deploy ops for them, each from an artifact named snapshot-<slug>
// The API lists at most 3,000 changed files; a blog PR is far smaller.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { BLOG_DIR, classifyPr, parsePost, postSlug, reviewBlogPr, snapshotOps } from './lib/blog.ts'
import { GitHubError, checkRepository, gitHub } from './lib/github.ts'
import { arr, field, num, str } from './lib/json.ts'
import { isAllowed, parseDenyList, scanText } from './lib/scan.ts'

const event: unknown = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'))
const pull = field(event, 'pull_request')
const number = num(field(pull, 'number'), 'pull_request.number')
const headRef = str(field(field(pull, 'head'), 'ref'), 'head.ref')
const baseRef = str(field(field(pull, 'base'), 'ref'), 'base.ref')
const labels = arr(field(pull, 'labels'), 'labels').map((l) => str(field(l, 'name'), 'label'))

const repository = checkRepository(process.env.GITHUB_REPOSITORY)
const client = gitHub({ token: process.env.GITHUB_TOKEN ?? '', apiUrl: process.env.GITHUB_API_URL })
const listed = await client.paginate(`/repos/${repository}/pulls/${number}/files?per_page=100`)
const changed = listed.map((f) => ({
  file: str(field(f, 'filename'), 'filename'),
  status: str(field(f, 'status'), 'status'),
  previous: field(f, 'previous_filename'),
}))
// A rename also changes its old path, which may be outside the blog folder.
const files = changed.flatMap((c) =>
  typeof c.previous === 'string' ? [c.file, c.previous] : [c.file],
)
const classification = classifyPr({ files, labels, headRef })

const output = (key: string, value: string) => {
  if (process.env.GITHUB_OUTPUT !== undefined)
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  console.log(`${key}=${value}`)
}

if (!classification.blogPr) {
  output('blog', 'false')
  output('eligible', 'false')
  output('snapshots', '[]')
  output('ops', '')
  console.log('Not a blog PR: no label `blog` and not on a blog/ branch.')
} else {
  const deny = parseDenyList(
    JSON.parse(readFileSync(new URL('deny-list.json', import.meta.url), 'utf8')),
  )
  const present = changed.filter((c) => c.status !== 'removed' && existsSync(c.file))
  const posts = present
    .filter((c) => postSlug(c.file) !== undefined)
    .map((c) => parsePost(c.file, readFileSync(c.file, 'utf8')))
  const flagged = present
    .filter((c) => c.file.startsWith(BLOG_DIR) && /\.(?:md|ts|json|txt|svg|html)$/.test(c.file))
    .flatMap((c) => scanText(c.file, readFileSync(c.file, 'utf8'), deny.rules))
    .filter((hit) => !isAllowed(hit, deny.allow))
    .map((hit) => `${hit.file}:${hit.line} ${hit.rule}`)

  const published = new Set<string>()
  for (const parsed of posts) {
    const slug = parsed.post?.slug
    if (slug === undefined || parsed.post?.snapshot === undefined) continue
    const path = `${BLOG_DIR}${slug}.md`
    try {
      await client.request(
        'GET',
        `/repos/${repository}/contents/${path}?ref=${encodeURIComponent(baseRef)}`,
      )
      published.add(slug)
    } catch (error) {
      if (!(error instanceof GitHubError && error.status === 404)) throw error
    }
  }

  const decision = reviewBlogPr({ classification, posts, flagged, published })
  output('blog', 'true')
  output('eligible', String(decision.eligible))
  output('snapshots', JSON.stringify(decision.snapshots))
  output('ops', snapshotOps(decision.snapshots))
  const summary = decision.eligible
    ? `Blog PR #${number} may auto-merge once CI is green (DOC-23).`
    : `Blog PR #${number} will not auto-merge:\n\n${decision.reasons.map((r) => `- ${r}`).join('\n')}`
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  }
}
