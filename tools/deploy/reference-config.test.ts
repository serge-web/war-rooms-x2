// The reference deployment's files against what NFR-2, NFR-10 and NFR-22 require (WP 3.3),
// checked on every `pnpm test`, so a change that loosens one fails here before any stack runs.
// The running stacks are checked by `pnpm test:deployment:ejabberd`; this reads the files.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '../../apps/web/vite.config.ts'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const yml = read('deploy/ejabberd/ejabberd.yml')
const contractCompose = read('deploy/ejabberd/compose.yaml')
const referenceCompose = read('deploy/wrx1/compose.yaml')
const PIN = /ejabberd\/ecs:[\d.]+@sha256:[0-9a-f]{64}/g

/** The YAML text without comments, so a commented-out line never passes or fails a check. */
const live = yml
  .split('\n')
  .map((line) => line.replace(/(^|\s)#.*$/, ''))
  .filter((line) => line.trim() !== '')
  .join('\n')

/** The `listen:` entries, each as its text. */
function listeners(): string[] {
  const block = /^listen:\n([\s\S]*?)^\S/m.exec(live)?.[1] ?? ''
  return block.split(/^ {2}-(?: |$)/m).filter((entry) => entry.trim() !== '')
}

describe('the ejabberd image (NFR-22)', () => {
  it('is pinned by digest, the same in both stacks and in no other form', () => {
    const contract = contractCompose.match(PIN) ?? []
    const reference = referenceCompose.match(PIN) ?? []
    expect(contract).toHaveLength(1)
    expect(reference).toEqual(contract)
    expect(referenceCompose).toMatch(/pull_policy: never/)
  })
})

describe('the reference ejabberd.yml (NFR-2, NFR-22)', () => {
  it('publishes TLS only: one TLS HTTP listener, and the c2s listener on loopback', () => {
    const entries = listeners()
    expect(entries).toHaveLength(2)
    const http = entries.filter((e) => /module: ejabberd_http\b/.test(e))
    const c2s = entries.filter((e) => /module: ejabberd_c2s\b/.test(e))
    expect(http).toHaveLength(1)
    expect(http[0]).toMatch(/tls: true/)
    expect(http[0]).toMatch(/- no_tlsv1_1/)
    expect(c2s).toHaveLength(1)
    expect(c2s[0]).toMatch(/ip: '127\.0\.0\.1'/)
    expect(c2s[0]).toMatch(/starttls_required: true/)
  })

  it('applies the per-player rate limit through the c2s listener, which WebSocket uses', () => {
    const c2s = listeners().find((e) => /module: ejabberd_c2s\b/.test(e)) ?? ''
    expect(c2s).toMatch(/shaper: c2s_shaper/)
    expect(live).toMatch(/c2s_shaper:\n\s+none: admin\n\s+player: all/)
    expect(live).toMatch(/player:\n\s+rate: \d+/)
  })

  it('has no REST API, web admin, registration or upload, and no ad-hoc admin API', () => {
    const handlers = /request_handlers:\n((?:\s{6,}\S.*\n)+)/.exec(live)?.[1] ?? ''
    expect(
      handlers
        .trim()
        .split('\n')
        .map((l) => l.trim()),
    ).toEqual(['/ws: ejabberd_http_ws', '/: mod_http_fileserver'])
    for (const module of [
      'mod_register',
      'mod_register_web',
      'mod_http_api',
      'mod_adhoc_api',
      'ejabberd_web_admin',
      'mod_http_upload',
      'mod_bosh',
    ]) {
      expect(live).not.toMatch(new RegExp(`^\\s+${module}:`, 'm'))
    }
  })

  it('uses SCRAM-SHA-256 for stored passwords', () => {
    expect(live).toMatch(/^auth_password_format: scram$/m)
    expect(live).toMatch(/^auth_scram_hash: sha256$/m)
  })

  it('sends the client’s own Content-Security-Policy, narrowed to its origin and unframed', () => {
    const header = /Content-Security-Policy: "([^"]+)"/.exec(live)?.[1]
    // The mock build's policy is the server build's with connect-src narrowed to 'self', which
    // covers a WebSocket on the same origin; and no tile host, as the install configures no
    // base map (WP 5.5): an operator who adds tiles adds their origin to img-src.
    expect(header).toBe(`${contentSecurityPolicy(false, 'none')}; frame-ancestors 'none'`)
    expect(live).toMatch(/X-Content-Type-Options: nosniff/)
    expect(live).toMatch(/Referrer-Policy: no-referrer/)
  })

  it('lets the Python runner compile WebAssembly, never eval (Annex C PR3, WP 6.2)', () => {
    const header = /Content-Security-Policy: "([^"]+)"/.exec(live)?.[1] ?? ''
    const directives = new Map(
      header.split(';').map((d) => {
        const [name = '', ...values] = d.trim().split(/\s+/)
        return [name, values] as const
      }),
    )
    expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:'])
    for (const values of directives.values()) expect(values).not.toContain("'unsafe-eval'")
  })

  it('serves .wasm as application/wasm, which streaming compilation needs (PR3)', () => {
    const types = /content_types:\n((?:\s{6,}\S.*\n)+)/.exec(live)?.[1] ?? ''
    expect(types).toMatch(/^\s+\.wasm: application\/wasm$/m)
    expect(types).toMatch(/^\s+\.whl: application\/zip$/m)
    expect(types).toMatch(/^\s+\.zip: application\/zip$/m)
    expect(types).toMatch(/^\s+\.mjs: text\/javascript$/m)
  })

  it('lists rooms in pages the transport can page through (review F10)', () => {
    const limit = Number(/max_rooms_discoitems: (\d+)/.exec(live)?.[1])
    const page = Number(
      /roomListPageSize: (\d+)/.exec(read('packages/transport-xmpp/src/ejabberd.ts'))?.[1],
    )
    expect(page).toBeGreaterThan(0)
    expect(limit).toBeGreaterThanOrEqual(page)
  })

  it('creates rooms closed by default: members-only, moderated, unlisted, no side channels', () => {
    const defaults = /default_room_options:\n((?:\s{6,}\S.*\n)+)/.exec(live)?.[1] ?? ''
    for (const line of [
      'members_only: true',
      'moderated: true',
      'public: false',
      'mam: true',
      'allow_private_messages_from_visitors: nobody',
      'allow_visitor_status: false',
      'allow_visitor_nickchange: false',
      'allow_voice_requests: false',
      'allow_subscription: false',
    ]) {
      expect(defaults).toContain(line)
    }
  })
})

describe('the compose files (NFR-2, NFR-10)', () => {
  it('publish one port each, to the TLS listener only', () => {
    const ports = (text: string) => [...text.matchAll(/^\s+- '([^']*:5\d{3})'/gm)].map((m) => m[1])
    expect(ports(contractCompose)).toEqual(['127.0.0.1:${WRX_XMPP_PORT:-35443}:5443'])
    expect(ports(referenceCompose)).toEqual([
      '${WRX_BIND_ADDRESS:-0.0.0.0}:${WRX_HTTPS_PORT:-443}:5443',
    ])
  })

  it('hold no secret', () => {
    for (const text of [
      yml,
      contractCompose,
      referenceCompose,
      read('deploy/wrx1/wrx1.env.example'),
    ]) {
      expect(text).not.toMatch(/PRIVATE KEY|password:\s*\S|PASSWORD=\S/)
    }
  })
})
