// The Python runner's e2e server (WP 6.2, from S17's scripts/serve.ts). It serves the app's
// mock build (apps/web/dist, made by the e2e suite's first web server) and the runner's test
// page (harness/, built here into dist/) under a Content-Security-Policy chosen by the
// first path segment, `/p/<policy>/...`:
//
// - `header`: the app's own policy (`contentSecurityPolicy(false)`) as a header on every
//   response, as the reference deployment's mod_http_fileserver sends it.
// - `meta`: no header; the policy only as a `<meta>` tag, as on a static host (GitHub Pages).
//   The app's index.html carries its own from the build; the test page gets the same one.
// - `none`: no policy at all, the control that shows the probes do find a way out.
//
// Also a canary server on PORT+1 (another origin) that counts every request, so the spec can
// prove a script reached nothing outside the origin; `/__hits` and `/__csp` (violation reports).
//
//   node e2e/py-runner/serve.ts <port>
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { build } from 'vite'
import { contentSecurityPolicy } from '../../vite.config.ts'

const port = Number(process.argv[2] ?? 4179)
const here = import.meta.dirname
const dist = join(here, '..', '..', 'dist')
const harnessDist = join(here, 'dist')

if (!existsSync(join(dist, 'py', 'runner.js'))) {
  console.error('apps/web/dist has no py/runner.js: build the app first (pnpm build)')
  process.exit(1)
}
await build({
  configFile: false,
  root: join(here, 'harness'),
  base: './',
  logLevel: 'warn',
  build: { outDir: harnessDist, emptyOutDir: true, target: 'es2023', assetsInlineLimit: 0 },
})

const POLICY = contentSecurityPolicy(false)
type Delivery = 'header' | 'meta' | 'none'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.whl': 'application/zip',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const hits: { origin: 'main' | 'canary'; path: string }[] = []
const reports: unknown[] = []

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

function resolveFile(rest: string): string | undefined {
  const harness = rest.startsWith('__harness/')
  const root = harness ? harnessDist : dist
  const rel = normalize(harness ? rest.slice('__harness/'.length) : rest) || 'index.html'
  const file = join(root, rel === '.' || rel === '' ? 'index.html' : rel)
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return undefined
  return file
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  if (url.pathname === '/__csp') {
    reports.push(JSON.parse((await body(req)) || 'null'))
    res.writeHead(204).end()
    return
  }
  if (url.pathname === '/__hits') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ hits, reports }))
    if (url.searchParams.has('clear')) {
      hits.length = 0
      reports.length = 0
    }
    return
  }
  const match = /^\/p\/(header|meta|none)\/(.*)$/.exec(url.pathname)
  const delivery = match?.[1] as Delivery | undefined
  const file = match === null ? undefined : resolveFile(decodeURIComponent(match[2] ?? ''))
  if (delivery === undefined || file === undefined) {
    hits.push({ origin: 'main', path: url.pathname })
    res.writeHead(404).end()
    return
  }
  const ext = extname(file)
  let content: Buffer = readFileSync(file)
  if (ext === '.html' && file.startsWith(harnessDist) && delivery === 'meta') {
    const tag = `<meta http-equiv="Content-Security-Policy" content="${POLICY}" />`
    content = Buffer.from(content.toString('utf8').replace('<head>', `<head>\n    ${tag}`))
  }
  if (ext === '.html' && delivery === 'none') {
    // The control: no policy, not even the build's own <meta> tag.
    content = Buffer.from(
      content.toString('utf8').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
    )
  }
  const etag = `"${createHash('sha1').update(content).digest('hex')}"`
  // The reference deployment's headers (deploy/README.md), with revalidation: no-cache + ETag.
  const headers: Record<string, string> = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ETag: etag,
  }
  if (delivery === 'header') {
    headers['Content-Security-Policy'] = `${POLICY}; report-uri /__csp`
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end()
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(content.length) })
  res.end(content)
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    res.writeHead(500).end(String(error))
  })
}).listen(port, () => {
  console.log(`Python runner e2e server on http://localhost:${port}/p/header/__harness/`)
})

// The canary: another origin. Any request here is a leak.
createServer((req, res) => {
  hits.push({ origin: 'canary', path: req.url ?? '' })
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/javascript' })
  res.end('export const leaked = true\n')
}).listen(port + 1)
