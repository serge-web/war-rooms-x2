// Prints `true` if a PR touches the Python runner, the SDK or Python files, so its preview
// includes `py/` (owner decision, Nov 6, 2026; WP 6.4). Without --pr (the main site) it prints
// `true`: the main site always includes it.
//
//   node tools/site/python-changed.ts [--pr <n>]
//
// Needs GITHUB_TOKEN and GITHUB_REPOSITORY with --pr.
import { parseArgs } from 'node:util'
import { field, str } from './lib/json.ts'
import { checkRepository, gitHub } from './lib/github.ts'
import { touchesPython } from './lib/python-changes.ts'

const { values } = parseArgs({ options: { pr: { type: 'string' } } })
if (values.pr === undefined || values.pr === '') {
  console.log('true')
} else {
  const pr = Number(values.pr)
  if (!Number.isInteger(pr) || pr < 1) {
    console.error('usage: python-changed [--pr <n>]')
    process.exit(2)
  }
  const repository = checkRepository(process.env.GITHUB_REPOSITORY)
  const client = gitHub({
    token: process.env.GITHUB_TOKEN ?? '',
    apiUrl: process.env.GITHUB_API_URL,
  })
  const files = await client.paginate(`/repos/${repository}/pulls/${pr}/files?per_page=100`)
  const paths = files.map((f) => str(field(f, 'filename'), 'filename'))
  console.log(touchesPython(paths) ? 'true' : 'false')
}
