// The mock transport (ARC-1, D14): the 1.1 Transport over a mock server, `kind: 'mock'` so the
// UI can say so (PLY-1). Many sessions share one server; each has its own connection.
import type { ConnectOptions, Outcome, Session, Transport } from '@wrx/transport'
import { MockNetwork } from './network.ts'
import type { ServerLink } from './protocol.ts'
import { MockSession } from './session.ts'
import type { ReconnectOptions } from './session.ts'

export interface MockTransportOptions {
  /** The simulated network (test controls). Default: a fresh one on real timers. */
  readonly network?: MockNetwork
  /** How long an operation or login waits for its reply. Default 15 s, as the real transport. */
  readonly timeoutMs?: number
  /** Reconnection after a drop. Default: 50 ms doubling to 2 s, 10 attempts. */
  readonly reconnect?: Partial<ReconnectOptions>
}

export const DEFAULT_RECONNECT: ReconnectOptions = Object.freeze({
  initialMs: 50,
  maxMs: 2_000,
  maxAttempts: 10,
})

export class MockTransport implements Transport {
  readonly kind = 'mock'
  readonly network: MockNetwork
  private readonly timeoutMs: number
  private readonly reconnect: ReconnectOptions

  /** `server` is a MockServer, or WP 1.5's relay to one in another context. */
  constructor(
    private readonly server: ServerLink,
    options: MockTransportOptions = {},
  ) {
    this.network = options.network ?? new MockNetwork()
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.reconnect = { ...DEFAULT_RECONNECT, ...options.reconnect }
  }

  /** The endpoint is ignored: the server is the one given to the constructor. */
  connect(options: ConnectOptions): Outcome<Session> {
    return MockSession.open(this.server, options, {
      network: this.network,
      timeoutMs: this.timeoutMs,
      reconnect: this.reconnect,
    })
  }
}
