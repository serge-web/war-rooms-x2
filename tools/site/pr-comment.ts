// Creates or updates the one preview comment on a PR (DOC-7, DOC-8).
//
//   node tools/site/pr-comment.ts preview --pr <n> --sha <sha> [--size <summary line>]
//   node tools/site/pr-comment.ts closed --pr <n> --merged true|false
//   node tools/site/pr-comment.ts failed --pr <n> --run-url <url>
//
// Needs GITHUB_TOKEN and GITHUB_REPOSITORY; SITE_PAGES_ROOT and SITE_PAGES_URL override the
// gh-pages location.
import { parseArgs } from 'node:util'
import { PREVIEW_MARKER, closedComment, failedComment, previewComment } from './lib/comment.ts'
import { checkRepository, gitHub, upsertComment } from './lib/github.ts'
import { pagesLocation, targetUrl } from './lib/paths.ts'

const { values, positionals } = parseArgs({
  options: {
    pr: { type: 'string' },
    sha: { type: 'string' },
    merged: { type: 'string' },
    'run-url': { type: 'string' },
    size: { type: 'string' },
  },
  allowPositionals: true,
})
const kind = positionals[0]
const pr = Number(values.pr)
if (!Number.isInteger(pr) || pr < 1 || !['preview', 'closed', 'failed'].includes(kind ?? '')) {
  console.error('usage: pr-comment preview|closed|failed --pr <n> ...')
  process.exit(2)
}

const repository = checkRepository(process.env.GITHUB_REPOSITORY)
const location = pagesLocation({
  repository,
  root: process.env.SITE_PAGES_ROOT,
  url: process.env.SITE_PAGES_URL,
})
const siteUrl = targetUrl(location, { kind: 'pr', number: pr })

let body: string
if (kind === 'preview') {
  body = previewComment({
    siteUrl,
    appUrl: `${siteUrl}app/`,
    sha: values.sha ?? '',
    size: values.size === undefined || values.size === '' ? undefined : values.size,
  })
} else if (kind === 'closed') {
  body = closedComment(values.merged === 'true', siteUrl)
} else {
  body = failedComment(values['run-url'] ?? '', siteUrl)
}

const client = gitHub({ token: process.env.GITHUB_TOKEN ?? '', apiUrl: process.env.GITHUB_API_URL })
const outcome = await upsertComment(client, repository, pr, body, PREVIEW_MARKER)
console.log(`Preview comment ${outcome} on #${pr}`)
