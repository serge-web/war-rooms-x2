import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The test page, built with relative URLs as the app is (DOC-11), so one build serves both
// test deployments under their own base paths.
export default defineConfig({
  root: fileURLToPath(new URL('./app', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
})
