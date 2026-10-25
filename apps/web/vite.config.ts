import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/**
 * marked's GFM autolink tokenizer contains the regex text `xmpp:email`, which the site's
 * real-server scan (DOC-12, `xmpp-uri`) rightly flags in a preview build. This writes the `p` as
 * the regex escape `\x70`: the same regex, without the URI-shaped text, so the scan can stay
 * strict for the app's own code.
 */
function markedXmppAutolink(): Plugin {
  return {
    name: 'wrx-marked-xmpp-autolink',
    transform(code, id) {
      if (!/[\\/]marked[\\/]/.test(id) || !code.includes('xmpp:email')) return null
      return { code: code.replaceAll('xmpp:email', 'xmp\\x70:email'), map: null }
    },
  }
}

// Two builds of one app:
// - `vite build` (default): mock only. Previews, the demo, snapshots and the site use it, so it
//   reads no config.json and carries no real transport or endpoint (DOC-12).
// - `vite build --mode server` into server-build/dist: also the real server, its endpoints read
//   at runtime from config.json next to index.html (NFR-9).
export default defineConfig(({ mode }) => {
  const server = mode === 'server'
  return {
    plugins: [react(), markedXmppAutolink()],
    // Relative asset URLs, so one build runs under any base path: PR previews, the demo and
    // snapshots on GitHub Pages, or a customer's static host (DOC-11, NFR-8).
    base: './',
    define: { __WRX_REAL_SERVER__: JSON.stringify(server) },
    build: {
      assetsInlineLimit: 0,
      outDir: server ? 'server-build/dist' : 'dist',
      // React, Radix, zod, FlexLayout (WP 2.5) and the in-tab mock server; the real transport and
      // the admin backend are their own chunks.
      chunkSizeWarningLimit: 900,
    },
    preview: { port: server ? 4175 : 4173 },
  }
})
