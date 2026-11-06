// The S17 page's own build, apart from the app's (apps/web is untouched). It copies Pyodide's
// core from node_modules/pyodide and the shipped wheels from .cache/wheels (fetch-packages.ts)
// into dist/pyodide/, with the lock file trimmed to what is shipped, so the page fetches nothing
// outside its own origin (NFR-7, PY-5).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { CORE_FILES, shippedPackages } from './scripts/packages.ts'
import type { Lockfile } from './scripts/packages.ts'

const here = import.meta.dirname

function pyodideFiles(): Plugin {
  let outDir = ''
  return {
    name: 's17-pyodide-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir, 'pyodide')
    },
    writeBundle() {
      mkdirSync(outDir, { recursive: true })
      const core = join(here, 'node_modules/pyodide')
      for (const file of CORE_FILES) {
        if (file !== 'pyodide-lock.json') copyFileSync(join(core, file), join(outDir, file))
      }
      const lock = JSON.parse(readFileSync(join(core, 'pyodide-lock.json'), 'utf8')) as Lockfile
      const shipped = shippedPackages(lock)
      const packages = Object.fromEntries(shipped.map((name) => [name, lock.packages[name]]))
      for (const name of shipped) {
        const file = lock.packages[name]?.file_name
        if (file === undefined) throw new Error(name)
        copyFileSync(join(here, '.cache/wheels', file), join(outDir, file))
      }
      writeFileSync(join(outDir, 'pyodide-lock.json'), JSON.stringify({ ...lock, packages }))
    },
  }
}

export default defineConfig({
  root: here,
  base: './',
  plugins: [pyodideFiles()],
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2023',
  },
})
