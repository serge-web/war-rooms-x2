// Writes docs/json-schema/*.schema.json from the zod schemas (D26, ARC-6, P8). With --check,
// fails if any file is missing, stale or not exported any more.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA_DIR, renderJsonSchemas } from '../src/json-schema.ts'

const dir = fileURLToPath(new URL(`../../../${JSON_SCHEMA_DIR}/`, import.meta.url))
const rendered = renderJsonSchemas()
const existing = (() => {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.schema.json'))
  } catch {
    return []
  }
})()

if (process.argv.includes('--check')) {
  const stale = [...rendered].filter(([file, text]) => {
    try {
      return readFileSync(join(dir, file), 'utf8') !== text
    } catch {
      return true
    }
  })
  const extra = existing.filter((file) => !rendered.has(file))
  if (stale.length > 0 || extra.length > 0) {
    console.error(
      `${JSON_SCHEMA_DIR} is out of date (${[...stale.map(([f]) => f), ...extra].join(', ')}). Run \`pnpm json-schema\` and commit it.`,
    )
    process.exit(1)
  }
  console.log(`${JSON_SCHEMA_DIR} is up to date.`)
} else {
  mkdirSync(dir, { recursive: true })
  for (const file of existing) if (!rendered.has(file)) rmSync(join(dir, file))
  for (const [file, text] of rendered) writeFileSync(join(dir, file), text)
  console.log(`Wrote ${rendered.size} files to ${dir}`)
}
