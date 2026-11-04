// S16: does an ejabberd byte-rate shaper throttle a client that sends large stanzas over the
// WebSocket listener? Each probe is one groupchat message of an exact size (bytes of UTF-8 in the
// serialised stanza), sent raw from a fresh connection, so its shaper bucket starts full, into a
// members-only room set up as a game room, with a second member as the receiver. Times are from
// handing the stanza to the socket to the sender's own reflected copy, and to the receiver's copy.
//
// A shaper limits the rate at which ejabberd reads from the connection; it never refuses a
// stanza. The pass criterion is therefore a throttle that follows the configured rate.
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Session } from '../../../../packages/transport/src/index.ts'
import { CLOSED_SIDE_CHANNELS } from '../../../../packages/transport/src/index.ts'
import { must } from '../../../../packages/contract-suite/src/harness.ts'
import { Transcript } from '../../../s14/src/pubsub.ts'
import { CONFIGS, type ConfigName } from '../config.ts'
import { saveStanzas, type Ctx } from '../context.ts'

export interface Probe {
  readonly sender: 'player' | 'admin'
  readonly bytes: number
  readonly reflectedMs: number
  readonly receivedMs: number
  /** A ping sent right after the message: how long it waited behind it. */
  readonly pingAfterMs: number
  readonly connectionUp: boolean
  /** (bytes - burst) / time, for a shaped sender past its burst. */
  readonly rateBytesPerSecond?: number
  /** What the configured shaper predicts: max(0, bytes - burst) / rate, in ms. */
  readonly predictedMs?: number
}

/** A groupchat message whose serialised stanza is exactly `bytes` bytes of UTF-8. */
export function message(room: string, id: string, bytes: number): string {
  const head = `<message xmlns='jabber:client' to='${room}' type='groupchat' id='${id}'><body>S16:${id}:`
  const tail = `</body></message>`
  const pad = bytes - Buffer.byteLength(head + tail, 'utf8')
  if (pad < 0) throw new Error(`${bytes} bytes is too small`)
  return head + 'x'.repeat(pad) + tail
}

/** Resolves with the time when `session` receives a stanza containing `marker`. */
function arrival(ctx: Ctx, session: Session, marker: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`${marker} not received in ${timeoutMs} ms`))
    }, timeoutMs)
    const off = ctx.raw.onIncoming(session, (xml) => {
      if (!xml.startsWith('<message') || !xml.includes(marker)) return
      clearTimeout(timer)
      off()
      resolve(performance.now())
    })
  })
}

/** A ping (XEP-0199) to the server; resolves when the reply arrives. */
function ping(ctx: Ctx, session: Session, id: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`no ping reply ${id}`))
    }, 300_000)
    const off = ctx.raw.onIncoming(session, (xml) => {
      if (!xml.startsWith('<iq') || !xml.includes(`id='${id}'`) && !xml.includes(`id="${id}"`)) return
      clearTimeout(timer)
      off()
      resolve(performance.now())
    })
    ctx.raw.send(session, `<iq xmlns='jabber:client' type='get' to='${ctx.backend.domain}' id='${id}'><ping xmlns='urn:xmpp:ping'/></iq>`)
  })
}

/** The least share of the predicted time a shaped send must take, past 5 s predicted. */
const SLACK = 0.6

export function s16(ctx: Ctx, cfg: ConfigName): void {
  const shaper = CONFIGS[cfg].player
  const sizes =
    cfg === 'tight'
      ? { player: [65_536, 150_000, 300_000, 600_000], admin: [500_000] }
      : { player: [65_536, 300_000, 500_000, 1_000_000, 2_000_000], admin: [500_000, 2_000_000] }

  /** A fresh members-only room with the player and the reader as members, and the reader in it. */
  async function room(label: string): Promise<{ jid: string; reader: Session }> {
    const admin = ctx.admin()
    const jid = `${ctx.name(label)}@${admin.services.muc}`
    must(
      await admin.muc.createRoom(jid, {
        name: label,
        membersOnly: true,
        moderated: true,
        persistent: true,
        public: false,
        whois: 'anyone',
        archive: true,
        ...CLOSED_SIDE_CHANNELS,
      }),
      'create room',
    )
    must(
      await admin.muc.setAffiliations(jid, [
        { jid: ctx.jid('player'), affiliation: 'member' },
        { jid: ctx.jid('reader'), affiliation: 'member' },
      ]),
      'members',
    )
    const reader = await ctx.login('reader')
    must(await reader.muc.join(jid, 'reader'), 'reader joins')
    return { jid, reader }
  }

  async function probe(sender: 'player' | 'admin', bytes: number, t: Transcript): Promise<Probe> {
    const r = await room(`${sender}-${bytes}`)
    const session = sender === 'admin' ? await ctx.adminLogin() : await ctx.login('player')
    must(await session.muc.join(r.jid, sender), `${sender} joins`)
    const id = `s16-${bytes}-${randomBytes(4).toString('hex')}`
    const stanza = message(r.jid, id, bytes)
    const reflected = arrival(ctx, session, `S16:${id}:`, 300_000)
    const received = arrival(ctx, r.reader, `S16:${id}:`, 300_000)
    const start = performance.now()
    ctx.raw.send(session, stanza)
    const pinged = ping(ctx, session, `${id}-ping`)
    const [refAt, recAt, pingAt] = await Promise.all([reflected, received, pinged])
    const reflectedMs = Math.round(refAt - start)
    const pastBurst = Math.max(0, bytes - shaper.burst)
    const shaped = sender === 'player'
    const result: Probe = {
      sender,
      bytes,
      reflectedMs,
      receivedMs: Math.round(recAt - start),
      pingAfterMs: Math.round(pingAt - start),
      connectionUp: session.status().state === 'online',
      ...(shaped && pastBurst > 0 ? { rateBytesPerSecond: Math.round(pastBurst / (reflectedMs / 1000)) } : {}),
      ...(shaped ? { predictedMs: Math.round((pastBurst / shaper.rate) * 1000) } : {}),
    }
    t.note(`${sender} sends ${bytes} bytes: ${JSON.stringify(result)}`)
    t.lines.push(stanza.length > 600 ? `${stanza.slice(0, 300)}…${stanza.slice(-40)}` : stanza)
    await dispose(r.jid, [session, r.reader])
    return result
  }

  /**
   * Ends the sessions, then destroys the room. In the other order each session's disconnect waits
   * about a minute to leave a room that no longer exists.
   */
  async function dispose(jid: string, sessions: readonly Session[]): Promise<void> {
    await Promise.all(sessions.map((s) => s.disconnect()))
    must(await ctx.admin().muc.destroyRoom(jid), 'destroy room')
  }

  describe(`S16 byte shaping over WebSocket (${cfg}: player ${shaper.rate} B/s, burst ${shaper.burst} B)`, () => {
    it('S16-1 a shaped player sends single large messages', async () => {
      const t = new Transcript()
      const probes: Probe[] = []
      for (const bytes of sizes.player) probes.push(await probe('player', bytes, t))
      saveStanzas('s16-1-player', t)
      for (const p of probes) ctx.observe('S16-1', `player, ${p.bytes} bytes`, { ...p })
      for (const p of probes) {
        expect(p.connectionUp).toBe(true)
        // Throttled near the configured rate once well past the burst. ejabberd's shaper averages the
        // rate over reads rather than keeping an exact token bucket, so a shaped sender runs somewhat
        // ahead of (bytes - burst) / rate at first (S16-1 under `tight`); hence the slack.
        if ((p.predictedMs ?? 0) > 5_000) expect(p.reflectedMs).toBeGreaterThan(SLACK * (p.predictedMs ?? 0))
      }
      const last = probes[probes.length - 1]
      ctx.observe('S16-1', 'summary', {
        pass: probes.every((p) => (p.predictedMs ?? 0) <= 5_000 || p.reflectedMs > SLACK * (p.predictedMs ?? 0)),
        largest: last?.bytes,
        largestMs: last?.reflectedMs,
        rates: probes.filter((p) => p.rateBytesPerSecond !== undefined).map((p) => p.rateBytesPerSecond),
      })
    })

    it('S16-2 the admin (no shaper) sends the same', async () => {
      const t = new Transcript()
      const probes: Probe[] = []
      for (const bytes of sizes.admin) probes.push(await probe('admin', bytes, t))
      saveStanzas('s16-2-admin', t)
      for (const p of probes) ctx.observe('S16-2', `admin, ${p.bytes} bytes`, { ...p })
      for (const p of probes) expect(p.reflectedMs).toBeLessThan(5_000)
    })

    if (cfg === 'ref')
      it('S16-3 two sessions of one player at once: per connection or per account', async () => {
        const r = await room('parallel')
        const one = await ctx.login('player')
        const two = await ctx.login('player')
        must(await one.muc.join(r.jid, 'player'), 'one joins')
        must(await two.muc.join(r.jid, 'player'), 'two joins')
        const bytes = 1_000_000
        const ids = ['p1', 'p2'].map((p) => `s16-${p}-${randomBytes(4).toString('hex')}`)
        const sessions = [one, two]
        const arrivals = ids.map((id, i) => arrival(ctx, sessions[i] as Session, `S16:${id}:`, 300_000))
        const start = performance.now()
        ids.forEach((id, i) => ctx.raw.send(sessions[i] as Session, message(r.jid, id, bytes)))
        const times = (await Promise.all(arrivals)).map((at) => Math.round(at - start))
        const predictedOneMs = Math.round(((bytes - shaper.burst) / shaper.rate) * 1000)
        ctx.observe('S16-3', 'two sessions of one player, 1 MB each at once', {
          times,
          predictedPerConnectionMs: predictedOneMs,
          predictedPerAccountMs: Math.round(((2 * bytes - shaper.burst) / shaper.rate) * 1000),
          perConnection: Math.max(...times) < 1.5 * predictedOneMs,
          aggregateBytesPerSecond: Math.round((2 * bytes - 2 * shaper.burst) / (Math.max(...times) / 1000)),
        })
        await dispose(r.jid, [one, two, r.reader])
        expect(Math.max(...times)).toBeLessThan(1.5 * predictedOneMs)
      })
  })
}
