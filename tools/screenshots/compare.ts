// Compares a PR's screenshots with main's and writes the comment section (DOC-19, DOC-21).
// Main's images of changed shots are copied to <head>/before/, and unchanged images are
// deleted, so a preview carries only what differs (DOC-14).
//
//   node tools/screenshots/compare.ts --target pr/<n> --head <dir> [--base <dir>] --section <file>
//   node tools/screenshots/compare.ts --skipped --section <file>
//
// --base is main's published screenshots/ folder; missing or empty means main has none yet.
// GITHUB_REPOSITORY, SITE_PAGES_ROOT and SITE_PAGES_URL locate the preview, as for the build.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pagesLocation, parseTarget, targetUrl } from '../site/lib/paths.ts'
import {
  BEFORE_DIR,
  commentSection,
  compare,
  readManifest,
  skippedSection,
} from './lib/manifest.ts'

const usage = 'usage: compare --target pr/<n> --head <dir> [--base <dir>] --section <file>'
const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    head: { type: 'string' },
    base: { type: 'string' },
    section: { type: 'string' },
    skipped: { type: 'boolean', default: false },
  },
})
if (values.section === undefined) {
  console.error(usage)
  process.exit(2)
}
if (values.skipped) {
  writeFileSync(values.section, `${skippedSection()}\n`)
  process.exit(0)
}
if (values.head === undefined || values.target === undefined) {
  console.error(usage)
  process.exit(2)
}

const location = pagesLocation({
  repository: process.env.GITHUB_REPOSITORY,
  root: process.env.SITE_PAGES_ROOT,
  url: process.env.SITE_PAGES_URL,
})
const shotsUrl = `${targetUrl(location, parseTarget(values.target))}screenshots/`

const head = readManifest(values.head)
if (head === undefined) throw new Error(`No screenshot manifest in ${values.head}`)
const baseDir = values.base
const base = baseDir === undefined || !existsSync(baseDir) ? undefined : readManifest(baseDir)

const changes = compare(base, head)
for (const change of changes) {
  const file = `${change.name}.png`
  if (change.status === 'changed' && baseDir !== undefined) {
    mkdirSync(join(values.head, BEFORE_DIR), { recursive: true })
    copyFileSync(join(baseDir, file), join(values.head, BEFORE_DIR, file))
  } else if (change.status === 'unchanged') {
    rmSync(join(values.head, file))
  }
}
writeFileSync(join(values.head, 'comparison.json'), `${JSON.stringify(changes, null, 2)}\n`)
writeFileSync(
  values.section,
  `${commentSection(changes, { shotsUrl, hasBase: base !== undefined })}\n`,
)
const differ = changes.filter((c) => c.status !== 'unchanged').length
console.log(`${differ} of ${changes.length} screenshots differ from main`)
