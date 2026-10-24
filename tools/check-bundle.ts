// NFR-7, DOC-11: the static build loads nothing from outside its own folder. Fails on an
// absolute or root-relative URL in an HTML src/href or a CSS url(). (The Playwright smoke
// test checks the same at runtime.)
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const dist = process.argv[2]
if (dist === undefined) {
  console.error('usage: check-bundle <dist folder>')
  process.exit(2)
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

const ref = /(?:\b(?:src|href)\s*=\s*["']([^"']+)["'])|(?:url\(\s*["']?([^"')]+)["']?\s*\))/g
const problems: string[] = []
for (const file of files(dist).filter((f) => /\.(html|css)$/.test(f))) {
  for (const match of readFileSync(file, 'utf8').matchAll(ref)) {
    const url = match[1] ?? match[2] ?? ''
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(url) && !url.startsWith('data:')) {
      problems.push(`${relative(dist, file)}: ${url}`)
    }
  }
}
if (problems.length > 0) {
  console.error(`Build references URLs outside itself:\n${problems.join('\n')}`)
  process.exitCode = 1
} else {
  console.log('Bundle: all asset references are relative.')
}
