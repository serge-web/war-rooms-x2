// Every live SRD requirement must belong to a work package, every id the plan names must
// exist in the SRD, and every WP must be in the README plan chart (DOC-22). Each user scenario
// of SRD §12 must have its Playwright spec, which lists the ids the scenario traces to (NFR-17).
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { scenarioProblems, srdScenarios, trace } from './lib/trace.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file: string) => readFileSync(`${root}/${file}`, 'utf8')

const report = trace(read('WRX1-SRD.md'), read('WRX1-Dev-Plan.md'), read('README.md'))
const problems = [
  ...report.unassigned.map((id) => `${id} is in the SRD but no work package delivers it`),
  ...report.unknown.map((id) => `${id} is named in the plan but is not a live SRD requirement`),
  ...report.missingFromChart.map((id) => `WP ${id} is in the plan but not in the README chart`),
]
const scenarioDir = `${root}/apps/web/e2e/scenarios`
const specs = new Map(
  readdirSync(scenarioDir).map((file) => [file, readFileSync(`${scenarioDir}/${file}`, 'utf8')]),
)
const scenarios = srdScenarios(read('WRX1-SRD.md'))
if (scenarios.length === 0) problems.push('no user scenarios found in SRD §12')
problems.push(...scenarioProblems(scenarios, specs))
if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    `Traceability: every SRD requirement is assigned, every WP is charted, and each of the ${scenarios.length} user scenarios has its spec.`,
  )
}
