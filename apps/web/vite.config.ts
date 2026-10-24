import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so one build runs under any base path: PR previews, the demo and
  // snapshots on GitHub Pages, or a customer's static host (DOC-11, NFR-8).
  base: './',
  build: { assetsInlineLimit: 0 },
})
