import type { MockHost, MockNotice } from '@wrx/mock-host'
import type { Transport } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { Backends } from './backends.ts'
import { NO_CONFIG, loadConfig, parseConfig, websocketUrl } from './config.ts'
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
  it('lists every demo role with its demo password, by force', () => {
    expect(demoLogins().map((l) => [l.roleId, l.password])).toEqual([
      ['blue-co', 'demo-blue-co'],
      ['blue-observer', 'demo-blue-observer'],
      ['red-co', 'demo-red-co'],
      ['umpire-1', 'demo-umpire-1'],
    ])
    expect(demoLogins()[0]?.label).toBe('Blue CO (Blue)')
  })
})
