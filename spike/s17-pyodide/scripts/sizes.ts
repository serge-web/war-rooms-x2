// Sizes of what the spike ships (PR4, PY-5): each file in dist/pyodide raw, gzip (level 9) and
// brotli (quality 11), the core and each package set with its dependencies, and the spike's own
// scripts. With the path of an extracted full release, also the size of the whole distribution.
//
//   node scripts/sizes.ts [/path/to/extracted/pyodide]    writes results/sizes.json
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { CORE_FILES, PACKAGE_SETS, closure } from './packages.ts'
import type { Lockfile } from './packages.ts'

const here = join(import.meta.dirname, '..')
const dist = join(here, 'dist')

interface Size {
  raw: number
  gzip: number
  brotli: number
}

function size(file: string): Size {
  const bytes = readFileSync(file)
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
    }).length,
  }
}

const sum = (sizes: Size[]): Size =>
  sizes.reduce((a, b) => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip, brotli: a.brotli + b.brotli }), {
    raw: 0,
    gzip: 0,
    brotli: 0,
  })

const files: Record<string, Size> = {}
for (const name of readdirSync(join(dist, 'pyodide')).sort()) files[name] = size(join(dist, 'pyodide', name))
const assets: Record<string, Size> = {}
for (const name of readdirSync(join(dist, 'assets')).sort()) assets[name] = size(join(dist, 'assets', name))

const shippedLock = JSON.parse(readFileSync(join(dist, 'pyodide/pyodide-lock.json'), 'utf8')) as Lockfile
const fullLock = JSON.parse(
  readFileSync(join(here, 'node_modules/pyodide/pyodide-lock.json'), 'utf8'),
) as Lockfile
const core = sum(CORE_FILES.map((f) => files[f]).filter((s): s is Size => s !== undefined))
const sets = Object.fromEntries(
  Object.entries(PACKAGE_SETS).map(([set, roots]) => {
    const names = closure(shippedLock, roots)
    const wheels = names.map((n) => shippedLock.packages[n]?.file_name ?? '')
    const total = sum(wheels.map((w) => files[w]).filter((s): s is Size => s !== undefined))
    return [set, { packages: names, wheels: total, withCore: sum([core, total]) }]
  }),
)

let fullDistribution: unknown
const full = process.argv[2]
if (full !== undefined) {
  const names = readdirSync(full)
  const raw = names.reduce((n, f) => n + statSync(join(full, f)).size, 0)
  fullDistribution = {
    files: names.length,
    packages: Object.keys(fullLock.packages).length,
    rawBytes: raw,
    note: 'pyodide-<version>.tar.bz2 from the GitHub release, extracted',
  }
}

const out = {
  version: (fullLock.info as { version?: string }).version,
  python: (fullLock.info as { python?: string }).python,
  files,
  core,
  sets,
  lockFile: { full: Buffer.byteLength(JSON.stringify(fullLock)), shipped: files['pyodide-lock.json']?.raw },
  spikeScripts: assets,
  fullDistribution,
}
mkdirSync(join(here, 'results'), { recursive: true })
writeFileSync(join(here, 'results/sizes.json'), `${JSON.stringify(out, null, 2)}\n`)
const mb = (n: number) => (n / 1e6).toFixed(2)
for (const [name, s] of Object.entries(files)) console.log(`${name.padEnd(64)} ${mb(s.raw)} / ${mb(s.gzip)} / ${mb(s.brotli)} MB`)
console.log(`core ${mb(core.raw)} / ${mb(core.gzip)} / ${mb(core.brotli)} MB`)
for (const [set, s] of Object.entries(sets)) {
  console.log(`${set}: wheels ${mb(s.wheels.raw)} / ${mb(s.wheels.gzip)} / ${mb(s.wheels.brotli)}; with core ${mb(s.withCore.raw)} / ${mb(s.withCore.gzip)} / ${mb(s.withCore.brotli)} MB`)
}
