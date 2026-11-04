// SC-9 Developer adds a new interaction to the mock (SRD §12). Traces to: §11, ARC-10–11,
// NFR-16.
//
// SC-9 is a way of working, not a browser walk-through, so it is shown where it happens rather
// than re-implemented here: one contract suite (packages/contract-suite, `defineContractSuite`)
// is run unchanged against the mock in every CI run (packages/mock-server/src/mock.contract.test.ts,
// part of `pnpm test` in ci.yml) and against the reference ejabberd on every push and pull request
// (`pnpm test:contract` in contract-ejabberd.yml). This test checks that wiring is still there,
// so a change that drops either side fails here as well as in review.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8')

test('SC-9: one contract suite runs against the mock and against ejabberd in CI (§11, ARC-10, ARC-11, NFR-16)', () => {
  // 2–3. One suite, two backends: the same `defineContractSuite` call on each.
  const onMock = read('packages/mock-server/src/mock.contract.test.ts')
  const onEjabberd = read('packages/contract-suite/ejabberd/ejabberd.contract.test.ts')
  for (const file of [onMock, onEjabberd]) {
    expect(file).toMatch(/defineContractSuite\(backend/)
  }

  // 4. CI runs both on every build: the mock in the root test run, ejabberd in its workflow.
  const ci = read('.github/workflows/ci.yml')
  expect(ci).toMatch(/on:\s*\n(?:.*\n)*?\s+pull_request:/)
  expect(ci).toMatch(/run: pnpm test(:coverage)?\s*$/m)
  const vitest = read('vitest.config.ts')
  // mock.contract.test.ts is under packages/*/src, which the root run includes.
  expect(vitest).toContain("'packages/*/src/**/*.test.{ts,tsx}'")

  const contract = read('.github/workflows/contract-ejabberd.yml')
  expect(contract).toMatch(/on:\s*\n(?:.*\n)*?\s+pull_request:/)
  expect(contract).toMatch(/run: pnpm stack:up/)
  expect(contract).toMatch(/run: pnpm test:contract\s*$/m)
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
  expect(scripts['test:contract']).toBe('pnpm --filter @wrx/contract-suite test:ejabberd')
  // An unreachable server fails the job: nothing is skipped (NFR-16).
  expect(contract).not.toMatch(/continue-on-error:\s*true/)

  // And the user scenarios (WP 3.1) run on both too: here on the mock, there on ejabberd.
  expect(contract).toMatch(/playwright test --project=ejabberd/)
})
