// The contract suite against ejabberd: one file, run serially against one shared server.
import { defineConfig } from 'vitest/config'
import { CONTRACT_TAGS } from './src/index.ts'

export default defineConfig({
  test: {
    include: ['ejabberd/**/*.contract.test.ts'],
    tags: [...CONTRACT_TAGS],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
