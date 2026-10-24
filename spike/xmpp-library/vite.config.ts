// Production build of the two smoke pages, one per library, so each library's bundle is measured alone.
// No Node polyfill plugins: anything missing shows up as a build warning or a runtime error.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2023',
    sourcemap: false,
    rollupOptions: {
      input: {
        stanza: resolve(import.meta.dirname, 'stanza.html'),
        xmppjs: resolve(import.meta.dirname, 'xmppjs.html'),
      },
    },
  },
});
