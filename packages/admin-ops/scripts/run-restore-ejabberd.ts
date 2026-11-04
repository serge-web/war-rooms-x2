// Runs one step of the backup and restore check (WP 3.3, ejabberd-restore/) against an ejabberd
// stack, as run-ejabberd.ts does for the admin-ops scenario: NODE_EXTRA_CA_CERTS is read only at
// start-up, so this sets it to the stack's CA and starts vitest. ops/test/backup-restore.sh sets
// WRX_RESTORE_STEP and WRX_RESTORE_STATE. Arguments pass through to vitest.
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
  [
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.restore.ejabberd.config.ts',
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_EXTRA_CA_CERTS: ca } },
)
process.exit(result.status ?? 1)
