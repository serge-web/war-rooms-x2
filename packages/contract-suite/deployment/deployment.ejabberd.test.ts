// Checks of a running ejabberd stack as a deployment (WP 3.3): what the reference config promises
// beyond the transport contract (NFR-2, NFR-10, NFR-22). Runs against the contract-suite stack
// (`pnpm stack:up`) and against an installed reference deployment (ops/offline-install.sh), with
// `pnpm test:deployment:ejabberd`. WRX_EXPECT_CLIENT=1 adds the checks of the served client.
import { connect } from 'node:tls'
import type { Session } from '@wrx/transport'
import { XmppTransport } from '@wrx/transport-xmpp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const websocketUrl = process.env.WRX_XMPP_WS ?? 'wss://localhost:35443/ws'
const domain = process.env.WRX_XMPP_DOMAIN ?? 'localhost'
/** Set by deploy/ejabberd/bootstrap.sh for a throwaway local container; not a product secret. */
const adminPassword = process.env.WRX_ADMIN_PASSWORD ?? 'spike-password'
const expectClient = process.env.WRX_EXPECT_CLIENT === '1'

const base = new URL('/', websocketUrl.replace(/^wss:/, 'https:'))
const transport = new XmppTransport({ timeoutMs: 120_000 })
const endpoint = { websocketUrl, domain }

function must<T>(
  result:
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown },
  what: string,
): T {
  if (result.ok) return result.value
  throw new Error(`${what}: ${JSON.stringify(result.error)}`)
}

async function get(path: string): Promise<Response> {
  return fetch(new URL(path, base), { redirect: 'manual' })
}

/** Whether a TLS handshake at exactly this version succeeds. */
function handshake(version: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({
      host: base.hostname,
      port: Number(base.port || 443),
      servername: base.hostname,
      minVersion: version,
      maxVersion: version,
      // Let the client offer the old versions; the server must be the one to refuse.
      ciphers: 'DEFAULT@SECLEVEL=0',
    })
    socket.once('secureConnect', () => {
      socket.end()
      resolve(true)
    })
    socket.once('error', () => {
      resolve(false)
    })
  })
}

describe(`deployment checks (${base.host})`, () => {
  describe('HTTP (NFR-10)', () => {
    it('serves the page at / with the security headers', async () => {
      const response = await get('/')
      expect(response.status).toBe(200)
      const csp = response.headers.get('content-security-policy') ?? ''
      for (const directive of [
        "default-src 'self'",
        // One policy for every role (SRD Annex C PR3): the Python runner's WebAssembly and its
        // blob: worker, never eval.
        "script-src 'self' 'wasm-unsafe-eval';",
        "worker-src 'self' blob:;",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
      ]) {
        expect(csp).toContain(directive)
      }
      expect(csp).not.toMatch(/(^|\s)'unsafe-eval'/)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    })

    it('answers 404 for the REST API, web admin, registration and upload paths', async () => {
      for (const path of ['/api', '/api/status', '/admin', '/admin/', '/register', '/upload']) {
        expect((await get(path)).status, path).toBe(404)
      }
    })

    it('serves nothing outside the client folder', async () => {
      for (const path of ['/../conf/ejabberd.yml', '/%2e%2e/conf/ejabberd.yml', '/..%2fconf']) {
        expect((await get(path)).status, path).toBe(404)
      }
    })

    it.runIf(expectClient)('serves the built client and its config.json', async () => {
      const page = await (await get('/')).text()
      expect(page).toMatch(/<script type="module"[^>]* src="\.\/assets\/index-[\w-]+\.js"/)
      const config: unknown = await (await get('/config.json')).json()
      expect(config).toEqual({
        server: { websocketUrl: '/ws', domain, label: expect.any(String) as unknown },
        defaultBackend: 'server',
      })
      const popout = await get('/popout.html')
      expect(popout.status).toBe(200)
      const script = /src="\.\/(assets\/index-[\w-]+\.js)"/.exec(page)?.[1] ?? ''
      const js = await get(`/${script}`)
      expect(js.status).toBe(200)
      expect(js.headers.get('content-type')).toBe('text/javascript')
    })

    it.runIf(expectClient)(
      'serves the Python runner and Pyodide, .wasm as application/wasm',
      async () => {
        // Pyodide compiles its interpreter with WebAssembly.instantiateStreaming, which refuses
        // any other type (WP 6.2, Annex C PR3).
        const types: Record<string, string> = {
          'py/runner.js': 'text/javascript',
          'py/pyodide/pyodide.mjs': 'text/javascript',
          'py/pyodide/pyodide.asm.wasm': 'application/wasm',
          'py/pyodide/python_stdlib.zip': 'application/zip',
          'py/pyodide/pyodide-lock.json': 'application/json',
        }
        for (const [path, type] of Object.entries(types)) {
          const response = await get(`/${path}`)
          expect(response.status, path).toBe(200)
          expect(response.headers.get('content-type'), path).toBe(type)
          await response.arrayBuffer()
        }
      },
    )
  })

  describe('TLS (NFR-2)', () => {
    it('accepts TLS 1.2 and 1.3 only', async () => {
      expect(await handshake('TLSv1')).toBe(false)
      expect(await handshake('TLSv1.1')).toBe(false)
      expect(await handshake('TLSv1.2')).toBe(true)
      expect(await handshake('TLSv1.3')).toBe(true)
    })
  })

  // NFR-22. WebSocket sessions take their rate limit from the c2s listener in ejabberd.yml: with
  // that listener removed, players were not limited at all (WP 3.3 probe). 50 kB/s sustained
  // with a 300 kB burst: 1 MB takes at least (1000 - 300) / 50 = 14 s for a player, and no
  // time for the admin.
  describe('per-player rate limit (NFR-22)', () => {
    const player = `ratecheck-${Math.random().toString(36).slice(2, 8)}`
    const password = `pw-${Math.random().toString(36).slice(2, 12)}`
    let admin: Session | undefined

    beforeAll(async () => {
      admin = must(
        await transport.connect({
          endpoint,
          credentials: { kind: 'password', username: 'admin', password: adminPassword },
        }),
        'admin login',
      )
      must(await admin.admin.addUser(`${player}@${domain}`, password), 'add player')
    })

    afterAll(async () => {
      await admin?.admin.deleteUser(`${player}@${domain}`)
      await admin?.disconnect()
    })

    /** Seconds to send 40 private-storage writes of 25 kB (1 MB) on one session. */
    const timeToSend = async (session: Session): Promise<number> => {
      const chunk = 'x'.repeat(25_000)
      const start = Date.now()
      for (let i = 0; i < 40; i++) {
        must(await session.admin.setPrivate(`ratecheck-${String(i % 4)}`, chunk), 'write')
      }
      return (Date.now() - start) / 1000
    }

    it('holds a player to about 50 kB/s after the burst, and not the admin', async () => {
      const session = must(
        await transport.connect({
          endpoint,
          credentials: { kind: 'password', username: player, password },
        }),
        'player login',
      )
      try {
        expect(await timeToSend(session)).toBeGreaterThan(10)
      } finally {
        await session.disconnect()
      }
      if (admin === undefined) throw new Error('no admin')
      expect(await timeToSend(admin)).toBeLessThan(5)
      for (let i = 0; i < 4; i++) await admin.admin.setPrivate(`ratecheck-${String(i)}`, '')
    }, 120_000)
  })
})
