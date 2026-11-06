// The sample scripts (python/examples) import into the Scripts panel as they are: the bundle and
// each .py file pass `parseScriptFiles`, and the bundle holds every .py file's current code
// (`python python/examples/make_bundle.py` regenerates it; `pnpm check:python` checks it too).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPTY_SCRIPTS, importScripts, parseScriptFiles } from './scripts.ts'

const folder = join(import.meta.dirname, '..', '..', '..', 'python', 'examples')
const pyFiles = readdirSync(folder).filter((f) => f.endsWith('.py') && f !== 'make_bundle.py')

describe('the sample scripts (python/examples)', () => {
  it('the bundle imports, every script off for publishing without review', () => {
    const text = readFileSync(join(folder, 'sample-scripts.json'), 'utf8')
    const read = parseScriptFiles([{ name: 'sample-scripts.json', text }])
    if (!read.ok) throw new Error(read.error)
    expect(read.value).toHaveLength(pyFiles.length)
    const imported = importScripts(EMPTY_SCRIPTS, read.value, '2026-11-06T15:00:00.000Z')
    if (!imported.ok) throw new Error(imported.error)
    expect(imported.value.scripts.every((s) => !s.settings.autoPublish)).toBe(true)
  })

  it('holds every .py file as it is, and uses no interim module', () => {
    const bundle = JSON.parse(readFileSync(join(folder, 'sample-scripts.json'), 'utf8')) as {
      scripts: { code: string }[]
    }
    const codes = new Set(bundle.scripts.map((s) => s.code))
    for (const file of pyFiles) {
      const code = readFileSync(join(folder, file), 'utf8')
      expect(codes.has(code), file).toBe(true)
      expect(code, file).not.toContain('wrx_draft')
      expect(parseScriptFiles([{ name: file, text: code }]).ok, file).toBe(true)
    }
  })
})
