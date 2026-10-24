// Prints `true` if a PR touches UI or site files, so the screenshot steps should run (WP 0.7).
//
//   node tools/screenshots/changed-files.ts --pr <n>
//
// Needs GITHUB_TOKEN and GITHUB_REPOSITORY.
import { parseArgs } from 'node:util'
import { field, str } from '../site/lib/json.ts'
import { checkRepository, gitHub } from '../site/lib/github.ts'
import { touchesUi } from './lib/changes.ts'

const { values } = parseArgs({ options: { pr: { type: 'string' } } })
const pr = Number(values.pr)
if (!Number.isInteger(pr) || pr < 1) {
  console.error('usage: changed-files --pr <n>')
  process.exit(2)
}
const repository = checkRepository(process.env.GITHUB_REPOSITORY)
const client = gitHub({ token: process.env.GITHUB_TOKEN ?? '', apiUrl: process.env.GITHUB_API_URL })
const files = await client.paginate(`/repos/${repository}/pulls/${pr}/files?per_page=100`)
const paths = files.map((f) => str(field(f, 'filename'), 'filename'))
console.log(touchesUi(paths) ? 'true' : 'false')
