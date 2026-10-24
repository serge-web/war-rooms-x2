// DOC-14: reports a site folder's size (a build, or a gh-pages checkout) and warns at 70% of
// the GitHub Pages limit. Writes the report to the job summary when run in Actions, and
// exits 1 only when over the limit.
//
//   node tools/site/size-report.ts <folder> [--title <heading>] [--line-out <file>]
import { appendFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { areas, renderSizeReport, sizeReport, summaryLine } from './lib/size.ts'

const { values, positionals } = parseArgs({
  options: {
    title: { type: 'string', default: 'Site size' },
    'line-out': { type: 'string' },
  },
  allowPositionals: true,
})
const dir = positionals[0]
if (dir === undefined) {
  console.error('usage: size-report <folder> [--title <heading>] [--line-out <file>]')
  process.exit(2)
}

const report = sizeReport(areas(dir))
const markdown = renderSizeReport(report, values.title)
console.log(markdown)
if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
}
if (values['line-out'] !== undefined) writeFileSync(values['line-out'], summaryLine(report))
if (report.level !== 'ok' && process.env.GITHUB_ACTIONS === 'true') {
  console.log(`::warning title=Site size (DOC-14)::${summaryLine(report)}`)
}
if (report.level === 'over') process.exitCode = 1
