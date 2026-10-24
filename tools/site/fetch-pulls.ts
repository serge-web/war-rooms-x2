// Saves the repo's pull requests from the GitHub API, for the PR index (DOC-9).
//
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/name node tools/site/fetch-pulls.ts <out.json>
import { writeFileSync } from 'node:fs'
import { checkRepository, gitHub } from './lib/github.ts'
import { field } from './lib/json.ts'
import { parsePulls } from './lib/pulls.ts'

const out = process.argv[2]
if (out === undefined) {
  console.error('usage: fetch-pulls <out.json>')
  process.exit(2)
}
const repository = checkRepository(process.env.GITHUB_REPOSITORY)
const client = gitHub({ token: process.env.GITHUB_TOKEN ?? '', apiUrl: process.env.GITHUB_API_URL })
const raw = await client.paginate(`/repos/${repository}/pulls?state=all&per_page=100`)

// Keep only what the index reads, in the API's own shape.
const trimmed = raw.map((pull) => ({
  number: field(pull, 'number'),
  title: field(pull, 'title'),
  state: field(pull, 'state'),
  draft: field(pull, 'draft'),
  merged_at: field(pull, 'merged_at'),
  html_url: field(pull, 'html_url'),
  user: { login: field(field(pull, 'user'), 'login') },
  head: { repo: { full_name: field(field(field(pull, 'head'), 'repo'), 'full_name') ?? null } },
}))
parsePulls(trimmed, repository)
writeFileSync(out, `${JSON.stringify(trimmed, null, 1)}\n`)
console.log(`Saved ${trimmed.length} pull requests to ${out}`)
