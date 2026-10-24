// Gzipped size each library adds to a minimal React 19 production build: build three entries
// (React only, React + FlexLayout, React + dockview) and subtract the baseline.
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build, type Rolldown } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))

async function measure(
  entry: string,
): Promise<{ js: number; css: number; jsRaw: number; cssRaw: number }> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [react()],
    build: { write: false, rolldownOptions: { input: `${here}${entry}` } },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  const sizes = { js: 0, css: 0, jsRaw: 0, cssRaw: 0 }
  for (const out of outputs.flatMap((o) => o.output)) {
    const body = out.type === 'chunk' ? out.code : out.source
    const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)
    const gz = gzipSync(bytes, { level: 9 }).length
    if (out.fileName.endsWith('.js')) {
      sizes.js += gz
      sizes.jsRaw += bytes.length
    } else if (out.fileName.endsWith('.css')) {
      sizes.css += gz
      sizes.cssRaw += bytes.length
    }
  }
  return sizes
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`
const base = await measure('baseline.tsx')
console.log(`baseline (react + react-dom): ${kb(base.js)} gzip JS`)
for (const lib of ['flexlayout', 'dockview']) {
  const s = await measure(`${lib}.tsx`)
  console.log(
    `${lib}: +${kb(s.js - base.js)} gzip JS, +${kb(s.css)} gzip CSS ` +
      `(raw +${kb(s.jsRaw - base.jsRaw)} JS, ${kb(s.cssRaw)} CSS)`,
  )
}
