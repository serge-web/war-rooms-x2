// Every live SRD requirement must belong to a work package, every id the plan names must
// exist in the SRD, and every WP must be in the README plan chart (DOC-22).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { trace } from './lib/trace.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file: string) => readFileSync(`${root}/${file}`, 'utf8')

const report = trace(read('WRX1-SRD.md'), read('WRX1-Dev-Plan.md'), read('README.md'))
const problems = [
  ...report.unassigned.map((id) => `${id} is in the SRD but no work package delivers it`),
  ...report.unknown.map((id) => `${id} is named in the plan but is not a live SRD requirement`),
  ...report.missingFromChart.map((id) => `WP ${id} is in the plan but not in the README chart`),
]
if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log('Traceability: every SRD requirement is assigned and every WP is charted.')
}
