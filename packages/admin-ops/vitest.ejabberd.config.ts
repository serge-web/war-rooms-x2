// The admin-ops integration against ejabberd: one file, run serially against one server.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['ejabberd/**/*.ejabberd.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
})
