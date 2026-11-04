// The S15-S16 checks: run serially against one live server (scripts/run.ts picks the config).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 600_000,
    hookTimeout: 300_000,
  },
})
