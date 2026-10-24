// Applies deploy ops to gh-pages in one commit, creating the branch if it is missing, and
// retrying on a push conflict (DOC-13). Run from a clone with push access.
//
//   node tools/site/deploy.ts --message <text> [--from <dir>] [--summary <file>]
//                             [--size-line <file>] <op>...
//
// Ops: root=<dir>  put:pr/<n>=<dir>  put:demo=<dir>  remove:pr/<n>
//      snapshot:<slug>=<dir>  snapshot-replace:<slug>=<dir>
// It then reports the size of the whole published tree (DOC-14).
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { deploy, parseOp } from './lib/gh-pages.ts'
import { areas, renderSizeReport, sizeReport, summaryLine } from './lib/size.ts'

const { values, positionals } = parseArgs({
  options: {
    message: { type: 'string' },
    summary: { type: 'string' },
    'size-line': { type: 'string' },
    /** Folder that op dirs are relative to, such as downloaded artifacts. */
    from: { type: 'string', default: '.' },
  },
  allowPositionals: true,
})
if (values.message === undefined || positionals.length === 0) {
  console.error('usage: deploy --message <text> <op>...')
  process.exit(2)
}

const ops = positionals.map((spec) => parseOp(spec, (dir) => resolve(values.from, dir)))
const parent = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'gh-pages-'))

const result = await deploy(ops, {
  repoDir: process.cwd(),
  workDir: join(parent, 'tree'),
  message: values.message,
  inspect: (tree) => {
    const report = sizeReport(areas(tree))
    const markdown = renderSizeReport(report, 'gh-pages size')
    console.log(markdown)
    if (values.summary !== undefined) writeFileSync(values.summary, markdown)
    if (values['size-line'] !== undefined) writeFileSync(values['size-line'], summaryLine(report))
    if (report.level !== 'ok')
      console.log(`::warning title=Site size (DOC-14)::${summaryLine(report)}`)
  },
})
console.log(result.log.join('\n'))
console.log(`Deploy ${result.outcome} after ${result.attempts} push attempts.`)
