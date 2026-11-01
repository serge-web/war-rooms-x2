// The deployment checks (WP 3.3) against a running ejabberd stack: one file, run serially.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['deployment/**/*.ejabberd.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
