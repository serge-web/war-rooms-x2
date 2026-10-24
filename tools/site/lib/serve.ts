// A static file server that behaves like GitHub Pages for one deployment: the folder is served
// under a base path, `/x` finds `x.html`, folders find `index.html`, and misses get `404.html`.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** The file a request path maps to under `base`, or undefined if it is outside the folder. */
export function resolvePath(dir: string, base: string, urlPath: string): string | undefined {
  let path: string
  try {
    path = decodeURIComponent(urlPath.split('?')[0] ?? '')
  } catch {
    return undefined
  }
  if (!path.startsWith(base)) return undefined
  const relativePath = normalize(path.slice(base.length))
  if (relativePath.startsWith('..') || relativePath.split(sep).includes('..')) return undefined
  const full = join(dir, relativePath)
  const candidates = [full, `${full}.html`, join(full, 'index.html')]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile())
}

export function serve(dir: string, port: number, base: string): Server {
  const server = createServer((request, response) => {
    const file = resolvePath(dir, base, request.url ?? '/')
    const notFound = join(dir, '404.html')
    if (file === undefined) {
      response.writeHead(404, { 'content-type': TYPES['.html'] ?? 'text/html' })
      response.end(existsSync(notFound) ? readFileSync(notFound) : 'Not found')
      return
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    response.end(readFileSync(file))
  })
  server.listen(port)
  return server
}
