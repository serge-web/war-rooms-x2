import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One page per library, plus the blank page both libraries use to host popout windows.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rolldownOptions: {
      input: {
        index: 'index.html',
        flexlayout: 'flexlayout.html',
        dockview: 'dockview.html',
      },
    },
  },
})
