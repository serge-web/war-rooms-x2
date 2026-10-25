// Runs the admin-ops integration against the reference ejabberd. Node reads NODE_EXTRA_CA_CERTS
// only at start-up, so this sets it to the stack's test CA and starts vitest. Arguments pass
// through to vitest.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ca = process.env.WRX_XMPP_CA ?? resolve(root, '../../deploy/ejabberd/tls-out/ca.crt')
if (!existsSync(ca)) {
  console.error(`No CA file at ${ca}. Start the stack first: pnpm stack:up`)
  process.exit(1)
}
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'vitest.ejabberd.config.ts', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_EXTRA_CA_CERTS: ca } },
)
process.exit(result.status ?? 1)
