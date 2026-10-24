// R15 / PLY-53: the largest room message the WebSocket listener accepts, and what happens just over it.
//   reference  c2s max_stanza_size 262144 (the reference deployment's value)
//   wscap      c2s max_stanza_size 65536 (ejabberd_http_ws copies the c2s limits into WS sessions)
//   httpcap    max_stanza_size on the ejabberd_http listener itself: ejabberd refuses the config
// Every probe is ONE room message from a fresh sender connection (so the per-connection shaper starts
// with a full burst), and the receiver is a second member in the room. Probes:
//   1. just over each configured max_stanza_size (stanza bytes = cap + 1), player sender;
//   2. 2 MiB, player sender (shaper "player": 50 kB/s after a 300 kB burst), raw and via StanzaJS;
//   3. a size search with the unshaped admin: doubling from 2 MiB to at most 64 MiB, then bisection
//      between the last delivered and first refused size, if any size is refused.

import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, COMPOSE_DIR, IMAGE, type Target } from '../src/config.js'
import { probeConfig, serverLog } from '../src/docker.js'
import { adminLogin, createAccount, makeRoom, type Account } from '../src/fixture.js'
import {
  connect,
  disconnect,
  disconnectAll,
  observe,
  saveStanzas,
  sendRaw,
  uniq,
  type Client,
} from '../src/harness.js'

const KiB = 1024
const MiB = 1024 * KiB
const CONFIGURED: Record<'reference' | 'wscap', number> = { reference: 262_144, wscap: 65_536 }

type Who = 'player' | 'admin'
type Via = 'raw' | 'stanzajs'

interface Probe {
  target: Target
  who: Who
  via: Via
  bodyBytes: number
  stanzaBytes: number
  outcome: 'delivered' | 'error' | 'closed' | 'silent'
  /** Error stanza or stream error condition/text, if the server sent one. */
  condition?: string
  text?: string
  closeCode?: number
  ms: number
}

const fixtures: Partial<Record<Target, { room: string; sender: Account; receiver: Client }>> = {}

async function setup(target: Target) {
  const a = await adminLogin(target, 'r15')
  const t = uniq('r15')
  const sender = await createAccount(a, target, `${t}-sender`)
  const receiver = await createAccount(a, target, `${t}-receiver`)
  const room = await makeRoom(
    a,
    target,
    t,
    {},
    { [sender.jid]: 'member', [receiver.jid]: 'member' },
  )
  await disconnect(a)
  const r = await connect(target, receiver.user, receiver.password, { resource: uniq('rcv') })
  await r.joinRoom(room, receiver.user)
  fixtures[target] = { room, sender, receiver: r }
}

const stanzaFor = (room: string, id: string, bodyBytes: number) =>
  `<message xmlns="jabber:client" to="${room}" type="groupchat" id="${id}"><body>${'x'.repeat(bodyBytes)}</body></message>`
const OVERHEAD = (room: string) => Buffer.byteLength(stanzaFor(room, 'big-xxxxxxxx-xxxx', 0))

/** Send one room message with a `bodyBytes` ASCII body from a fresh connection; record what happens. */
async function probe(
  target: Target,
  who: Who,
  bodyBytes: number,
  via: Via = 'raw',
  lines?: string[],
): Promise<Probe> {
  const fx = fixtures[target]!
  const user = who === 'admin' ? 'admin' : fx.sender.user
  const s = await connect(target, user, who === 'admin' ? ADMIN_PASSWORD : fx.sender.password, {
    resource: uniq(`r15-${who}`),
  })
  await s.joinRoom(fx.room, `${user}-${uniq('n')}`)
  const id = uniq('big')
  const xml = stanzaFor(fx.room, id, bodyBytes)
  const stanzaBytes = Buffer.byteLength(xml)
  const small: string[] = []
  const onIn = (raw: string) =>
    small.push(
      raw.length < 4_096
        ? `<!-- in sender -->\n${raw}`
        : `<!-- in sender: ${raw.length} chars, first 300 -->\n${raw.slice(0, 300)}…`,
    )
  s.on('raw:incoming', onIn)
  const onRcvRaw = (raw: string) => {
    if (raw.includes(id))
      small.push(`<!-- in receiver: ${raw.length} chars, first 300 -->\n${raw.slice(0, 300)}…`)
  }
  fx.receiver.on('raw:incoming', onRcvRaw)
  const ws = (
    s.transport as unknown as {
      socket?: {
        addEventListener(t: string, f: (e: { code: number; reason: string }) => void): void
      }
    }
  ).socket
  const started = Date.now()
  // Player: shaped at 50 kB/s after the burst. Admin: unshaped; allow ~1 s per MiB plus margin.
  const timeout =
    who === 'player'
      ? 15_000 + Math.ceil(stanzaBytes / 40_000) * 1_000
      : 30_000 + Math.ceil(stanzaBytes / MiB) * 1_000
  type R = Omit<Probe, 'target' | 'who' | 'via' | 'bodyBytes' | 'stanzaBytes' | 'ms'>
  const onRcv = (m: { id?: string }) => m.id === id && done({ outcome: 'delivered' })
  let done: (r: R) => void = () => undefined
  const result = await new Promise<R>((resolve) => {
    const timer = setTimeout(() => resolve({ outcome: 'silent' }), timeout)
    done = (r) => {
      clearTimeout(timer)
      resolve(r)
    }
    fx.receiver.on('message', onRcv)
    s.on('message', (m) => {
      if (m.id === id && m.type === 'error')
        done({
          outcome: 'error',
          ...(m.error?.condition ? { condition: m.error.condition } : {}),
          ...(m.error?.text ? { text: m.error.text } : {}),
        })
    })
    s.on('stream:error', (e) =>
      done({
        outcome: 'closed',
        condition: `stream:${e.condition}`,
        ...(e.text ? { text: e.text } : {}),
      }),
    )
    ws?.addEventListener('close', (e) =>
      done({ outcome: 'closed', closeCode: e.code, ...(e.reason ? { text: e.reason } : {}) }),
    )
    if (via === 'raw') sendRaw(s, xml)
    else s.sendMessage({ to: fx.room, type: 'groupchat', id, body: 'x'.repeat(bodyBytes) })
  })
  fx.receiver.off('message', onRcv)
  fx.receiver.off('raw:incoming', onRcvRaw)
  s.off('raw:incoming', onIn)
  const p: Probe = { target, who, via, bodyBytes, stanzaBytes, ...result, ms: Date.now() - started }
  lines?.push(
    `<!-- probe ${JSON.stringify(p)} -->`,
    `<!-- out sender: ${stanzaBytes} bytes, first 200 -->\n${xml.slice(0, 200)}…`,
    ...small,
  )
  await disconnect(s)
  return p
}

/** Doubling search from `start` up to `max`, then bisection to within 1/32 if a size was refused. */
async function search(target: Target, who: Who, start: number, max: number) {
  const probes: Probe[] = []
  let lo = 0
  let hi: number | undefined
  let overLines: string[] = []
  let largestLines: string[] = []
  for (let size = start; size <= max; size *= 2) {
    const lines: string[] = []
    const p = await probe(target, who, size, 'raw', lines)
    probes.push(p)
    if (p.outcome === 'delivered') {
      lo = size
      largestLines = lines
    } else {
      hi = size
      overLines = lines
      break
    }
  }
  while (hi !== undefined && hi - lo > Math.max(64 * KiB, hi / 32)) {
    const mid = Math.round((lo + hi) / 2 / KiB) * KiB
    const lines: string[] = []
    const p = await probe(target, who, mid, 'raw', lines)
    probes.push(p)
    if (p.outcome === 'delivered') lo = mid
    else {
      hi = mid
      overLines = lines
    }
  }
  if (hi === undefined) await saveStanzas(`r15-${target}-${who}-largest-delivered`, largestLines)
  else {
    const log = (await serverLog(target, new Date(Date.now() - 120_000).toISOString()))
      .split('\n')
      .filter((l) => /error|warning|Closing c2s/i.test(l))
      .slice(-10)
    await saveStanzas(`r15-${target}-${who}-just-over`, [
      ...overLines,
      `<!-- server log -->\n${log.join('\n')}`,
    ])
  }
  return {
    probes,
    largestDeliveredBody: lo,
    ...(hi !== undefined ? { smallestRefusedBody: hi } : {}),
  }
}

beforeAll(async () => {
  await setup('reference')
  await setup('wscap')
}, 120_000)

afterAll(disconnectAll)

describe('R15 WebSocket room-message size limit', () => {
  for (const target of ['reference', 'wscap'] as const) {
    it(`${target}: a stanza 1 byte over c2s max_stanza_size (${CONFIGURED[target]}) is delivered`, async () => {
      const body = CONFIGURED[target] + 1 - OVERHEAD(fixtures[target]!.room)
      const lines: string[] = []
      const p = await probe(target, 'player', body, 'raw', lines)
      await saveStanzas(`r15-${target}-cap-plus-1`, lines)
      await observe('r15', `${target}: cap + 1`, p)
      expect(p).toMatchObject({ stanzaBytes: CONFIGURED[target] + 1, outcome: 'delivered' })
    }, 120_000)

    it(`${target}: a 2 MiB room message from a shaped player is delivered (raw and via StanzaJS)`, async () => {
      const raw = await probe(target, 'player', 2 * MiB, 'raw')
      const sj = await probe(target, 'player', 2 * MiB, 'stanzajs')
      await observe('r15', `${target}: 2 MiB player`, { raw, stanzajs: sj })
      expect(raw.outcome).toBe('delivered')
      expect(sj.outcome).toBe('delivered')
    }, 300_000)

    it(`${target}: size search with the unshaped admin, 2 MiB doubling to 64 MiB`, async () => {
      const s = await search(target, 'admin', 2 * MiB, 64 * MiB)
      await observe('r15', `${target}: admin search`, s)
      expect(s.probes.length).toBeGreaterThan(0)
    }, 900_000)
  }

  it('max_stanza_size on the ejabberd_http (WebSocket) listener itself: ejabberd refuses to start', async () => {
    const r = await probeConfig(IMAGE, join(COMPOSE_DIR, 'ejabberd-httpcap.yml'))
    const critical = r.log.split('\n').filter((l) => /\[critical\]/.test(l))
    await observe('r15', 'httpcap config', { started: r.started, critical })
    expect(r.started).toBe(false)
    expect(critical.join('\n')).toMatch(/Unknown option: max_stanza_size/)
  }, 120_000)
})
