// Backup and restore of the reference deployment (WP 3.3), in two steps around ops/backup.sh and
// ops/restore.sh, which ops/test/backup-restore.sh runs in order:
//
//   WRX_RESTORE_STEP=seed   publish the sample game with a vault, post messages, and write a
//                           fingerprint of the server to WRX_RESTORE_STATE;
//   (back up, wipe the server, reinstall, restore)
//   WRX_RESTORE_STEP=verify unlock the vault with the same passphrase (it lives in the admin's
//                           private storage), audit the server against the game (clean), and
//                           compare the fingerprint: accounts, rooms, archived messages, nodes
//                           and items, the same as before.
//
// Run with `pnpm test:restore:ejabberd`, against a server it may reset (one game per server, D11).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { sampleDesignWithWhiteCell, tid } from '@wrx/schemas/fixtures'
import type { Session } from '@wrx/transport'
import { XmppTransport } from '@wrx/transport-xmpp'
import { describe, expect, it } from 'vitest'
import {
  AdminOps,
  CredentialsBook,
  ObserverVault,
  VAULT_KDF,
  VAULT_STORAGE_KEY,
  executePlan,
  findings,
  planConfirmations,
  prepareReset,
  preparePublish,
  runAudit,
} from '../src/index.ts'

const step = process.env.WRX_RESTORE_STEP
const stateFile = process.env.WRX_RESTORE_STATE ?? ''
const passphrase = process.env.WRX_RESTORE_PASSPHRASE ?? 'restore check passphrase'
const transport = new XmppTransport({ timeoutMs: 20_000 })
const endpoint = {
  websocketUrl: process.env.WRX_XMPP_WS ?? 'wss://localhost:35443/ws',
  domain: process.env.WRX_XMPP_DOMAIN ?? 'localhost',
}
/** Set by deploy/ejabberd/bootstrap.sh for a throwaway local container; not a product secret. */
const adminPassword = process.env.WRX_ADMIN_PASSWORD ?? 'spike-password'
const design = sampleDesignWithWhiteCell()
const MESSAGES = 25

function must<T>(
  result:
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown },
  what: string,
): T {
  if (result.ok) return result.value
  throw new Error(`${what}: ${JSON.stringify(result.error)}`)
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

interface Fingerprint {
  readonly accounts: readonly string[]
  readonly rooms: Readonly<Record<string, number>>
  readonly nodes: Readonly<Record<string, readonly string[]>>
}

/** What the server holds, in a form two reads can be compared by. */
async function fingerprint(ops: AdminOps): Promise<Fingerprint> {
  const session = ops.session
  const accounts = [...must(await session.admin.registeredUsers(), 'accounts')].sort()
  const rooms: Record<string, number> = {}
  const suffix = `@${session.services.muc}`
  for (const jid of [...must(await session.muc.listRooms(), 'rooms')].sort()) {
    const roomId = jid.slice(0, -suffix.length)
    const count = await ops.roomMessageCount(roomId)
    if (!count.ok) throw new Error(`count ${roomId}: ${count.error.message}`)
    rooms[roomId] = count.value
  }
  const nodes: Record<string, string[]> = {}
  for (const node of [...must(await session.pubsub.listNodes(), 'nodes')].sort()) {
    const items = must(await session.pubsub.getItems(node), `items of ${node}`)
    nodes[node] = items.map((i) => `${i.id}:${sha(i.payload)}`).sort()
  }
  return { accounts, rooms, nodes }
}

async function adminOps(): Promise<AdminOps> {
  const admin: Session = must(
    await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'admin', password: adminPassword },
    }),
    'admin login',
  )
  return new AdminOps({ session: admin, login: { transport, endpoint } })
}

describe.runIf(step === 'seed')('restore check, step 1: seed', () => {
  it('publishes the game, posts messages and writes the fingerprint', async () => {
    const ops = await adminOps()
    const book = new CredentialsBook('random')
    try {
      must(await ops.session.admin.setPrivate(VAULT_STORAGE_KEY, ''), 'clear vault')
      const reset = must(await prepareReset(ops), 'plan reset')
      await executePlan(ops, reset.plan, {
        passwordFor: (id) => book.passwordFor(id),
        confirmed: planConfirmations(reset.plan),
      })
      const vault = must(
        await ObserverVault.create(ops.session.admin, passphrase, {
          iterations: VAULT_KDF.minIterations,
        }),
        'create vault',
      )
      ops.useVault(vault)
      const prepared = must(await preparePublish(ops, design, { vault }), 'plan')
      const published = await executePlan(ops, prepared.plan, {
        passwordFor: (id) => book.passwordFor(id),
        confirmed: planConfirmations(prepared.plan),
      })
      if (!published.ok) throw new Error(`publish: ${published.failed?.error.message ?? ''}`)
      const password = book.get('blue-co')?.password ?? ''
      const blue = must(
        await transport.connect({
          endpoint,
          credentials: { kind: 'password', username: 'blue-co', password },
        }),
        'blue-co login',
      )
      const room = ops.roomJid(tid('blue-hq'))
      must(await blue.muc.join(room, 'blue-co'), 'join')
      for (let i = 0; i < MESSAGES; i++) {
        must(
          await blue.muc.send(room, JSON.stringify({ text: `before backup ${String(i)}` })),
          'send',
        )
      }
      await blue.disconnect()
      const print = await fingerprint(ops)
      expect(print.rooms[tid('blue-hq')]).toBeGreaterThanOrEqual(MESSAGES)
      writeFileSync(stateFile, JSON.stringify(print, null, 2))
    } finally {
      await ops.session.disconnect()
    }
  }, 300_000)
})

describe.runIf(step === 'verify')('restore check, step 2: verify', () => {
  it('unlocks the vault, audits clean and matches the fingerprint', async () => {
    const before: unknown = JSON.parse(readFileSync(stateFile, 'utf8'))
    const ops = await adminOps()
    try {
      const vault = must(await ObserverVault.unlock(ops.session.admin, passphrase), 'unlock vault')
      expect(vault.roles().length).toBeGreaterThan(0)
      ops.useVault(vault)
      const report = must(await runAudit(ops, design, { vault }), 'audit').report
      expect(findings(report).map((i) => `${i.id} [${i.found}]`)).toEqual([])
      expect(await fingerprint(ops)).toEqual(before)
    } finally {
      await ops.session.disconnect()
    }
  }, 300_000)
})
