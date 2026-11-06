// Packaging the runner into the app's build (PY-5, NFR-7; WP 6.2). Node only: the app's Vite
// config calls `pyRunnerPlugin`, which, after the app is written,
//
// 1. builds the runner (src/index.ts and its worker) into `<outDir>/py/`, and
// 2. copies Pyodide into `<outDir>/py/pyodide/`: the core from the `pyodide` npm package and the
//    wheels of the package sets below from the Pyodide release, every file checked against the
//    sha256 in the committed lock (`pyodide.lock.json`), with a `pyodide-lock.json` trimmed to
//    the shipped packages so nothing else is installable. micropip is not shipped.
//
// Wheels are fetched once into a cache (`.cache/pyodide/<version>/`, or WRX_PYODIDE_CACHE),
// which CI keeps with actions/cache keyed on the lock. An air-gapped build points
// WRX_PYODIDE_RELEASE at an extracted release folder (`pyodide-<version>.tar.bz2`) instead of
// the network. Nothing is fetched at run time: the page serves every file itself.
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..')
export const LOCK_FILE = join(PACKAGE_ROOT, 'pyodide.lock.json')

/** The core, from node_modules/pyodide: all that `loadPyodide` fetches in a browser. */
export const CORE_FILES = Object.freeze([
  'pyodide.mjs', // the loader, imported by the worker
  'pyodide.asm.mjs', // Emscripten glue, imported by the loader
  'pyodide.asm.wasm', // the interpreter
  'python_stdlib.zip', // the standard library
])

/**
 * The package sets the SDK needs (PY-1, PY-3): pydantic for the typed models, pandas (with
 * numpy) for the tabular helpers. Each name is a key of the release's `pyodide-lock.json`; their
 * dependencies are added from it. micropip is deliberately absent.
 */
export const PACKAGE_SETS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pydantic: ['pydantic'],
  pandas: ['pandas'],
})

export interface LockPackage {
  readonly name: string
  readonly file_name: string
  readonly sha256: string
  readonly depends: readonly string[]
  readonly [key: string]: unknown
}

/** Pyodide's own lock file format. */
export interface PyodideLock {
  readonly info: Readonly<Record<string, unknown>>
  readonly packages: Readonly<Record<string, LockPackage>>
}

export interface FileDigest {
  readonly sha256: string
  readonly bytes: number
}

/** The committed lock: what is shipped, and each file's digest. */
export interface FilesLock {
  readonly description: string
  readonly pyodide: string
  /** Where the wheels are fetched from at build time only; never at run time. */
  readonly release: string
  readonly sets: Readonly<Record<string, readonly string[]>>
  readonly core: Readonly<Record<string, FileDigest>>
  /** The release's lock file trimmed to the shipped packages: emitted as pyodide-lock.json. */
  readonly lock: PyodideLock
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The lock-file keys of some packages and all their dependencies, sorted. */
export function closure(lock: PyodideLock, roots: readonly string[]): string[] {
  const seen = new Set<string>()
  // Dependencies are named as their packages declare them (`pydantic_core`); the keys are
  // normalised (`pydantic-core`), as PEP 503 normalises names.
  const normal = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-')
  const keys = new Map(Object.keys(lock.packages).map((key) => [normal(key), key]))
  const visit = (raw: string) => {
    const name = keys.get(normal(raw)) ?? raw
    if (seen.has(name)) return
    const entry = lock.packages[name]
    if (entry === undefined) throw new Error(`pyodide-lock.json has no package ${name}`)
    seen.add(name)
    for (const dep of entry.depends) visit(dep)
  }
  roots.forEach(visit)
  return [...seen].sort()
}

/** The release's lock trimmed to the sets and their dependencies. */
export function trimLock(full: PyodideLock, sets: FilesLock['sets']): PyodideLock {
  const names = closure(full, Object.values(sets).flat())
  const packages: Record<string, LockPackage> = {}
  for (const name of names) {
    const entry = full.packages[name]
    if (entry !== undefined) packages[name] = entry
  }
  return { info: full.info, packages }
}

/** The installed `pyodide` npm package's folder. */
export function coreFolder(): string {
  return join(PACKAGE_ROOT, 'node_modules', 'pyodide')
}

export function readFilesLock(file = LOCK_FILE): FilesLock {
  return JSON.parse(readFileSync(file, 'utf8')) as FilesLock
}

/** Builds the committed lock from the installed npm package (`pnpm --filter @wrx/py-runner lock`). */
export function makeFilesLock(version: string): FilesLock {
  const core = coreFolder()
  const full = JSON.parse(readFileSync(join(core, 'pyodide-lock.json'), 'utf8')) as PyodideLock
  const digests: Record<string, FileDigest> = {}
  for (const file of CORE_FILES) {
    const bytes = readFileSync(join(core, file))
    digests[file] = { sha256: sha256(bytes), bytes: bytes.byteLength }
  }
  return {
    description:
      'The Pyodide files the runner ships (WP 6.2): checked by sha256 at every build. Regenerate with `pnpm --filter @wrx/py-runner lock` after changing the pyodide version or PACKAGE_SETS.',
    pyodide: version,
    release: `https://cdn.jsdelivr.net/pyodide/v${version}/full/`,
    sets: PACKAGE_SETS,
    core: digests,
    lock: trimLock(full, PACKAGE_SETS),
  }
}

export function cacheFolder(lock: FilesLock = readFilesLock()): string {
  return join(process.env.WRX_PYODIDE_CACHE ?? join(REPO_ROOT, '.cache', 'pyodide'), lock.pyodide)
}

type Log = (line: string) => void

async function download(url: string): Promise<Uint8Array> {
  let last: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      last = error
    }
  }
  throw new Error(`${url}: ${String(last)}`)
}

/**
 * Makes sure every shipped wheel is in the cache with the lock's sha256, fetching or copying
 * the missing ones, and returns the cache folder. A file whose digest is wrong is refused.
 */
export async function ensureWheels(lock: FilesLock = readFilesLock(), log: Log = () => undefined) {
  const folder = cacheFolder(lock)
  mkdirSync(folder, { recursive: true })
  const local = process.env.WRX_PYODIDE_RELEASE
  let fetched = 0
  for (const entry of Object.values(lock.lock.packages)) {
    const target = join(folder, entry.file_name)
    if (existsSync(target) && sha256(readFileSync(target)) === entry.sha256) continue
    const bytes =
      local !== undefined && local !== ''
        ? readFileSync(join(local, entry.file_name))
        : await download(new URL(entry.file_name, lock.release).href)
    const digest = sha256(bytes)
    if (digest !== entry.sha256) {
      throw new Error(`${entry.file_name}: sha256 ${digest} is not the lock's ${entry.sha256}`)
    }
    const partial = `${target}.partial`
    writeFileSync(partial, bytes)
    renameSync(partial, target)
    fetched++
    log(`pyodide: fetched ${entry.file_name}`)
  }
  log(
    `pyodide: ${Object.keys(lock.lock.packages).length} wheels in ${folder}, sha256 checked (${fetched} fetched)`,
  )
  return folder
}

/** Checks the npm package's core files against the lock; throws on any difference. */
export function verifyCore(lock: FilesLock = readFilesLock()): void {
  const core = coreFolder()
  const version = (
    JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')) as {
      version: string
    }
  ).version
  if (version !== lock.pyodide) {
    throw new Error(`node_modules/pyodide is ${version}, the lock is for ${lock.pyodide}`)
  }
  for (const file of CORE_FILES) {
    const digest = sha256(readFileSync(join(core, file)))
    if (digest !== lock.core[file]?.sha256) {
      throw new Error(`pyodide ${file}: sha256 ${digest} is not the lock's`)
    }
  }
}

/** Copies the checked core, the wheels and the trimmed lock into `folder`. */
export async function emitPyodide(folder: string, log: Log = () => undefined) {
  const lock = readFilesLock()
  verifyCore(lock)
  const wheels = await ensureWheels(lock, log)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  let bytes = 0
  for (const file of CORE_FILES) {
    copyFileSync(join(coreFolder(), file), join(folder, file))
    bytes += statSync(join(folder, file)).size
  }
  for (const entry of Object.values(lock.lock.packages)) {
    copyFileSync(join(wheels, entry.file_name), join(folder, entry.file_name))
    bytes += statSync(join(folder, entry.file_name)).size
  }
  writeFileSync(join(folder, 'pyodide-lock.json'), JSON.stringify(lock.lock))
  const files = CORE_FILES.length + Object.keys(lock.lock.packages).length + 1
  return { files, bytes }
}

/** Builds the runner (its entry and worker) into `folder`: `runner.js` and `assets/`. */
export async function buildRunner(folder: string): Promise<void> {
  const { build } = await import('vite')
  await build({
    configFile: false,
    root: PACKAGE_ROOT,
    base: './',
    logLevel: 'warn',
    publicDir: false,
    worker: { format: 'es' },
    build: {
      outDir: folder,
      emptyOutDir: true,
      target: 'es2023',
      assetsInlineLimit: 0,
      copyPublicDir: false,
      rolldownOptions: {
        input: { runner: join(PACKAGE_ROOT, 'src', 'index.ts') },
        preserveEntrySignatures: 'strict',
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  })
}

/**
 * The app's Vite plugin: after the app is written, the runner and Pyodide go to `py/` in the
 * output folder. The app imports neither, so its own chunks are unchanged.
 */
export function pyRunnerPlugin(): Plugin {
  let outDir = ''
  return {
    name: 'wrx-py-runner',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const folder = join(outDir, 'py')
      await buildRunner(folder)
      const { files, bytes } = await emitPyodide(join(folder, 'pyodide'), (line) => {
        this.info(line)
      })
      this.info(`py/: the runner, and ${files} Pyodide files (${(bytes / 1e6).toFixed(1)} MB)`)
    },
  }
}
