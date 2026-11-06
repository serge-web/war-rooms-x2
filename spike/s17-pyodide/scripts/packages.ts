// What the spike ships of Pyodide (PY-5, NFR-7): the core from the `pyodide` npm package, and the
// wheels of a few packages from the full release distribution, which npm does not carry.
// fetch-packages.ts downloads the wheels once, at build time, into .cache/ (git-ignored), and
// checks each against the sha256 in the release's own pyodide-lock.json; build.ts copies them.

export const PYODIDE_VERSION = '314.0.7'

/** The core, from node_modules/pyodide: all that `loadPyodide` fetches in a browser. */
export const CORE_FILES = Object.freeze([
  'pyodide.mjs', // the loader, imported by the worker
  'pyodide.asm.mjs', // Emscripten glue, imported by the loader
  'pyodide.asm.wasm', // the interpreter
  'python_stdlib.zip', // the standard library
  'pyodide-lock.json', // the package index; build.ts trims it to the packages shipped
])

/**
 * The package sets the spike measures. Each name is a key of pyodide-lock.json `packages`;
 * build.ts adds their dependencies from the lock file. micropip is deliberately not shipped
 * (the worker must not install anything at run time).
 */
export const PACKAGE_SETS = Object.freeze({
  numpy: ['numpy'],
  pandas: ['pandas'],
  pydantic: ['pydantic'],
} as const)

export type PackageSet = keyof typeof PACKAGE_SETS

/** Where the release's packages are fetched from at build time only; never at run time. */
export const RELEASE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

export interface LockPackage {
  readonly name: string
  readonly file_name: string
  readonly sha256: string
  readonly depends: readonly string[]
  readonly [key: string]: unknown
}

export interface Lockfile {
  readonly info: Record<string, unknown>
  readonly packages: Record<string, LockPackage>
}

/** The lock-file keys of a set of packages and every dependency, sorted. */
export function closure(lock: Lockfile, roots: readonly string[]): string[] {
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

/** Every package shipped: the union of the sets. */
export function shippedPackages(lock: Lockfile): string[] {
  return closure(lock, Object.values(PACKAGE_SETS).flat())
}
