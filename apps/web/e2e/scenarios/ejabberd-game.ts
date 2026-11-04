// The scenarios' starting game on the reference ejabberd: what the mock's demo seed is in the
// browser (D17), made on the real server through the real admin tooling before each scenario.
// The server is reset (ADM-15), the demo design published (ADM-10) with the demo's known
// passwords, and the demo's message history posted by its authors. The vault takes
// SCENARIO_VAULT_PASSPHRASE, not the mock's published demo passphrase: a real server's vault
// must pass the strength check (F12), which only the mock's demo vault skips.
// Known passwords on a throwaway test server are test set-up only: the admin UI on a real server
// always issues random ones (NFR-6), as SC-1 shows.
import {
  AdminOps,
  ObserverVault,
  VAULT_KDF,
  VAULT_STORAGE_KEY,
  executePlan,
  planConfirmations,
  preparePublish,
  prepareReset,
  privateMarkerStore,
} from '@wrx/admin-ops'
import type { PublishPlan } from '@wrx/admin-ops'
import { demoPassword, demoSeed } from '@wrx/mock-server'
import { LIMITS, MAP_ROOM_TYPE } from '@wrx/schemas'
import type { DesignFile } from '@wrx/schemas'
import type { Endpoint, Session } from '@wrx/transport'
import { XmppTransport } from '@wrx/transport-xmpp'
import { existsSync, readFileSync } from 'node:fs'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'

/** The observer vault's passphrase in the scenarios' game on ejabberd; strong enough for F12. */
export const SCENARIO_VAULT_PASSPHRASE = 'northern gate umpire ledger kestrel'

export interface EjabberdServer {
  readonly endpoint: Endpoint
  readonly adminPassword: string
}

let trusted = false

/**
 * Node trusts the stack's test CA, as Chromium pins its key (playwright.config.ts): set here
 * because NODE_EXTRA_CA_CERTS is read only when a process starts.
 */
function trustTestCa(): void {
  if (trusted) return
  trusted = true
  const ca =
    process.env.WRX_XMPP_CA ??
    fileURLToPath(new URL('../../../../deploy/ejabberd/tls-out/ca.crt', import.meta.url))
  if (!existsSync(ca)) return
  setDefaultCACertificates([...getCACertificates('default'), readFileSync(ca, 'utf8')])
}

export function ejabberdServer(): EjabberdServer | undefined {
  const websocketUrl = process.env.WRX_XMPP_WS
  if (websocketUrl === undefined) return undefined
  trustTestCa()
  return {
    endpoint: { websocketUrl, domain: process.env.WRX_XMPP_DOMAIN ?? 'localhost' },
    // Set by deploy/ejabberd/bootstrap.sh for a throwaway local container; not a product secret.
    adminPassword: process.env.WRX_XMPP_ADMIN_PASSWORD ?? 'spike-password',
  }
}

export const nodeTransport = (): XmppTransport =>
  new XmppTransport({ timeoutMs: 15_000, backoff: { initialMs: 200, maxMs: 2_000 } })

async function connect(
  server: EjabberdServer,
  transport: XmppTransport,
  username: string,
  password: string,
): Promise<Session> {
  const login = await transport.connect({
    endpoint: server.endpoint,
    credentials: { kind: 'password', username, password },
    resource: `e2e-${Math.random().toString(36).slice(2, 8)}`,
  })
  if (!login.ok)
    throw new Error(`${username} login: ${login.error.condition} ${login.error.text ?? ''}`)
  return login.value
}

async function apply(
  ops: AdminOps,
  plan: PublishPlan,
  what: string,
  marker: ReturnType<typeof privateMarkerStore>,
) {
  const result = await executePlan(ops, plan, {
    passwordFor: demoPassword,
    marker,
    confirmed: planConfirmations(plan),
  })
  if (!result.ok) {
    throw new Error(`${what} failed at ${result.failed?.stepId}: ${result.failed?.error.message}`)
  }
}

/** Resets the server (ADM-15) and clears the vault: an empty server, its admin account only. */
export async function resetServer(server: EjabberdServer): Promise<void> {
  const transport = nodeTransport()
  const admin = await connect(server, transport, 'admin', server.adminPassword)
  try {
    await reset(server, transport, admin)
  } finally {
    await admin.disconnect()
  }
}

async function reset(server: EjabberdServer, transport: XmppTransport, admin: Session) {
  const marker = privateMarkerStore(admin.admin)
  const ops = new AdminOps({ session: admin, login: { transport, endpoint: server.endpoint } })
  // The vault of an earlier run may have a passphrase this run does not know.
  const cleared = await admin.admin.setPrivate(VAULT_STORAGE_KEY, '')
  if (!cleared.ok) throw new Error(`clear vault: ${cleared.error.condition}`)
  const planned = await prepareReset(ops, { marker })
  if (!planned.ok) throw new Error(`plan reset: ${planned.error.message}`)
  await apply(ops, planned.value.plan, 'reset', marker)
  // A run that stopped part-way can leave an account the reset cannot see (it reads the role
  // documents); the scenarios' own role ids are removed whatever is left.
  for (const roleId of SCENARIO_ROLE_IDS) await ops.deleteRole(roleId, { rooms: [], nodes: [] })
  return { ops, marker }
}

/** Every role id the scenarios use: the demo's, and those SC-1 designs. */
const SCENARIO_ROLE_IDS = [
  ...(demoSeed().design as DesignFile).roles.map((r) => r.loginName),
  'blue-lead',
  'blue-watch',
  'red-lead',
]

/** Resets the server and publishes the demo game with its history; resolves when it is ready. */
export async function publishDemoGame(server: EjabberdServer): Promise<void> {
  const transport = nodeTransport()
  const admin = await connect(server, transport, 'admin', server.adminPassword)
  try {
    const { ops, marker } = await reset(server, transport, admin)
    const vault = await ObserverVault.create(admin.admin, SCENARIO_VAULT_PASSPHRASE, {
      iterations: VAULT_KDF.minIterations,
    })
    if (!vault.ok) throw new Error(`create vault: ${vault.error.message}`)
    ops.useVault(vault.value)
    const seed = demoSeed(server.endpoint.domain)
    const design = seed.design as DesignFile
    const prepared = await preparePublish(ops, design, { marker, vault: vault.value })
    if (!prepared.ok) throw new Error(`plan publish: ${prepared.error.message}`)
    await apply(ops, prepared.value.plan, 'publish', marker)

    // The admin's world state in the map room first, as the mock's seed posts it (D25), then
    // the demo's history, in order, each message from its author.
    const map = design.rooms.find((r) => r.roomType === MAP_ROOM_TYPE)
    if (seed.worldState !== undefined && map !== undefined) {
      const room = `${map.id}@${admin.services.muc}`
      const join = await admin.muc.join(room, 'admin-seed')
      if (!join.ok) throw new Error(`admin map join: ${join.error.condition}`)
      const body = JSON.stringify({
        type: 'world-state',
        schemaVersion: 1,
        content: seed.worldState,
      })
      const sent = await admin.muc.send(room, body, { maxBytes: LIMITS.worldStateStanzaBytes })
      if (!sent.ok) throw new Error(`admin world state: ${sent.error.condition}`)
      await admin.muc.leave(room)
    }
    const sessions = new Map<string, Session>([['admin', admin]])
    const joined = new Set<string>()
    try {
      for (const message of seed.history ?? []) {
        let session = sessions.get(message.author)
        if (session === undefined) {
          session = await connect(server, transport, message.author, demoPassword(message.author))
          sessions.set(message.author, session)
        }
        const room = `${message.room}@${session.services.muc}`
        const key = `${message.author} ${room}`
        if (!joined.has(key)) {
          const join = await session.muc.join(room, `${message.author}-seed`)
          if (!join.ok) throw new Error(`${key} join: ${join.error.condition}`)
          joined.add(key)
        }
        const sent = await session.muc.send(room, message.body)
        if (!sent.ok) throw new Error(`${key} post: ${sent.error.condition}`)
      }
    } finally {
      for (const [author, session] of sessions) if (author !== 'admin') await session.disconnect()
    }
  } finally {
    await admin.disconnect()
  }
}
