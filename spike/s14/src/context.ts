// The S14 context: a contract-style backend, three test accounts, and helpers to record results.
// A check gets an S14Ctx and nothing else, as a contract-suite check gets its Ctx.
import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll } from 'vitest'
import type { Session } from '../../../packages/transport/src/index.ts'
import type { ContractBackend, RawAccess } from '../../../packages/contract-suite/src/index.ts'
import { must, uniq } from '../../../packages/contract-suite/src/harness.ts'
import { observe } from './record.ts'
import { Pubsub, type Transcript } from './pubsub.ts'

export { observe, saveStanzas } from './record.ts'

export interface S14Ctx {
  readonly backend: ContractBackend
  readonly raw: RawAccess
  /** The admin session that created the accounts, open for the whole run. */
  admin(): Session
  /** Raw PubSub for a session (the admin's by default). */
  ps(session?: Session, t?: Transcript, label?: string): Pubsub
  /** Logs in as one of the run's accounts; closed after the test. */
  login(user: Role): Promise<Session>
  anonymous(): Promise<Session>
  /** Bare JID of one of the run's accounts. */
  jid(user: Role): string
  /** A node name unique to this run. */
  node(name: string): string
  /** Appends one observation to results/observations.jsonl. */
  observe(check: string, name: string, data: Record<string, unknown>): void
}

/**
 * blue: affiliated to the collection (the force's reader). red: another force, not affiliated.
 * blue2: a second publisher on a leaf (S14-8).
 */
export type Role = 'blue' | 'red' | 'blue2'

export function makeCtx(backend: ContractBackend, raw: RawAccess): S14Ctx {
  const tag = uniq('s14')
  const password = randomBytes(12).toString('base64url')
  const users: Record<Role, string> = { blue: `${tag}-blue`, red: `${tag}-red`, blue2: `${tag}-blue2` }
  let adminSession: Session | undefined
  const opened: Session[] = []

  beforeAll(async () => {
    adminSession = must(await backend.admin(), 'admin login')
    for (const u of Object.values(users))
      must(await adminSession.admin.addUser(`${u}@${backend.domain}`, password), `add-user ${u}`)
  }, 60_000)
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((s) => s.disconnect()))
  })
  afterAll(async () => {
    if (adminSession !== undefined) {
      for (const u of Object.values(users)) await adminSession.admin.deleteUser(`${u}@${backend.domain}`)
      await adminSession.disconnect()
    }
  }, 60_000)

  const ctx: S14Ctx = {
    backend,
    raw,
    admin: () => {
      if (adminSession === undefined) throw new Error('no admin session')
      return adminSession
    },
    ps: (session, t, label) => {
      const s = session ?? ctx.admin()
      const p = new Pubsub(raw, s, s.services.pubsub)
      return t === undefined ? p : p.recording(t, label ?? 'session')
    },
    login: async (user) => {
      const s = must(
        await backend.connect({ kind: 'password', username: users[user], password, resource: uniq(user) }),
        `login ${user}`,
      )
      opened.push(s)
      return s
    },
    anonymous: async () => {
      const s = must(await backend.connect({ kind: 'anonymous', resource: uniq('anon') }), 'anonymous login')
      opened.push(s)
      return s
    },
    jid: (user) => `${users[user]}@${backend.domain}`,
    node: (name) => `${tag}:${name}`,
    observe: (check, name, data) => observe(check, name, data),
  }
  return ctx
}
