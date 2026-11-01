// The client's Content-Security-Policy has no 'unsafe-eval' (security review F7): `eval` and
// `new Function` throw. The validator, the RJSF adapter and the message schemas must work so.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
// Loaded before the stubs: the test runner's own CommonJS interop (for React, under
// `@rjsf/utils`) evaluates code while loading, which a browser bundle does not. Its use runs
// with them below.
import { createTemplateFormValidator } from './rjsf.ts'

// A function, not an arrow, so `new Function(…)` reaches it and throws as the browser does.
function refused(): never {
  throw new EvalError("Refused to evaluate a string as JavaScript: 'unsafe-eval' is not allowed")
}

describe('templates under a CSP without unsafe-eval', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('validates, checks and adapts with eval and new Function unavailable', async () => {
    vi.resetModules()
    vi.stubGlobal('eval', refused)
    vi.stubGlobal('Function', refused)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- proving it is refused
    expect(() => new Function('return 1')).toThrow(EvalError)

    // Fresh imports, so nothing was set up while eval worked.
    const schemas = await import('@wrx/schemas')
    const fixtures = await import('@wrx/schemas/fixtures')
    const { createTemplateValidator, checkTemplatedMessage } = await import('./index.ts')

    const [sitrep] = fixtures.sampleTemplates()
    const parsedTemplate = schemas.parseDocument('template', JSON.stringify(sitrep))
    expect(parsedTemplate.ok).toBe(true)
    const body = schemas.parseDocument('message', {
      type: 'template',
      schemaVersion: 1,
      content: {
        templateId: fixtures.TEMPLATE.sitrep,
        values: { force: fixtures.FORCE.blue, summary: 'ok', readiness: 50, asOf: '2026-10-24' },
      },
    })
    expect(body.ok).toBe(true)
    if (!body.ok || body.value.type !== 'template' || !parsedTemplate.ok) return

    const validator = createTemplateValidator()
    expect(validator.validate(parsedTemplate.value.schema, body.value.content.values).valid).toBe(
      true,
    )
    expect(validator.validate(parsedTemplate.value.schema, { readiness: 'x' }).valid).toBe(false)
    const design = fixtures.sampleDesign()
    const check = checkTemplatedMessage(
      body.value,
      parsedTemplate.value,
      fixtures.blueReportsConfig(),
      { loginName: fixtures.LOGIN.blueCo, isAdmin: false },
      { forces: design.forces, roles: design.roles, retired: [] },
      { validator },
    )
    expect(check.status).toBe('valid')
    const form = createTemplateFormValidator().validateFormData({}, sitrep!.schema)
    expect(form.errors.length).toBeGreaterThan(0)
  })

  it('ships an interpreter that holds no eval or Function constructor', () => {
    const require = createRequire(import.meta.url)
    const root = dirname(require.resolve('@cfworker/json-schema/package.json'))
    const dist = join(root, 'dist', 'esm')
    for (const file of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
      const source = readFileSync(join(dist, file), 'utf8')
      expect(source, file).not.toMatch(/\bnew Function\b|\beval\s*\(|\bFunction\s*\(/)
    }
  })
})
