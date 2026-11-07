// The committed lock (pyodide.lock.json) against the installed `pyodide` package: a version
// bump or a change to PACKAGE_SETS without `pnpm --filter @wrx/py-runner lock` fails here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CORE_FILES,
  PACKAGE_SETS,
  closure,
  coreFolder,
  makeFilesLock,
  readFilesLock,
  trimLock,
  verifyCore,
} from './packaging.ts'
import type { PyodideLock } from './packaging.ts'

describe('the Pyodide files lock (PY-5, NFR-7)', () => {
  const lock = readFilesLock()

  it('is what `lock` makes from the installed npm package', () => {
    expect(lock).toEqual(makeFilesLock(lock.pyodide))
    expect(() => {
      verifyCore(lock)
    }).not.toThrow()
    expect(Object.keys(lock.core).sort()).toEqual([...CORE_FILES].sort())
  })

  it('ships the pydantic and the pandas sets with their dependencies, and no micropip', () => {
    expect(Object.keys(lock.lock.packages)).toEqual([
      'annotated-types',
      'numpy',
      'pandas',
      'pydantic',
      'pydantic-core',
      'python-dateutil',
      'pytz',
      'six',
      'typing-extensions',
      'typing-inspection',
    ])
    expect(lock.sets).toEqual(PACKAGE_SETS)
    for (const entry of Object.values(lock.lock.packages)) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.file_name).toMatch(/^[\w.+-]+\.whl$/)
    }
    expect(lock.release).toBe(`https://cdn.jsdelivr.net/pyodide/v${lock.pyodide}/full/`)
  })

  it('trims the release lock to the closure of the sets', () => {
    const full = JSON.parse(
      readFileSync(join(coreFolder(), 'pyodide-lock.json'), 'utf8'),
    ) as PyodideLock
    expect(Object.keys(full.packages).length).toBeGreaterThan(100)
    expect(full.packages.micropip).toBeDefined()
    expect(trimLock(full, { x: ['pydantic'] }).packages.numpy).toBeUndefined()
    expect(closure(full, ['pandas'])).toEqual(['numpy', 'pandas', 'python-dateutil', 'pytz', 'six'])
    expect(() => closure(full, ['no-such-package'])).toThrow(/no package no-such-package/)
  })
})
