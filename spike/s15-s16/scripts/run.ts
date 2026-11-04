// Runs the S15-S16 checks against one config and appends JSON lines to results/observations.jsonl.
//
//   node spike/s15-s16/scripts/run.ts ref     start ref; S15 (items, order, restart) and S16
//                                             (shaper) checks; the full contract suite, the R1
//                                             tests and the deployment checks against it; then the
//                                             start-up checks (the configs, and the http probe)
//   node spike/s15-s16/scripts/run.ts tight   start tight; the S16 checks only
//
// Node reads NODE_EXTRA_CA_CERTS only at start-up, so this sets it to the spike's test CA and
// starts vitest. Stacks are left running; stop them with `sh spike/s15-s16/scripts/down.sh`.
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { observe } from '../src/record.ts'

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')
const ca = join(root, 'docker/tls-out/ca.crt')
const config = process.argv[2] ?? 'ref'
const ports: Record<string, number> = { ref: 35980, tight: 35981 }
const port = ports[config]
if (port === undefined) {
  console.error('usage: node spike/s15-s16/scripts/run.ts ref|tight')
  process.exit(2)
}
process.env.S1516_CONFIG = config
process.env.S1516_RUN ??= new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)

function sh(cmd: string, args: string[], env: Record<string, string> = {}, cwd = repo): number {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
  return r.status ?? 1
}

const vitest = (...paths: string[]) =>
  sh(
    join(repo, 'node_modules/.bin/vitest'),
    ['run', '--config', 'vitest.config.ts', ...paths],
    { NODE_EXTRA_CA_CERTS: ca, S1516_CONFIG: config },
    root,
  )

interface JsonReport {
  numTotalTests: number
  numPassedTests: number
  numFailedTests: number
  numPendingTests: number
  testResults: { assertionResults: { fullName: string; status: string }[] }[]
}

/** One of the repo's ejabberd suites against this stack, summarised into one observation. */
function suite(kind: 'contract' | 'r1' | 'deployment'): number {
  const out = join(root, 'results', `contract-${config}-${kind}.json`)
  const flags = kind === 'r1' ? ['--r1'] : kind === 'deployment' ? ['--deployment'] : []
  const status = sh(
    'node',
    ['packages/contract-suite/scripts/run-ejabberd.ts', ...flags, '--reporter=default', '--reporter=json', `--outputFile.json=${out}`],
    { WRX_XMPP_WS: `wss://localhost:${port}/ws`, WRX_XMPP_CA: ca },
  )
  let summary: Record<string, unknown> = { exitCode: status }
  try {
    const rep = JSON.parse(readFileSync(out, 'utf8')) as JsonReport
    const failed = rep.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName))
    summary = { ...summary, total: rep.numTotalTests, passed: rep.numPassedTests, failed: rep.numFailedTests, skipped: rep.numPendingTests, failedTests: failed }
    rmSync(out)
  } catch {
    summary.report = 'none'
  }
  const name = { contract: 'full contract suite', r1: 'R1 tests (S01, S01b, C01)', deployment: 'deployment checks' }[kind]
  observe('suites', name, { pass: status === 0, ...summary })
  return status
}

let failures = 0
if (sh('sh', [join(root, 'scripts/up.sh'), config]) !== 0) {
  console.error(`S15-S16 ${config}: the server did not start`)
  process.exit(1)
}
if (config === 'ref') {
  failures += vitest('tests/server/s15.test.ts') === 0 ? 0 : 1
  failures += vitest('tests/server/s15-restart.test.ts') === 0 ? 0 : 1
}
failures += vitest('tests/server/s16.test.ts') === 0 ? 0 : 1
if (config === 'ref') {
  failures += suite('contract') === 0 ? 0 : 1
  failures += suite('r1') === 0 ? 0 : 1
  failures += suite('deployment') === 0 ? 0 : 1
  failures += vitest('tests/startup') === 0 ? 0 : 1
}
console.log(`\nS15-S16 ${config}: ${failures === 0 ? 'all steps passed' : `${failures} step(s) failed`}; see results/observations.jsonl`)
process.exit(failures === 0 ? 0 : 1)
