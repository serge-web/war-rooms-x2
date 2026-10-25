// The backends this page can use (PLY-20): the mock, always, and the real server when
// config.json names one (NFR-9). Each transport is made on first use and then kept: the mock
// host is shared by every tab of the deployment (D17), so one per page is enough.
import { connectMockTransport } from '@wrx/mock-host'
import type { MockHost, MockNotice } from '@wrx/mock-host'
import { DEFAULT_SEED_DOMAIN } from '@wrx/mock-server'
import type { BackendInfo } from '@wrx/player-ui'
import type { Endpoint, Transport, Unsubscribe } from '@wrx/transport'
import type { RuntimeConfig } from './config.ts'

export type BackendId = 'mock' | 'server'

export interface BackendEntry {
  readonly id: BackendId
  readonly info: BackendInfo
  readonly endpoint: Endpoint
  readonly description: string
}

export interface BackendsOptions {
  /** Loads the real transport. Absent in mock-only builds (DOC-12). */
  readonly loadXmpp?: () => Promise<Transport>
  /** Starts the mock host. Default `connectMockTransport`. */
  readonly startMock?: (onNotice: (notice: MockNotice) => void) => Promise<MockHost>
  /** Called with the mock host once it has started, e.g. to expose it to tests. */
  readonly onMockHost?: (host: MockHost) => void
}

/** The mock ignores the endpoint; the domain is the demo seed's. */
const MOCK_ENDPOINT: Endpoint = Object.freeze({ websocketUrl: '', domain: DEFAULT_SEED_DOMAIN })

export class Backends {
  readonly entries: readonly BackendEntry[]
  private readonly transports = new Map<BackendId, Promise<Transport>>()
  private readonly notices: MockNotice[] = []
  private readonly listeners = new Set<(notice: MockNotice) => void>()
  private mock: Promise<MockHost> | undefined

  constructor(
    config: RuntimeConfig,
    private readonly options: BackendsOptions = {},
  ) {
    const entries: BackendEntry[] = []
    const server = config.server
    if (server !== undefined && options.loadXmpp !== undefined) {
      entries.push({
        id: 'server',
        info: { kind: 'xmpp', address: server.label },
        endpoint: server.endpoint,
        description: `The game server at ${server.endpoint.domain}.`,
      })
    }
    entries.push({
      id: 'mock',
      info: { kind: 'mock' },
      endpoint: MOCK_ENDPOINT,
      description:
        'Runs in this browser, with demo data; works offline. Nothing leaves this browser.',
    })
    if (config.defaultBackend === 'mock') entries.reverse()
    this.entries = Object.freeze(entries)
  }

  /** The default backend: the real server when configured, unless config says mock. */
  get initial(): BackendId {
    const first = this.entries[0]
    if (first === undefined) throw new Error('no backends')
    return first.id
  }

  entry(id: BackendId): BackendEntry {
    const found = this.entries.find((e) => e.id === id)
    if (found === undefined) throw new Error(`no ${id} backend`)
    return found
  }

  has(id: string): id is BackendId {
    return this.entries.some((e) => e.id === id)
  }

  /** The backend's transport, made on first use. */
  transport(id: BackendId): Promise<Transport> {
    const known = this.transports.get(id)
    if (known !== undefined) return known
    const made = id === 'mock' ? this.mockHost() : this.loadXmpp()
    this.transports.set(id, made)
    return made
  }

  /** The mock host, started on first use. Never rejects (DOC-17). */
  mockHost(): Promise<MockHost> {
    this.mock ??= (this.options.startMock ?? defaultStartMock)((notice) => {
      this.notices.push(notice)
      for (const listener of [...this.listeners]) listener(notice)
    }).then((host) => {
      this.options.onMockHost?.(host)
      return host
    })
    return this.mock
  }

  /** The mock's notices (DOC-17), including those before the call. */
  onNotice(listener: (notice: MockNotice) => void): Unsubscribe {
    for (const notice of this.notices) listener(notice)
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private loadXmpp(): Promise<Transport> {
    const load = this.options.loadXmpp
    if (load === undefined)
      return Promise.reject(new Error('this build has no real-server backend'))
    return load()
  }
}

function defaultStartMock(onNotice: (notice: MockNotice) => void): Promise<MockHost> {
  return connectMockTransport({ onNotice })
}
