// The S15-S16 context: a contract-style backend, three test accounts, and helpers to record results.
// A check gets a Ctx and nothing else, as a contract-suite check gets its Ctx.
import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll } from 'vitest'
import type { Session } from '../../../packages/transport/src/index.ts'
import type { ContractBackend, RawAccess } from '../../../packages/contract-suite/src/index.ts'
import { must, uniq } from '../../../packages/contract-suite/src/harness.ts'
import { Pubsub, type Transcript } from '../../s14/src/pubsub.ts'
import { observe } from './record.ts'

export { observe, saveStanzas } from './record.ts'

/**
 * umpire: a White Force editor, the second publisher on an objectives node (S15).
 * reader: a force's reader, a member of the node or room.
 * player: a shaped player who sends large messages (S16).
 */
export type Role = 'umpire' | 'reader' | 'player'

export interface Ctx {
  readonly backend: ContractBackend
  readonly raw: RawAccess
  /** The admin session that created the accounts, open for the whole file. */
  admin(): Session
  /** A fresh admin session, closed after the test. */
  adminLogin(): Promise<Session>
  /** Raw PubSub for a session (the admin's by default). */
  ps(session?: Session, t?: Transcript, label?: string): Pubsub
  /** Logs in as one of the run's accounts; closed after the test. */
  login(user: Role): Promise<Session>
  /** Bare JID of one of the run's accounts. */
  jid(user: Role): string
  /** A node or room name unique to this run. */
  name(base: string): string
  observe(check: string, name: string, data: Record<string, unknown>): void
}

export function makeCtx(backend: ContractBackend, raw: RawAccess): Ctx {
  const tag = uniq('s1516')
  const password = randomBytes(12).toString('base64url')
  const users: Record<Role, string> = { umpire: `${tag}-umpire`, reader: `${tag}-reader`, player: `${tag}-player` }
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
    // The server may have restarted (S15-6): use a fresh admin session for the clean-up.
    const cleaner = must(await backend.admin(), 'admin login for clean-up')
    for (const u of Object.values(users)) await cleaner.admin.deleteUser(`${u}@${backend.domain}`)
    await cleaner.disconnect()
    await adminSession?.disconnect()
  }, 60_000)

  const ctx: Ctx = {
    backend,
    raw,
    admin: () => {
      if (adminSession === undefined) throw new Error('no admin session')
      return adminSession
    },
    adminLogin: async () => {
      const s = must(await backend.admin(), 'admin login')
      opened.push(s)
      return s
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
    jid: (user) => `${users[user]}@${backend.domain}`,
    name: (base) => `${tag}-${base}`,
    observe: (check, name, data) => observe(check, name, data),
  }
  return ctx
}
