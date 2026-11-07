import type { MockHost, MockNotice } from '@wrx/mock-host'
import type { Transport } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { Backends } from './backends.ts'
import { NO_CONFIG, loadConfig, parseConfig, parseTiles, tileUrl, websocketUrl } from './config.ts'
import { DEMO_TILES, DEMO_TILE_ORIGIN } from './tiles.ts'
import { contentSecurityPolicy } from '../vite.config.ts'
import { demoLogins } from './demo-logins.ts'
import { parseRoute } from './router.ts'

const BASE = 'https://wrx.example/games/app/index.html'

describe('runtime config (NFR-9)', () => {
  it('reads the server endpoints', () => {
    expect(
      parseConfig(
        { server: { websocketUrl: 'wss://xmpp.wrx.example/ws', domain: 'wrx.example' } },
        BASE,
      ),
    ).toEqual({
      ok: true,
      config: {
        server: {
          endpoint: { websocketUrl: 'wss://xmpp.wrx.example/ws', domain: 'wrx.example' },
          label: 'wrx.example',
        },
        defaultBackend: 'server',
      },
    })
  })

  it('takes a path as the same origin, for a reverse proxy (NFR-8)', () => {
    expect(websocketUrl('/ws', BASE)).toBe('wss://wrx.example/ws')
    expect(websocketUrl('ws', 'http://localhost:8080/app/')).toBe('ws://localhost:8080/app/ws')
    expect(websocketUrl('ftp://x', BASE)).toBeUndefined()
  })

  it('rejects what it cannot trust', () => {
    expect(parseConfig([], BASE).ok).toBe(false)
    expect(parseConfig({ server: { websocketUrl: '/ws', domain: 'not a domain' } }, BASE).ok).toBe(
      false,
    )
    expect(parseConfig({ server: { domain: 'wrx.example' } }, BASE).ok).toBe(false)
    expect(parseConfig({ defaultBackend: 'other' }, BASE).ok).toBe(false)
    expect(parseConfig({}, BASE)).toEqual({
      ok: true,
      config: { server: undefined, defaultBackend: 'mock' },
    })
  })

  it('refuses plaintext ws: except to this machine (security review F13)', () => {
    const at = (websocketUrl: string, base = BASE) =>
      parseConfig({ server: { websocketUrl, domain: 'wrx.example' } }, base)
    const refused = at('ws://xmpp.wrx.example/ws')
    expect(refused.ok).toBe(false)
    expect(refused.ok ? '' : refused.error).toMatch(/wss:.*localhost/)
    // A path on a plain-http page off this machine is ws: too.
    expect(at('/ws', 'http://wrx.example/').ok).toBe(false)
    for (const local of [
      'ws://localhost:5280/ws',
      'ws://127.0.0.1:9/xmpp-websocket',
      'ws://[::1]:5280/ws',
      'ws://app.localhost/ws',
    ]) {
      expect(at(local).ok, local).toBe(true)
    }
    expect(at('/ws', 'http://localhost:8080/').ok).toBe(true)
    expect(at('wss://xmpp.wrx.example/ws').ok).toBe(true)
  })

  it('treats a missing or unreachable file as no config (NFR-8)', async () => {
    const missing = await loadConfig(() => Promise.resolve(new Response('', { status: 404 })), BASE)
    expect(missing).toEqual({ ok: true, config: NO_CONFIG })
    const offline = await loadConfig(() => Promise.reject(new TypeError('file://')), BASE)
    expect(offline).toEqual({ ok: true, config: NO_CONFIG })
    const broken = await loadConfig(() => Promise.resolve(new Response('{')), BASE)
    expect(broken.ok).toBe(false)
  })

  it('fetches config.json next to the page', async () => {
    const asked: string[] = []
    await loadConfig((url) => {
      asked.push(url)
      return Promise.resolve(new Response('{}'))
    }, BASE)
    expect(asked).toEqual(['https://wrx.example/games/app/config.json'])
  })
})

describe('the map’s base tiles in config.json (NFR-9, WP 5.5)', () => {
  const tiles = (value: unknown, base = BASE) => parseConfig({ map: { tiles: value } }, base)

  it('reads a tile server, with or without the endpoints', () => {
    const osm = {
      url: 'https://tile.example.org/{z}/{x}/{y}.png',
      attribution: '  © OpenStreetMap contributors ',
      attributionUrl: 'https://www.openstreetmap.org/copyright',
    }
    expect(tiles(osm)).toEqual({
      ok: true,
      config: {
        server: undefined,
        defaultBackend: 'mock',
        tiles: {
          url: 'https://tile.example.org/{z}/{x}/{y}.png',
          attribution: '© OpenStreetMap contributors',
          attributionUrl: 'https://www.openstreetmap.org/copyright',
          maxZoom: 19,
        },
      },
    })
    const both = parseConfig(
      {
        server: { websocketUrl: '/ws', domain: 'wrx.example' },
        map: { tiles: { ...osm, maxZoom: 17 } },
      },
      BASE,
    )
    expect(both.ok && both.config.tiles?.maxZoom).toBe(17)
    // No map block: no base map, and nothing asked of any tile server.
    const none = parseConfig({ server: { websocketUrl: '/ws', domain: 'wrx.example' } }, BASE)
    expect(none.ok && none.config.tiles).toBeUndefined()
    expect(parseConfig({ map: {} }, BASE)).toMatchObject({ ok: true, config: { tiles: undefined } })
  })

  it('takes a path as a tile server on this origin, and subdomains and retina', () => {
    expect(tileUrl('/tiles/{z}/{x}/{y}.png', BASE)).toBe(
      'https://wrx.example/tiles/{z}/{x}/{y}.png',
    )
    expect(tileUrl('https://{s}.tiles.example/{z}/{x}/{y}{r}.png', BASE)).toBe(
      'https://{s}.tiles.example/{z}/{x}/{y}{r}.png',
    )
    expect(tileUrl('http://localhost:8080/{z}/{x}/{y}.png', BASE)).toBe(
      'http://localhost:8080/{z}/{x}/{y}.png',
    )
  })

  it('refuses what it cannot trust', () => {
    for (const url of [
      'http://tiles.example/{z}/{x}/{y}.png', // plaintext off this machine
      'ftp://tiles.example/{z}/{x}/{y}.png',
      'javascript:alert(1)//{z}{x}{y}',
      'https://tiles.example/{z}/{x}.png', // no {y}
      'https://tiles.example/{z}/{x}/{y}.png?key={apikey}', // a placeholder Leaflet cannot fill
      'https://tiles.example/{z}/{x}/{y}.png{',
      'https://user:secret@tiles.example/{z}/{x}/{y}.png',
      `https://tiles.example/${'a'.repeat(600)}/{z}/{x}/{y}.png`,
    ]) {
      expect(tileUrl(url, BASE), url).toBeUndefined()
    }
    const good = { url: 'https://t.example/{z}/{x}/{y}.png', attribution: 'Tiles' }
    expect(tiles(good).ok).toBe(true)
    expect(tiles({ ...good, url: 'http://t.example/{z}/{x}/{y}.png' }).ok).toBe(false)
    expect(tiles({ ...good, attribution: '' }).ok).toBe(false)
    expect(tiles({ ...good, attribution: 'x'.repeat(201) }).ok).toBe(false)
    expect(tiles({ ...good, attribution: 3 }).ok).toBe(false)
    expect(tiles({ ...good, attributionUrl: 'http://t.example/' }).ok).toBe(false)
    expect(tiles({ ...good, attributionUrl: 'javascript:alert(1)' }).ok).toBe(false)
    expect(tiles({ ...good, maxZoom: 23 }).ok).toBe(false)
    expect(tiles({ ...good, maxZoom: 1.5 }).ok).toBe(false)
    expect(tiles('https://t.example/{z}/{x}/{y}.png').ok).toBe(false)
    expect(parseConfig({ map: [] }, BASE).ok).toBe(false)
    const refused = tiles({ ...good, url: 'nope' })
    expect(refused.ok ? '' : refused.error).toMatch(/^map\.tiles\.url/)
  })

  it('the mock build’s default is a valid config, and its origin is what its policy allows', () => {
    const parsed = parseTiles({ tiles: DEMO_TILES }, BASE)
    expect(parsed).toEqual({ ok: true, tiles: { ...DEMO_TILES } })
    expect(new URL(DEMO_TILES.url.replace(/\{[a-z]\}/g, '0')).origin).toBe(DEMO_TILE_ORIGIN)
  })
})

describe('routes', () => {
  it('maps hashes to views, whatever the base path (DOC-11)', () => {
    expect(parseRoute('')).toEqual({ name: 'player' })
    expect(parseRoute('#/')).toEqual({ name: 'player' })
    expect(parseRoute('#/admin')).toEqual({ name: 'admin' })
    expect(parseRoute('#/multi/')).toEqual({ name: 'multi' })
    expect(parseRoute('#/nowhere')).toEqual({ name: 'not-found', path: '/nowhere' })
  })
})

describe('backends (PLY-20)', () => {
  const server = {
    endpoint: { websocketUrl: 'wss://xmpp.wrx.example/ws', domain: 'wrx.example' },
    label: 'Exercise server',
  }
  const xmpp: Transport = { kind: 'xmpp', connect: () => Promise.reject(new Error('unused')) }

  it('offers the mock only, without a configured server or a real-server build (DOC-12)', () => {
    expect(new Backends(NO_CONFIG).entries.map((e) => e.id)).toEqual(['mock'])
    const noXmpp = new Backends({ server, defaultBackend: 'server' })
    expect(noXmpp.entries.map((e) => e.id)).toEqual(['mock'])
  })

  it('defaults to the configured server, with the mock still selectable', async () => {
    const backends = new Backends(
      { server, defaultBackend: 'server' },
      { loadXmpp: () => Promise.resolve(xmpp) },
    )
    expect(backends.initial).toBe('server')
    expect(backends.entries.map((e) => e.id)).toEqual(['server', 'mock'])
    expect(backends.entry('server').info).toEqual({ kind: 'xmpp', address: 'Exercise server' })
    expect(await backends.transport('server')).toBe(xmpp)
    expect(
      new Backends({ server, defaultBackend: 'mock' }, { loadXmpp: () => Promise.resolve(xmpp) })
        .initial,
    ).toBe('mock')
  })

  it('starts the mock once and replays its notices to late listeners (DOC-17)', async () => {
    let starts = 0
    const host = { kind: 'mock' } as unknown as MockHost
    const notice: MockNotice = { kind: 'reset', text: 'The mock was reset.' }
    const seenHosts: MockHost[] = []
    const backends = new Backends(NO_CONFIG, {
      startMock: (onNotice) => {
        starts++
        onNotice(notice)
        return Promise.resolve(host)
      },
      onMockHost: (h) => seenHosts.push(h),
    })
    expect(await backends.transport('mock')).toBe(host)
    expect(await backends.mockHost()).toBe(host)
    expect(starts).toBe(1)
    expect(seenHosts).toEqual([host])
    const heard: MockNotice[] = []
    const off = backends.onNotice((n) => heard.push(n))
    expect(heard).toEqual([notice])
    off()
  })
})

describe('demo logins (NFR-6)', () => {
  it('lists every demo role with its demo password, by force, then the admin as umpire', () => {
    expect(demoLogins().map((l) => [l.roleId, l.password])).toEqual([
      ['blue-co', 'demo-blue-co'],
      ['blue-observer', 'demo-blue-observer'],
      ['red-co', 'demo-red-co'],
      ['white-observer', 'demo-white-observer'],
      ['white-cell', 'demo-white-cell'],
      ['admin', 'demo-admin'],
    ])
    expect(demoLogins().at(-1)?.label).toBe('Umpire (White, admin)')
    expect(demoLogins()[0]?.label).toBe('Blue CO (Blue)')
  })
})

describe('the Content-Security-Policy’s images (F7, WP 5.5)', () => {
  const imgSrc = (policy: string) => /img-src ([^;]+)/.exec(policy)?.[1]

  it('names the demo tile origin in the mock build, any https: host in the server build', () => {
    expect(imgSrc(contentSecurityPolicy(false))).toBe(`'self' data: blob: ${DEMO_TILE_ORIGIN}`)
    expect(imgSrc(contentSecurityPolicy(true))).toBe("'self' data: blob: https:")
    expect(imgSrc(contentSecurityPolicy(false, 'none'))).toBe("'self' data: blob:")
    // Never eval, whatever the tiles.
    for (const policy of [contentSecurityPolicy(false), contentSecurityPolicy(true)]) {
      expect(policy).not.toMatch(/(^|\s)'unsafe-eval'/)
      expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval';")
    }
  })
})

describe('the Content-Security-Policy for the Python runner (Annex C PR3, WP 6.2)', () => {
  const directive = (policy: string, name: string) =>
    new RegExp(`(?:^|; )${name} ([^;]+)`).exec(policy)?.[1]
  const every = (['demo', 'any', 'none'] as const).flatMap((tiles) => [
    contentSecurityPolicy(false, tiles),
    contentSecurityPolicy(true, tiles),
  ])

  it('is one policy for every role: WebAssembly and blob: workers, nothing more', () => {
    for (const policy of every) {
      expect(directive(policy, 'script-src')).toBe("'self' 'wasm-unsafe-eval'")
      expect(directive(policy, 'worker-src')).toBe("'self' blob:")
      expect(directive(policy, 'default-src')).toBe("'self'")
      expect(directive(policy, 'object-src')).toBe("'none'")
    }
  })

  it('never allows eval: no unsafe-eval and no inline script, in any directive', () => {
    for (const policy of every) {
      for (const part of policy.split(';')) {
        expect(part.trim().split(/\s+/)).not.toContain("'unsafe-eval'")
      }
      expect(directive(policy, 'script-src')).not.toMatch(/unsafe-inline|blob:|data:|\*/)
    }
  })
})
