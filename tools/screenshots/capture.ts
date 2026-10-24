// Takes the @screenshot scenarios' images of a built site and writes their manifest (DOC-19,
// DOC-20). With --repeat it captures twice and fails unless both runs are identical.
//
//   node tools/screenshots/capture.ts --out <dir> [--dist site/dist] [--target root|pr/<n>] [--repeat]
//
// The site is served at the base path it was built for, from the same settings build-site.ts
// uses (GITHUB_REPOSITORY, SITE_PAGES_ROOT, SITE_PAGES_URL).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { pagesLocation, parseTarget, targetBase } from '../site/lib/paths.ts'
import { MANIFEST, hashDir } from './lib/manifest.ts'
import type { Manifest } from './lib/manifest.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    dist: { type: 'string', default: 'site/dist' },
    target: { type: 'string', default: process.env.WRX_SITE_TARGET ?? 'root' },
    repeat: { type: 'boolean', default: false },
  },
})
if (values.out === undefined) {
  console.error('usage: capture --out <dir> [--dist site/dist] [--target root|pr/<n>] [--repeat]')
  process.exit(2)
}

const location = pagesLocation({
  repository: process.env.GITHUB_REPOSITORY,
  root: process.env.SITE_PAGES_ROOT,
  url: process.env.SITE_PAGES_URL,
})
const base = targetBase(location, parseTarget(values.target))
const dist = resolve(values.dist)

function run(out: string): Manifest {
  rmSync(out, { recursive: true, force: true })
  execFileSync(
    'pnpm',
    ['exec', 'playwright', 'test', '-c', 'tools/screenshots/playwright.config.ts'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, WRX_SHOTS_OUT: out, WRX_SHOTS_DIST: dist, WRX_SHOTS_BASE: base },
    },
  )
  return hashDir(out)
}

const out = resolve(values.out)
const manifest = run(out)
writeFileSync(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Captured ${Object.keys(manifest.shots).length} screenshots in ${out}`)

if (values.repeat) {
  const again = run(mkdtempSync(join(tmpdir(), 'wrx-shots-')))
  const differ = Object.keys(manifest.shots).filter((n) => manifest.shots[n] !== again.shots[n])
  if (differ.length > 0 || Object.keys(again.shots).length !== Object.keys(manifest.shots).length) {
    console.error(
      `Screenshots are not repeatable (DOC-20): ${differ.join(', ') || 'different sets'}`,
    )
    process.exit(1)
  }
  console.log('Second run identical: screenshots are repeatable (DOC-20).')
}
