import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pyRunnerPlugin } from '@wrx/py-runner/packaging'
import { DEMO_TILE_ORIGIN } from './src/tiles.ts'

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
 * RJSF's format-to-widget table (`@rjsf/utils` getWidget) maps the string format `password` to
 * `PasswordWidget`, text the site's secret scan (NFR-1, `password-literal`) rightly flags. The
 * template profile allows only the formats `date` and `date-time` (WP 4.1), so the template
 * preview never looks that entry up: this drops it, and the scan stays strict.
 */
function rjsfPasswordFormat(): Plugin {
  return {
    name: 'wrx-rjsf-password-format',
    transform(code, id) {
      if (!/[\\/]@rjsf[\\/]utils[\\/]/.test(id) || !code.includes("password: 'PasswordWidget',")) {
        return null
      }
      return { code: code.replace("password: 'PasswordWidget',", ''), map: null }
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
 * `img-src` and the map's base tiles (WP 5.5, NFR-9): the mock build reads no config.json, so
 * its tiles are the built-in demo default and its policy names exactly that origin (`'demo'`).
 * The server build reads the tile URL from config.json at run time, so, as with `connect-src`,
 * it allows any `https:` image host (`'any'`) and the operator's header narrows it to theirs.
 * `'none'` is the policy with no tile host at all: the reference deployment's header, whose
 * install configures no tiles (plan/reviews/phase-5-security-notes.md).
 *
 * The Python runner (SRD Annex C PR3, decided Nov 6, 2026; WP 6.2): one policy for every role.
 * `script-src` adds `'wasm-unsafe-eval'`, which lets the page and its workers compile
 * WebAssembly (Pyodide's interpreter) and nothing else: `eval` and `new Function` stay refused,
 * and `'unsafe-eval'` must never appear. `worker-src` adds `blob:` for the runner's one-line
 * bootstrap, which makes its worker take this policy even where it is only a `<meta>` tag (a
 * worker loaded from its own URL takes the policy of its own response, which a static host
 * sends without one). Only the build's own code creates `blob:` URLs: there is no inline
 * script or eval to make one. Servers send `.wasm` as `application/wasm`.
 *
 * Only in `vite build`: the dev server needs an inline React refresh preamble and its own
 * WebSocket.
 */
export type TilePolicy = 'demo' | 'any' | 'none'

export function imageSources(tiles: TilePolicy): string {
  const extra = tiles === 'demo' ? ` ${DEMO_TILE_ORIGIN}` : tiles === 'any' ? ' https:' : ''
  return `'self' data: blob:${extra}`
}

export function contentSecurityPolicy(
  server: boolean,
  tiles: TilePolicy = server ? 'any' : 'demo',
): string {
  const connect = server
    ? "'self' wss: ws://localhost:* ws://127.0.0.1:* ws://*.localhost:*"
    : "'self'"
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources(tiles)}`,
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

/**
 * `popout.html` is a static file with its own policy (F7): a popped-out map loads its tiles under
 * that policy, so the build writes its own `img-src` into the copy in the output folder.
 */
function popoutImageSources(server: boolean): Plugin {
  let outDir = ''
  return {
    name: 'wrx-popout-img-src',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      const file = join(outDir, 'popout.html')
      const html = readFileSync(file, 'utf8')
      const next = html.replace(
        "img-src 'self' data: blob:;",
        `img-src ${imageSources(server ? 'any' : 'demo')};`,
      )
      if (next === html) throw new Error('popout.html: no img-src to set')
      writeFileSync(file, next)
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
    plugins: [
      react(),
      markedXmppAutolink(),
      rjsfPasswordFormat(),
      cspMeta(server),
      popoutImageSources(server),
      // The Python runner and Pyodide, into py/ beside the app; the app imports neither (PY-5).
      pyRunnerPlugin(),
    ],
    // Relative asset URLs, so one build runs under any base path: PR previews, the demo and
    // snapshots on GitHub Pages, or a customer's static host (DOC-11, NFR-8).
    base: './',
    define: { __WRX_REAL_SERVER__: JSON.stringify(server) },
    build: {
      assetsInlineLimit: 0,
      outDir: server ? 'server-build/dist' : 'dist',
      // React, Radix, zod, FlexLayout (WP 2.5) and the in-tab mock server; the real transport and
      // the admin backend are their own chunks. So is the map (WP 5.5), loaded lazily: Leaflet
      // and milsymbol with all its symbol sets, about 1 MB before gzip.
      chunkSizeWarningLimit: 1100,
    },
    preview: { port: server ? 4175 : 4173 },
  }
})
