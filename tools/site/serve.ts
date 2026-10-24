// Serves a built site under a base path, as GitHub Pages would.
//
//   node tools/site/serve.ts <folder> <port> <base path>
import { normaliseBase } from './lib/paths.ts'
import { serve } from './lib/serve.ts'

const [dir, port, base] = process.argv.slice(2)
if (dir === undefined || port === undefined) {
  console.error('usage: serve <folder> <port> [base path]')
  process.exit(2)
}
const prefix = normaliseBase(base ?? '/')
serve(dir, Number(port), prefix)
console.log(`Serving ${dir} at http://localhost:${port}${prefix}`)
