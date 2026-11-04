// The backup and restore check (WP 3.3) against ejabberd: one file, one step per run.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['ejabberd-restore/**/*.ejabberd.test.ts'],
    testTimeout: 300_000,
    fileParallelism: false,
  },
})
