// Runs the contract suite against the reference ejabberd. Node reads NODE_EXTRA_CA_CERTS only at
// start-up, so this sets it to the stack's test CA (NFR-2: internal CAs) and starts vitest.
// `--r1` runs only the R1 tests (S01, S01b, C01), the gate for an ejabberd upgrade (NFR-22).
// Other arguments pass through to vitest.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ca = process.env.WRX_XMPP_CA ?? resolve(root, '../../deploy/ejabberd/tls-out/ca.crt')
if (!existsSync(ca)) {
  console.error(`No CA file at ${ca}. Start the stack first: pnpm stack:up`)
  process.exit(1)
}
const args = process.argv.slice(2)
const r1 = args.includes('--r1')
const rest = args.filter((a) => a !== '--r1')
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.ejabberd.config.ts',
    ...(r1 ? ['--tags-filter', 'r1'] : []),
    ...rest,
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_EXTRA_CA_CERTS: ca } },
)
process.exit(result.status ?? 1)
