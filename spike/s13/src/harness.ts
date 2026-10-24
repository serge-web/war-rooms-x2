// Connection and multi-client helpers. Adapted from serge-web/xmpp-spike spike/tests/harness.ts
// (commit 4992530): connect, disconnectAll, captureStanzas, sendRaw, waitFor, collect and outcome are
// the spike's, with the server chosen per call. Added for S13: a login ledger (to prove which
// accounts logged in, and when), rawRequest for stanzas StanzaJS doesn't model (MUC/Sub, raw MUC
// admin items), and stanza files under spike/s13/stanzas/.

import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as XMPP from 'stanza'
import { S13_ROOT, servers, type Target } from './config.js'

export type Client = XMPP.Agent

export interface ConnectOptions {
  resource?: string
  /** Use SASL ANONYMOUS instead of a named account. */
  anonymous?: boolean
  timeoutMs?: number
  /** Send initial presence after session start, as the browser client will (default true). */
  presence?: boolean
  /** Called before connecting, e.g. to attach captureStanzas so the login is recorded. */
  onCreate?: (client: Client) => void
}

export interface LoginRecord {
  target: Target
  user: string
  at: string
}

/** Every login made through connect(), in order. Tests assert on it to prove who logged in. */
export const loginLedger: LoginRecord[] = []

const live = new Set<Client>()

/** Connect over WebSocket and wait for session start. Rejects (never skips) if the server is unreachable. */
export async function connect(
  target: Target,
  user: string,
  password: string | undefined,
  opts: ConnectOptions = {},
): Promise<Client> {
  const cfg = servers[target]
  const client = XMPP.createClient({
    jid: opts.anonymous ? cfg.domain : `${user}@${cfg.domain}`,
    ...(opts.anonymous ? {} : { password }),
    ...(opts.resource ? { resource: opts.resource } : {}),
    transports: { websocket: cfg.websocketUrl, bosh: false },
    allowResumption: false,
  } as XMPP.AgentConfig)
  live.add(client)
  if (opts.anonymous) {
    // StanzaJS ranks ANONYMOUS lowest; disable the rest so the anonymous path is actually exercised.
    for (const m of [
      'EXTERNAL',
      'SCRAM-SHA-256-PLUS',
      'SCRAM-SHA-256',
      'SCRAM-SHA-1-PLUS',
      'SCRAM-SHA-1',
      'DIGEST-MD5',
      'OAUTHBEARER',
      'X-OAUTH2',
      'PLAIN',
    ]) {
      client.sasl.disable(m)
    }
  }
  opts.onCreate?.(client)

  const timeoutMs = opts.timeoutMs ?? 10_000
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${user}@${target}: no session after ${timeoutMs}ms`)),
      timeoutMs,
    )
    client.once('session:started', () => {
      clearTimeout(timer)
      resolve()
    })
    client.once('auth:failed', () => {
      clearTimeout(timer)
      reject(new Error(`${user}@${target}: authentication failed`))
    })
    client.once('disconnected', () => {
      clearTimeout(timer)
      reject(new Error(`${user}@${target}: disconnected before session start`))
    })
    client.connect()
  })
  loginLedger.push({
    target,
    user: opts.anonymous ? `(anonymous) ${String(client.jid)}` : user,
    at: new Date().toISOString(),
  })
  if (opts.presence !== false) client.sendPresence()
  return client
}

/** Disconnect one client and wait for the socket to close. */
export function disconnect(c: Client): Promise<void> {
  live.delete(c)
  return new Promise<void>((resolve) => {
    if (!c.sessionStarted) {
      c.disconnect()
      return resolve()
    }
    const t = setTimeout(resolve, 3_000)
    c.once('disconnected', () => {
      clearTimeout(t)
      resolve()
    })
    c.disconnect()
  })
}

/** Disconnect every client opened via connect(). Call from afterEach/afterAll. */
export async function disconnectAll(): Promise<void> {
  await Promise.all([...live].map((c) => disconnect(c)))
  live.clear()
}

/** Record raw XML in both directions so a check can save representative stanzas. */
export function captureStanzas(client: Client, label = ''): { lines: string[]; stop: () => void } {
  const lines: string[] = []
  const tag = label ? ` ${label}` : ''
  const onIn = (xml: string) => lines.push(`<!-- in${tag} -->\n${xml}`)
  const onOut = (xml: string) => lines.push(`<!-- out${tag} -->\n${xml}`)
  client.on('raw:incoming', onIn)
  client.on('raw:outgoing', onOut)
  return {
    lines,
    stop: () => {
      client.off('raw:incoming', onIn)
      client.off('raw:outgoing', onOut)
    },
  }
}

/** Elide long base64/body runs so saved stanzas stay readable. */
const elide = (s: string) =>
  s
    // SASL exchanges carry SCRAM proofs; they show nothing S13 needs, so drop their payloads.
    .replace(
      /<(auth|challenge|response|success)\b([^>]*)>[^<]*<\/\1>/g,
      (_m, el: string, attrs: string) => `<${el}${attrs}>[sasl payload removed]</${el}>`,
    )
    .replace(
      /([A-Za-z0-9+/=]{200})[A-Za-z0-9+/=]{200,}/g,
      (_m, head: string) => `${head.slice(0, 40)}…[elided]`,
    )

/** Write captured stanzas to spike/s13/stanzas/<name>.xml. */
export async function saveStanzas(name: string, lines: string[]): Promise<void> {
  const dir = join(S13_ROOT, 'stanzas')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.xml`), lines.map(elide).join('\n\n') + '\n')
}

/** Send raw XML on the WebSocket, bypassing StanzaJS serialisation and any client-side checks. */
export function sendRaw(client: Client, xml: string): void {
  const socket = (client.transport as unknown as { socket?: { send(data: string): void } }).socket
  if (!socket) throw new Error('no WebSocket transport')
  socket.send(xml)
}

/**
 * Send a raw stanza with id=`id` and resolve with the raw XML of the server's reply (the first
 * incoming frame carrying that id), or reject after `ms`. For stanzas StanzaJS does not model.
 */
export function rawRequest(client: Client, xml: string, id: string, ms = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const re = new RegExp(`\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`)
    const onIn = (raw: string) => {
      if (!re.test(raw)) return
      clearTimeout(timer)
      client.off('raw:incoming', onIn)
      resolve(raw)
    }
    const timer = setTimeout(() => {
      client.off('raw:incoming', onIn)
      reject(new Error(`timeout waiting for reply to ${id}`))
    }, ms)
    client.on('raw:incoming', onIn)
    sendRaw(client, xml)
  })
}

/** The defined-condition and text of a raw IQ/message error reply, or 'result'. */
export function rawOutcome(raw: string): { type: string; condition?: string; text?: string } {
  const type = /^<\w+[^>]*\btype=["'](\w+)["']/.exec(raw)?.[1] ?? 'unknown'
  if (type !== 'error') return { type }
  const condition = /<([a-z-]+) xmlns=["']urn:ietf:params:xml:ns:xmpp-stanzas["']\s*\/>/.exec(
    raw,
  )?.[1]
  const text = /<text[^>]*>([^<]*)<\/text>/.exec(raw)?.[1]
  return { type, ...(condition ? { condition } : {}), ...(text ? { text } : {}) }
}

// Loose union: Message and Presence declare `muc` differently, so an intersection collapses to never.
export type AnyStanza = {
  from?: string
  to?: string
  type?: string
  id?: string
  body?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any
}

/** Resolve with the first stanza of `kind` matching `pred`, or reject after `ms`. */
export function waitFor<T = AnyStanza>(
  client: Client,
  kind: 'message' | 'presence' | 'iq' | 'stanza',
  pred: (s: AnyStanza) => boolean,
  ms = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (s: AnyStanza) => {
      if (!pred(s)) return
      clearTimeout(timer)
      client.off(kind as 'message', handler as never)
      resolve(s as T)
    }
    const timer = setTimeout(() => {
      client.off(kind as 'message', handler as never)
      reject(new Error(`timeout waiting for ${kind}`))
    }, ms)
    client.on(kind as 'message', handler as never)
  })
}

/** Collect every stanza of `kind` matching `pred` for `ms`; used to prove that nothing arrives. */
export async function collect(
  client: Client,
  kind: 'message' | 'presence' | 'stanza',
  pred: (s: AnyStanza) => boolean,
  ms = 1_500,
): Promise<AnyStanza[]> {
  const got: AnyStanza[] = []
  const handler = (s: AnyStanza) => {
    if (pred(s)) got.push(s)
  }
  client.on(kind as 'message', handler as never)
  await new Promise((r) => setTimeout(r, ms))
  client.off(kind as 'message', handler as never)
  return got
}

export interface Outcome {
  ok: boolean
  condition?: string
  errorType?: string
  text?: string
  value?: unknown
}

/** Settle an IQ promise into ok / error condition, for asserting server-side denials. */
export async function outcome(p: Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await p }
  } catch (e) {
    const err = (e as { error?: { condition?: string; type?: string; text?: string } }).error
    if (!err) throw e
    return {
      ok: false,
      ...(err.condition ? { condition: err.condition } : {}),
      ...(err.type ? { errorType: err.type } : {}),
      ...(err.text ? { text: err.text } : {}),
    }
  }
}

export const uniq = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export const xmlEscape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')

/** Append {check, key, value} to spike/s13/results/observations.jsonl and echo it. */
export async function observe(check: string, key: string, value: unknown): Promise<void> {
  const dir = join(S13_ROOT, 'results')
  await mkdir(dir, { recursive: true })
  const line = JSON.stringify({ check, key, value, at: new Date().toISOString() })
  await appendFile(join(dir, 'observations.jsonl'), line + '\n')
  console.info(`[${check}] ${key}: ${JSON.stringify(value)}`)
}
