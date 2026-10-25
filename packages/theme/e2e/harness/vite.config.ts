import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The theme package's browser test page (WP 2.8), built and served by playwright.config.ts.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  preview: { port: 4394, strictPort: true },
})
