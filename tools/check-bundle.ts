// NFR-7, DOC-11: the static build loads nothing from outside its own folder. Fails on an
// absolute or root-relative URL in an HTML src/href or a CSS url(). (The Playwright smoke
// test checks the same at runtime.)
//
// PY-5 (WP 6.2): the Python runner and Pyodide are in `py/` and load only when asked for. Fails
// if a chunk the page loads at start-up (index.html's scripts and everything they import
// statically) holds the runner or Pyodide, or if `py/` lacks the runner or the interpreter.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

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

/** The JS files index.html loads at start-up, and every file they import statically. */
function startupChunks(): string[] {
  const root = dist ?? ''
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  const queue = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+\.js)"/g)].map(
    (m) => join(root, m[1] ?? ''),
  )
  const seen = new Set<string>()
  while (queue.length > 0) {
    const file = queue.shift() ?? ''
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    const code = readFileSync(file, 'utf8')
    // Static imports only: `import ... from"./x.js"` and `import"./x.js"`, not `import("./x.js")`.
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      queue.push(join(dirname(file), m[1] ?? ''))
    }
  }
  return [...seen]
}

/** Text only the runner, its worker or Pyodide hold. */
const RUNNER_MARKERS = ['_wrx_bridge', 'loadPyodide', 'pyodide.asm', 'wasm-unsafe-eval']
const startup = startupChunks()
const leaks = startup.flatMap((file) => {
  const code = readFileSync(file, 'utf8')
  return RUNNER_MARKERS.filter((m) => code.includes(m)).map((m) => `${relative(dist, file)}: ${m}`)
})
const missing = [
  'py/runner.js',
  'py/pyodide/pyodide.asm.wasm',
  'py/pyodide/pyodide-lock.json',
].filter((file) => !existsSync(join(dist, file)))
const startupBytes = startup.reduce((sum, file) => sum + statSync(file).size, 0)
if (startup.length === 0) {
  console.error('Bundle: index.html loads no script')
  process.exitCode = 1
} else if (leaks.length > 0 || missing.length > 0) {
  console.error(
    [
      ...leaks.map((l) => `The runner is in a start-up chunk (PY-5): ${l}`),
      ...missing.map((f) => `The build has no ${f} (WP 6.2 packaging)`),
    ].join('\n'),
  )
  process.exitCode = 1
} else {
  console.log(
    `Bundle: the runner and Pyodide are only in py/; the ${startup.length} start-up chunks (${startupBytes.toLocaleString('en-GB')} bytes) hold neither.`,
  )
}
