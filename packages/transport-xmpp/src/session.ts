// One logged-in connection over StanzaJS: login, readiness, service discovery (ARC-2), reconnect
// with back-off and XEP-0198 resumption (PLY-2), and the forced-logout stream errors (PLY-50).
import { err, ok } from '@wrx/transport'
import type {
  ConnectOptions,
  ConnectionStatus,
  EndReason,
  Outcome,
  Recovery,
  Services,
  Session,
  TransportError,
  Unsubscribe,
} from '@wrx/transport'
import type { Result } from '@wrx/schemas'
import { JID, createClient } from 'stanza'
import { XmppAdmin } from './admin.ts'
import { backoffDelay } from './backoff.ts'
import type { BackoffOptions } from './backoff.ts'
import type { Agent, Core } from './core.ts'
import { Listeners } from './listeners.ts'
import { XmppMam } from './mam.ts'
import { XmppMuc } from './muc.ts'
import { XmppPubsub } from './pubsub.ts'
import { Refusal } from './refusal.ts'
import type { ServerAdapter } from './server-adapter.ts'

/** Every SASL mechanism StanzaJS registers except ANONYMOUS (Client.ts). */
const NAMED_MECHANISMS = Object.freeze([
  'EXTERNAL',
  'SCRAM-SHA-256-PLUS',
  'SCRAM-SHA-256',
  'SCRAM-SHA-1-PLUS',
  'SCRAM-SHA-1',
  'DIGEST-MD5',
  'OAUTHBEARER',
  'X-OAUTH2',
  'PLAIN',
] as const)

/** StanzaJS's own stream error when it gives up on negotiation (features.ts), not the server's. */
const LOCAL_NEGOTIATION_FAILURE = 'Failed to negotiate stream features'

export interface SessionSettings {
  readonly adapter: ServerAdapter
  readonly backoff: BackoffOptions
  readonly timeoutMs: number
  /** How long to wait for `<enabled/>` after resource binding before going online without SM. */
  readonly smWaitMs: number
  /** XEP-0199 keep-alive interval, in seconds; a dead connection then counts as dropped. */
  readonly keepAliveSeconds: number
}

type Phase = 'connecting' | 'online' | 'reconnecting' | 'ended'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class XmppSession implements Session {
  readonly anonymous: boolean
  readonly muc: XmppMuc
  readonly mam: XmppMam
  readonly pubsub: XmppPubsub
  readonly admin: XmppAdmin

  private readonly client: Agent
  private readonly core: Core
  private readonly statusListeners = new Listeners<'status', ConnectionStatus>()
  private readonly recoveryListeners = new Listeners<'recovery', Recovery>()
  private phase: Phase = 'connecting'
  private current: ConnectionStatus = { state: 'reconnecting', attempt: 0 }
  private discovered: Services | undefined
  /** Set by a terminal stream error or auth failure; applied when the socket closes. */
  private pendingEnd: { reason: EndReason; text?: string } | undefined
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  /** Cancels the operations in flight when the session ends (they resolve `disconnected`). */
  private readonly inflight = new Set<() => void>()
  private disconnecting: Promise<void> | undefined
  /** Settles the first connection attempt. */
  private settleConnect: ((result: Result<undefined, TransportError>) => void) | undefined

  private constructor(
    private readonly options: ConnectOptions,
    private readonly settings: SessionSettings,
  ) {
    const { endpoint, credentials } = options
    this.anonymous = credentials.kind === 'anonymous'
    this.client = createClient({
      jid:
        credentials.kind === 'anonymous'
          ? endpoint.domain
          : `${credentials.username}@${endpoint.domain}`,
      ...(credentials.kind === 'password' ? { password: credentials.password } : {}),
      ...(options.resource === undefined ? {} : { resource: options.resource }),
      transports: { websocket: endpoint.websocketUrl, bosh: false },
      useStreamManagement: true,
      allowResumption: true,
      // Reconnection is ours: StanzaJS's would rejoin rooms by itself.
      autoReconnect: false,
      timeout: Math.ceil(settings.timeoutMs / 1000),
    })
    if (this.anonymous) {
      // StanzaJS picks the highest mechanism the server offers without checking it holds the
      // credentials for it, and ranks ANONYMOUS lowest (WP 0.3, stanza PR #489).
      for (const mechanism of NAMED_MECHANISMS) this.client.sasl.disable(mechanism)
    }
    this.core = {
      client: this.client,
      adapter: settings.adapter,
      domain: endpoint.domain,
      timeoutMs: settings.timeoutMs,
      services: () => this.services,
      bareJid: () => JID.toBare(this.client.jid),
      run: (operation) => this.run(operation),
    }
    this.muc = new XmppMuc(this.core)
    this.mam = new XmppMam(this.core)
    this.pubsub = new XmppPubsub(this.core)
    this.admin = new XmppAdmin(this.core)
    this.wire()
  }

  /** Connects, waits until ready (stream management enabled, services known), then resolves. */
  static async open(options: ConnectOptions, settings: SessionSettings): Outcome<Session> {
    const session = new XmppSession(options, settings)
    const started = await session.start()
    if (!started.ok) return started
    const services = await session.discover()
    if (!services.ok) {
      await session.disconnect()
      return services
    }
    session.discovered = services.value
    session.setStatus({ state: 'online' })
    session.phase = 'online'
    return ok(session)
  }

  get jid(): string {
    return this.client.jid
  }

  get services(): Services {
    if (this.discovered === undefined) throw new Error('services are not discovered yet')
    return this.discovered
  }

  status(): ConnectionStatus {
    return this.current
  }

  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe {
    return this.statusListeners.add('status', listener)
  }

  onRecovered(listener: (recovery: Recovery) => void): Unsubscribe {
    return this.recoveryListeners.add('recovery', listener)
  }

  disconnect(): Promise<void> {
    if (this.disconnecting !== undefined) return this.disconnecting
    this.disconnecting = this.logout()
    return this.disconnecting
  }

  /**
   * Test hook (PLY-2), not part of the Session interface: drops the WebSocket without closing the
   * stream, as a network failure would. With `lost`, the stream-management state is forgotten
   * first, as if the server had lost the session, so recovery binds a new session.
   */
  interruptConnection(how: 'resumable' | 'lost'): void {
    if (how === 'lost') this.client.sm.id = undefined
    this.client.transport?.disconnect(false)
  }

  /**
   * Test hook for the contract suite's S01b probes: sends XML as it is on this session's own
   * stream, bypassing StanzaJS, to show the server refuses it.
   */
  sendRawForTest(xml: string): void {
    const transport = this.client.transport
    const write: unknown = transport === undefined ? undefined : Reflect.get(transport, 'write')
    if (typeof write !== 'function') throw new Error('the transport cannot write raw XML')
    Reflect.apply(write, transport, [xml])
  }

  /** Test hook: every XML element this session receives, as text. */
  onRawIncomingForTest(listener: (xml: string) => void): Unsubscribe {
    this.client.on('raw:incoming', listener)
    return () => {
      this.client.off('raw:incoming', listener)
    }
  }

  // ---- lifecycle ----------------------------------------------------------------------------

  private wire(): void {
    const client = this.client
    client.on('presence', (presence) => {
      this.muc.handlePresence(presence)
    })
    client.on('message', (message) => {
      this.muc.handleMessage(message)
      this.pubsub.handleMessage(message)
    })
    client.on('auth:failed', () => {
      this.pendingEnd ??= { reason: 'auth-failed' }
    })
    // RFC 6120 §4.9: the server's <stream:error/> reaches StanzaJS listeners as top-level data
    // of kind `streamError`; its `stream:error` event carries only errors StanzaJS raises itself.
    client.on('stream:data', (data: unknown, kind: string) => {
      if (kind !== 'streamError' || typeof data !== 'object' || data === null) return
      const condition: unknown = Reflect.get(data, 'condition')
      const text: unknown = Reflect.get(data, 'text')
      if (typeof condition !== 'string') return
      this.onStreamError(condition, typeof text === 'string' ? text : undefined)
    })
    client.on('stream:error', (error) => {
      if (error.text?.startsWith(LOCAL_NEGOTIATION_FAILURE) === true) return
      this.onStreamError(error.condition, error.text)
    })
    client.on('session:bound', () => {
      // A new session after a drop: StanzaJS would rejoin every room it saw at session:started.
      // The interface leaves rejoining to the domain layer (PLY-2), so forget them first.
      if (this.phase === 'reconnecting') {
        client.joinedRooms.clear()
        client.joiningRooms.clear()
      }
    })
    client.on('stream:management:resumed', () => {
      if (this.phase === 'reconnecting') this.recovered('resumed')
    })
    client.on('session:started', () => {
      if (this.phase === 'reconnecting') void this.afterNewSession()
    })
    client.on('disconnected', () => {
      this.onSocketClosed()
    })
  }

  /** PLY-50: a terminal stream error ends the session when the socket closes. */
  private onStreamError(condition: string, text: string | undefined): void {
    const reason = this.settings.adapter.endReason(condition)
    if (reason === undefined) return
    this.pendingEnd ??= { reason, ...(text === undefined ? {} : { text }) }
  }

  private start(): Promise<Result<undefined, TransportError>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.settleConnect = undefined
        resolve(err('timeout', `no session from ${this.options.endpoint.websocketUrl}`))
        this.finish({ reason: 'unreachable' })
        this.client.disconnect()
      }, this.settings.timeoutMs)
      this.settleConnect = (result) => {
        clearTimeout(timer)
        this.settleConnect = undefined
        resolve(result)
      }
      this.client.once('session:started', () => {
        void this.ready().then(() => this.settleConnect?.(ok(undefined)))
      })
      this.client.connect()
    })
  }

  /**
   * Ready means `<enabled/>` has arrived, not merely `session:started`, which StanzaJS emits at
   * resource binding, before stream management is negotiated (WP 0.3). Then initial presence,
   * without which the server does not deliver PubSub events addressed to the bare JID (spike S6).
   */
  private async ready(): Promise<void> {
    const deadline = Date.now() + this.settings.smWaitMs
    while (!this.client.sm.started && Date.now() < deadline && this.client.transport) {
      await sleep(10)
    }
    this.client.sendPresence()
    if (this.settings.keepAliveSeconds > 0) {
      this.client.enableKeepAlive({ interval: this.settings.keepAliveSeconds })
    }
  }

  /** XEP-0030: the MUC and PubSub services among the server's items (ARC-2). */
  private async discover(): Promise<Result<Services, TransportError>> {
    const domain = this.options.endpoint.domain
    const found = await this.run(async () => {
      const items = await this.client.getDiscoItems(domain)
      let muc: string | undefined
      let pubsub: string | undefined
      for (const item of items.items) {
        if (item.jid === undefined || item.node !== undefined) continue
        const info = await this.client.getDiscoInfo(item.jid)
        for (const identity of info.identities) {
          if (identity.category === 'conference' && identity.type === 'text') muc ??= item.jid
          if (identity.category === 'pubsub' && identity.type === 'service') pubsub ??= item.jid
        }
      }
      if (muc === undefined || pubsub === undefined) {
        throw new Refusal({
          condition: 'service-unavailable',
          text: `${domain} lacks MUC or PubSub`,
        })
      }
      return { muc, pubsub }
    })
    return found
  }

  private onSocketClosed(): void {
    if (this.phase === 'ended') return
    if (this.settleConnect !== undefined) {
      // The first connection failed before the session was ready.
      const end = this.pendingEnd
      const result: Result<undefined, TransportError> =
        end?.reason === 'auth-failed'
          ? err('not-authorized', 'authentication failed', 'auth')
          : end !== undefined
            ? err(end.reason === 'account-removed' ? 'conflict' : 'policy-violation', end.text)
            : err('disconnected', `could not connect to ${this.options.endpoint.websocketUrl}`)
      this.settleConnect(result)
      this.finish(end ?? { reason: 'unreachable' })
      return
    }
    if (this.pendingEnd !== undefined) {
      this.finish(this.pendingEnd)
      return
    }
    if (this.disconnecting !== undefined) return
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    this.phase = 'reconnecting'
    this.attempt += 1
    if (this.attempt > this.settings.backoff.maxAttempts) {
      this.finish({ reason: 'unreachable', text: `gave up after ${this.attempt - 1} attempts` })
      return
    }
    this.setStatus({ state: 'reconnecting', attempt: this.attempt })
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = undefined
        if (this.phase === 'reconnecting') this.client.connect()
      },
      backoffDelay(this.attempt, this.settings.backoff),
    )
  }

  /** Resumption failed and the server bound a new session: rooms are gone (PLY-2). */
  private async afterNewSession(): Promise<void> {
    await this.ready()
    this.muc.reset()
    this.recovered('reconnected')
  }

  private recovered(recovery: Recovery): void {
    this.attempt = 0
    this.phase = 'online'
    this.setStatus({ state: 'online' })
    this.recoveryListeners.emit('recovery', recovery)
  }

  private setStatus(status: ConnectionStatus): void {
    this.current = status
    this.statusListeners.emit('status', status)
  }

  private finish(end: { reason: EndReason; text?: string }): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    clearTimeout(this.reconnectTimer)
    this.client.disableKeepAlive()
    this.muc.reset()
    for (const cancel of [...this.inflight]) cancel()
    this.setStatus({
      state: 'ended',
      reason: end.reason,
      ...(end.text === undefined ? {} : { text: end.text }),
    })
  }

  private async logout(): Promise<void> {
    if (this.phase === 'ended') return
    clearTimeout(this.reconnectTimer)
    if (this.phase === 'online' && this.client.transport !== undefined) {
      // XEP-0045 §7.14: leave the rooms before the stream closes (PLY-3).
      await Promise.all(this.muc.joinedRooms().map((room) => this.muc.leave(room)))
      const closed = new Promise<void>((resolve) => {
        this.client.once('disconnected', () => {
          resolve()
        })
      })
      this.client.disconnect()
      await Promise.race([closed, sleep(this.settings.timeoutMs)])
    } else {
      this.client.disconnect()
    }
    this.finish({ reason: 'logout' })
  }

  /** See Core.run. */
  private async run<T>(operation: () => Promise<T>): Outcome<T> {
    if (this.phase === 'ended') return err('disconnected', 'the session has ended')
    let cancel = (): void => undefined
    const cancelled = new Promise<Result<never, TransportError>>((resolve) => {
      cancel = () => {
        resolve(err('disconnected', 'the session ended'))
      }
    })
    this.inflight.add(cancel)
    try {
      return await Promise.race([operation().then((value) => ok(value)), cancelled])
    } catch (reason) {
      if (reason instanceof Refusal) return { ok: false, error: reason.error }
      const error = this.settings.adapter.stanzaError(reason)
      if (error !== undefined) return { ok: false, error }
      throw reason
    } finally {
      this.inflight.delete(cancel)
    }
  }
}
