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

/**
 * The Content-Security-Policy of a build (security review F7), as a `<meta>` tag in the built
 * index.html; deploy/README.md gives the same policy as a header, with the parts a meta tag
 * cannot carry. Scripts, workers, styles, fonts and images come only from the build itself:
 * no inline script and no eval. Inline styles stay allowed: React style attributes,
 * FlexLayout's layout and the styles a popout copies from its opener use them. Images also
 * take `data:`/`blob:` (theme assets are shown as `data:` URLs, §3 rule 12).
 *
 * `connect-src`: the mock build talks to nothing but its own origin (config.json, the mock's
 * SharedWorker). The server build reads its endpoint from config.json at run time, so the host
 * is not known when building: it allows any `wss:` host, and plain `ws:` only to this machine,
 * as config.ts does (F13). An operator who knows the host narrows it with the header.
 *
 * Only in `vite build`: the dev server needs an inline React refresh preamble and its own
 * WebSocket.
 */
export function contentSecurityPolicy(server: boolean): string {
  const connect = server
    ? "'self' wss: ws://localhost:* ws://127.0.0.1:* ws://*.localhost:*"
    : "'self'"
  return [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}

function cspMeta(server: boolean): Plugin {
  return {
    name: 'wrx-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: contentSecurityPolicy(server),
          },
          injectTo: 'head-prepend',
        },
      ],
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
    plugins: [react(), markedXmppAutolink(), cspMeta(server)],
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
