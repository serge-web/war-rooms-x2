// Fetches the wheels the spike ships (packages.ts) into .cache/wheels/, once, at build time, and
// checks each against the sha256 in pyodide-lock.json (the npm package's copy, which is the
// release's own). Nothing is fetched at run time: the built page serves every file itself.
//
//   node scripts/fetch-packages.ts                    # from the release on the jsDelivr mirror
//   node scripts/fetch-packages.ts /path/to/pyodide   # from an extracted full release instead
//
// An air-gapped build uses the second form with the release tarball
// (pyodide-<version>.tar.bz2 from the Pyodide GitHub release), brought in like any dependency.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RELEASE_BASE, shippedPackages } from './packages.ts'
import type { Lockfile } from './packages.ts'

const here = new URL('..', import.meta.url).pathname
const lock = JSON.parse(
  readFileSync(join(here, 'node_modules/pyodide/pyodide-lock.json'), 'utf8'),
) as Lockfile
const out = join(here, '.cache/wheels')
mkdirSync(out, { recursive: true })
const local = process.argv[2]

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

for (const name of shippedPackages(lock)) {
  const entry = lock.packages[name]
  if (entry === undefined) throw new Error(name)
  const target = join(out, entry.file_name)
  if (existsSync(target) && sha256(readFileSync(target)) === entry.sha256) continue
  if (local !== undefined) {
    copyFileSync(join(local, entry.file_name), target)
  } else {
    const response = await fetch(RELEASE_BASE + entry.file_name)
    if (!response.ok) throw new Error(`${entry.file_name}: HTTP ${response.status}`)
    writeFileSync(target, new Uint8Array(await response.arrayBuffer()))
  }
  const digest = sha256(readFileSync(target))
  if (digest !== entry.sha256) throw new Error(`${entry.file_name}: sha256 ${digest} is not the lock's`)
  console.log(`fetched ${entry.file_name}`)
}
console.log(`${shippedPackages(lock).length} wheels in .cache/wheels, sha256 checked`)
