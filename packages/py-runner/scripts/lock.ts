// Writes pyodide.lock.json from the installed `pyodide` npm package: the core files' sha256 and
// the release's lock trimmed to PACKAGE_SETS (src/packaging.ts). Run after an upgrade:
//
//   pnpm --filter @wrx/py-runner lock
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCK_FILE, coreFolder, makeFilesLock } from '../src/packaging.ts'

const { version } = JSON.parse(readFileSync(join(coreFolder(), 'package.json'), 'utf8')) as {
  version: string
}
const lock = makeFilesLock(version)
writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`)
console.log(`${LOCK_FILE}: pyodide ${version}, ${Object.keys(lock.lock.packages).length} packages`)
