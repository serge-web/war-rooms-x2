// Writes docs/data-dictionary.md from the schemas (DOC-3). With --check, fails if it is stale.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CATALOGUE } from '../src/catalogue.ts'
import { renderDictionary } from '../src/dictionary.ts'

const target = fileURLToPath(new URL('../../../docs/data-dictionary.md', import.meta.url))
const rendered = renderDictionary(CATALOGUE)

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    // Missing counts as stale.
  }
  if (current !== rendered) {
    console.error('docs/data-dictionary.md is out of date. Run `pnpm dictionary` and commit it.')
    process.exit(1)
  }
  console.log('docs/data-dictionary.md is up to date.')
} else {
  writeFileSync(target, rendered)
  console.log(`Wrote ${target}`)
}
