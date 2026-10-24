// NFR-1, DOC-12: fails if a built site, app, preview or snapshot contains a secret or names a
// real server. Every text file is read, including library chunks and the embedded app.
//
//   node tools/site/check-site-bundle.ts <folder>...
import { statSync } from 'node:fs'
import type { Allowance } from './lib/scan.ts'
import { BUNDLE_RULES, TEXT_FILE, scanDir } from './lib/scan.ts'

/** Known library text that matches a rule but is no secret or endpoint. Each needs a reason. */
const ALLOW: readonly Allowance[] = []

const dirs = process.argv.slice(2)
if (dirs.length === 0) {
  console.error('usage: check-site-bundle <folder>...')
  process.exit(2)
}

let failed = false
for (const dir of dirs) {
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`)
  const { files, hits } = scanDir(dir, {
    rules: BUNDLE_RULES,
    allow: ALLOW,
    include: (file) => TEXT_FILE.test(file),
  })
  if (hits.length > 0) {
    failed = true
    const why = new Map(BUNDLE_RULES.map((r) => [r.id, r.why]))
    console.error(`${dir}: ${hits.length} possible secrets or real-server endpoints:\n`)
    for (const hit of hits) {
      console.error(
        `${hit.file}:${hit.line}  [${hit.rule}] ${why.get(hit.rule) ?? ''}\n    …${hit.excerpt}…`,
      )
    }
  } else {
    console.log(`${dir}: no secrets or real-server endpoints in ${files} text files.`)
  }
}
if (failed) process.exitCode = 1
