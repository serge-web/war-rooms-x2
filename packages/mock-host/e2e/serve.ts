// Serves the built test page as two deployments on one origin, as GitHub Pages serves previews
// and the demo (DOC-10): `/dep-a/` and `/dep-b/` are the same files under different base paths.
//
//   node e2e/serve.ts <folder> <port>
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname } from 'node:path'
import { resolvePath } from '../../../tools/site/lib/serve.ts'

export const DEPLOYMENTS = Object.freeze(['/dep-a/', '/dep-b/'])

const TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
})

const [dir, port] = process.argv.slice(2)
if (dir !== undefined && port !== undefined) {
  createServer((request, response) => {
    const url = request.url ?? '/'
    const base = DEPLOYMENTS.find((b) => url.startsWith(b))
    const file = base === undefined ? undefined : resolvePath(dir, base, url)
    if (file === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('Not found')
      return
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    response.end(readFileSync(file))
  }).listen(Number(port))
  console.log(
    `Serving ${dir} at ${DEPLOYMENTS.map((b) => `http://localhost:${port}${b}`).join(', ')}`,
  )
}
