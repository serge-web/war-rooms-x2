// DOC-2: flags built site pages, or given source files, that match the deny-list, for human
// review. Exits 1 on any match; a deploy or blog auto-merge stops until a person decides.
//
//   node tools/site/check-deny-list.ts <built site folder>
//   node tools/site/check-deny-list.ts --files <file>...
import { readFileSync, statSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { Hit } from './lib/scan.ts'
import { isAllowed, isSiteContent, parseDenyList, scanDir, scanText } from './lib/scan.ts'

const list = parseDenyList(
  JSON.parse(readFileSync(new URL('deny-list.json', import.meta.url), 'utf8')),
)
const { values, positionals } = parseArgs({
  options: { files: { type: 'boolean', default: false } },
  allowPositionals: true,
})
if (positionals.length === 0) {
  console.error('usage: check-deny-list <built site> | --files <file>...')
  process.exit(2)
}

let hits: Hit[]
let scanned: number
if (values.files) {
  hits = positionals.flatMap((file) =>
    scanText(file, readFileSync(file, 'utf8'), list.rules).filter((h) => !isAllowed(h, list.allow)),
  )
  scanned = positionals.length
} else {
  const dir = positionals[0] ?? ''
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`)
  const result = scanDir(dir, { rules: list.rules, allow: list.allow, include: isSiteContent })
  hits = result.hits
  scanned = result.files
}

const why = new Map(list.rules.map((r) => [r.id, r.why]))
if (hits.length > 0) {
  console.error(`Deny-list: ${hits.length} matches need human review (DOC-2):\n`)
  for (const hit of hits) {
    const where = values.files ? `${hit.file}:${hit.line}` : hit.file
    console.error(`${where}  [${hit.rule}] ${why.get(hit.rule) ?? ''}\n    …${hit.excerpt}…`)
    if (process.env.GITHUB_ACTIONS === 'true') {
      const at = values.files ? `file=${hit.file},line=${hit.line},` : ''
      console.log(`::error ${at}title=Deny-list::${hit.rule} in ${hit.file}`)
    }
  }
  console.error(
    '\nReword the page, or, if a reviewer agrees it is safe, add an allowance with a reason to tools/site/deny-list.json.',
  )
  process.exitCode = 1
} else {
  console.log(`Deny-list: no matches in ${scanned} files (${list.rules.length} terms).`)
}
