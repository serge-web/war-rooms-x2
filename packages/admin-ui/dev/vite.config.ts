import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The admin editor's dev page (WP 2.2): `pnpm --filter @wrx/admin-ui dev`. The Playwright
// scenarios build and serve it, until `apps/web` mounts the editor at /admin.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  preview: { port: 4393, strictPort: true },
})
