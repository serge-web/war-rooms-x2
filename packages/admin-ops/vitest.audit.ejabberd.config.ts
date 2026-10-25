// The audit scenario (WP 2.10) against ejabberd: one file, run serially against one server.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['ejabberd-audit/**/*.ejabberd.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
})
