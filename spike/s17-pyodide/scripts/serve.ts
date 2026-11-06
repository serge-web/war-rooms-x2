// Serves dist/ for the spec, under a Content-Security-Policy chosen by the first path segment:
// `/p/<policy>/index.html`. Every policy starts from the app's own (`contentSecurityPolicy` in
// apps/web/vite.config.ts, the mock build) and changes only what its name says. A header policy
// is sent on every response, as the reference deployment's mod_http_fileserver sends its custom
// headers (deploy/ejabberd/ejabberd.yml), so it also reaches the worker scripts. A `-meta` policy
// is only a <meta> tag in index.html, as on a static host that cannot set headers (GitHub Pages).
//
// Also: a canary server on PORT+1 (another origin) that counts every request, so the spec can
// prove a script reached nothing outside the origin; `/__hits` and `/__csp` (violation reports).
//
//   node scripts/serve.ts [port]        default 5027
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { contentSecurityPolicy } from '../../../apps/web/vite.config.ts'

const port = Number(process.argv[2] ?? process.env.S17_PORT ?? 5027)
const dist = join(import.meta.dirname, '..', 'dist')

/** The app's policy, as directives, so a policy can change one and keep the rest. */
function directives(): Map<string, string> {
  return new Map(
    contentSecurityPolicy(false)
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .map((d) => {
        const [name = '', ...values] = d.split(' ')
        return [name, values.join(' ')] as const
      }),
  )
}

function render(map: Map<string, string>): string {
  return [...map].map(([k, v]) => `${k} ${v}`).join('; ')
}

interface Policy {
  readonly csp: string | undefined
  readonly delivery: 'header' | 'meta' | 'none'
  /** The type .wasm is served as. ejabberd's reference content_types has no .wasm entry. */
  readonly wasmType: string
}

function policy(name: string): Policy | undefined {
  const d = directives()
  const meta = name.endsWith('-meta')
  const base = meta ? name.slice(0, -'-meta'.length) : name
  let wasmType = 'application/wasm'
  switch (base) {
    case 'none':
      return { csp: undefined, delivery: 'none', wasmType }
    case 'app': // the app's policy, unchanged
      break
    case 'wasm': // + 'wasm-unsafe-eval'
      d.set('script-src', "'self' 'wasm-unsafe-eval'")
      break
    case 'wasm-octet': // as wasm, with .wasm served as application/octet-stream
      d.set('script-src', "'self' 'wasm-unsafe-eval'")
      wasmType = 'application/octet-stream'
      break
    case 'unsafe-eval': // + 'unsafe-eval' (which also allows WebAssembly)
      d.set('script-src', "'self' 'unsafe-eval'")
      break
    case 'wasm-blob': // + 'wasm-unsafe-eval', and workers from blob: URLs
      d.set('script-src', "'self' 'wasm-unsafe-eval'")
      d.set('worker-src', "'self' blob:")
      break
    case 'wasm-strict': // the narrowest that runs: wasm, and nothing the spike does not use
      d.set('default-src', "'none'")
      d.set('script-src', "'self' 'wasm-unsafe-eval'")
      d.set('img-src', "'self'")
      d.set('style-src', "'self'")
      break
    default:
      return undefined
  }
  if (!meta) d.set('report-uri', '/__csp')
  return { csp: render(d), delivery: meta ? 'meta' : 'header', wasmType }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.whl': 'application/zip',
  '.css': 'text/css',
}

const hits: { origin: 'main' | 'canary'; path: string }[] = []
const reports: unknown[] = []

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
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
  const match = /^\/p\/([a-z-]+)\/(.*)$/.exec(url.pathname)
  const chosen = match === null ? undefined : policy(match[1] ?? '')
  if (match === null || chosen === undefined) {
    hits.push({ origin: 'main', path: url.pathname })
    res.writeHead(404).end()
    return
  }
  const rel = normalize(match[2] === '' ? 'index.html' : (match[2] ?? ''))
  const file = join(dist, rel)
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    hits.push({ origin: 'main', path: url.pathname })
    res.writeHead(404).end()
    return
  }
  const ext = extname(file)
  let content: Buffer = readFileSync(file)
  if (ext === '.html' && chosen.delivery === 'meta' && chosen.csp !== undefined) {
    const tag = `<meta http-equiv="Content-Security-Policy" content="${chosen.csp}" />`
    content = Buffer.from(content.toString('utf8').replace('<head>', `<head>\n    ${tag}`))
  }
  const etag = `"${createHash('sha1').update(content).digest('hex')}"`
  // The reference deployment's headers (deploy/README.md), with revalidation: no-cache + ETag.
  const headers: Record<string, string> = {
    'Content-Type': ext === '.wasm' ? chosen.wasmType : (TYPES[ext] ?? 'application/octet-stream'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ETag: etag,
  }
  if (chosen.delivery === 'header' && chosen.csp !== undefined) {
    headers['Content-Security-Policy'] = chosen.csp
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
}).listen(port, () => console.log(`S17 page on http://localhost:${port}/p/wasm/`))

// The canary: another origin. Any request here is a leak.
createServer((req, res) => {
  hits.push({ origin: 'canary', path: req.url ?? '' })
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/javascript' })
  res.end('export const leaked = true\n')
}).listen(port + 1)
