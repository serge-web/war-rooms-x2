import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    // The contract suite runs against the mock in this run (WP 1.4, NFR-16), and its tests are
    // tagged. The names are CONTRACT_TAGS from @wrx/contract-suite; mock.contract.test.ts checks
    // that they match.
    tags: [
      { name: 'r1', description: 'R1 tests (S01, S01b, C01)' },
      { name: 'raw', description: 'Probes that send raw stanzas (needs RawAccess)' },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/*/src/**'],
      exclude: ['**/*.test.*', '**/fixtures.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
})
