// Runs every S14 check against one config and appends JSON lines to results/observations.jsonl.
//
//   node spike/s14/scripts/run.ts v0     start V0; the S14 checks; the full contract suite and the
//                                        R1 tests against it; then the start-up checks (V1, V2 and
//                                        the probes on fresh volumes, and V0's database under V1)
//   node spike/s14/scripts/run.ts v1     start V1; if it starts, the S14 checks and both suites;
//   node spike/s14/scripts/run.ts v2     if it does not, record that and what was not run
//   node spike/s14/scripts/run.ts v1p    a probe (the dag plugin without the dag node tree): start
//   node spike/s14/scripts/run.ts v2p    it, then the full contract suite and the R1 tests only
//
// Node reads NODE_EXTRA_CA_CERTS only at start-up, so this sets it to the spike's test CA and
// starts vitest. Stacks are left running; stop them with `sh spike/s14/scripts/down.sh`.
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { observe } from '../src/record.ts'

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')
const ca = join(root, 'docker/tls-out/ca.crt')
const config = process.argv[2] ?? 'v0'
const ports: Record<string, number> = { v0: 35970, v1: 35971, v2: 35972, v1p: 35973, v2p: 35974 }
const port = ports[config]
if (port === undefined) {
  console.error('usage: node spike/s14/scripts/run.ts v0|v1|v2|v1p|v2p')
  process.exit(2)
}
const probe = config === 'v1p' || config === 'v2p'
process.env.S14_CONFIG = config
process.env.S14_RUN ??= new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)

function sh(cmd: string, args: string[], env: Record<string, string> = {}, cwd = repo): number {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
  return r.status ?? 1
}

const vitest = (dir: string) =>
  sh(join(repo, 'node_modules/.bin/vitest'), ['run', '--config', 'vitest.config.ts', dir], { NODE_EXTRA_CA_CERTS: ca, S14_CONFIG: config }, root)

interface JsonReport {
  numTotalTests: number
  numPassedTests: number
  numFailedTests: number
  numPendingTests: number
  testResults: { assertionResults: { fullName: string; status: string }[] }[]
}

/** The contract suite (or its R1 tests) against this stack, summarised into one observation. */
function contract(r1: boolean): number {
  const out = join(root, 'results', `contract-${config}${r1 ? '-r1' : ''}.json`)
  const status = sh(
    'node',
    ['packages/contract-suite/scripts/run-ejabberd.ts', ...(r1 ? ['--r1'] : []), '--reporter=default', '--reporter=json', `--outputFile.json=${out}`],
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
  observe('S14-9', r1 ? 'R1 tests (S01, S01b, C01)' : 'full contract suite', { pass: status === 0, ...summary })
  return status
}

let failures = 0
const up = sh('sh', [join(root, 'scripts/up.sh'), config])
if (up !== 0) {
  observe('S14-9', `${config} does not start`, {
    pass: false,
    notRun: ['S14-1', 'S14-2', 'S14-3', 'S14-4', 'S14-5', 'S14-6', 'S14-7', 'S14-8', 'S14-10', 'contract suite', 'R1 tests'],
    why: 'ejabberd 26.09 aborts start-up with this config (see the start-up observations from `run.ts v0`)',
  })
  console.log(`\nS14 ${config}: the server does not start; recorded. Nothing else can run against it.`)
  process.exit(0)
}
if (!probe) failures += vitest('tests/server') === 0 ? 0 : 1
failures += contract(false) === 0 ? 0 : 1
failures += contract(true) === 0 ? 0 : 1
if (config === 'v0') failures += vitest('tests/startup') === 0 ? 0 : 1
console.log(`\nS14 ${config}: ${failures === 0 ? 'all steps passed' : `${failures} step(s) failed`}; see results/observations.jsonl`)
process.exit(failures === 0 ? 0 : 1)
