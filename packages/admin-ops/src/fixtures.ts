// Test fixtures for the unit tests: FakeSessions for the admin and a role, private storage in a
// map, a transport that hands out the role's session, and one log of calls across both sessions.
import { err, ok } from '@wrx/transport'
import { FakeSession } from '@wrx/transport'
import type { Joined, Outcome, Session, Transport } from '@wrx/transport'
import { AdminOps } from './ops.ts'
import type { ProgressEvent } from './errors.ts'
import { ObserverVault, VAULT_KDF } from './vault.ts'

export const DOMAIN = 'wrx.test'
export const MUC = `conference.${DOMAIN}`
export const PASSPHRASE = 'correct horse battery staple'
export const FAST = { iterations: VAULT_KDF.minIterations }

export interface Rig {
  readonly admin: FakeSession
  readonly role: FakeSession
  readonly ops: AdminOps
  readonly vault: ObserverVault | undefined
  readonly log: string[]
  readonly progress: ProgressEvent[]
  readonly storage: Map<string, string>
  /** Logins the transport was asked for, as `username:password`. */
  readonly logins: string[]
}

/** Stores private values in `storage`, as the server does per account. */
export function withStorage(session: FakeSession, storage: Map<string, string>): void {
  session.stub('admin', 'getPrivate', (key) => {
    const value = typeof key === 'string' ? storage.get(key) : undefined
    return Promise.resolve(ok(value === '' ? undefined : value))
  })
  session.stub('admin', 'setPrivate', (key, value) => {
    if (typeof key === 'string' && typeof value === 'string') storage.set(key, value)
    return Promise.resolve(ok(undefined))
  })
}

export function joined(room: string, nick: string, role: Joined['role']): Outcome<Joined> {
  return Promise.resolve(ok({ room, nick, role, affiliation: 'member' }))
}

/** Records `who.op(args)` in the shared log for the ops whose order the tests check. */
function logged(session: FakeSession, who: string, log: string[]): void {
  const ops: readonly ['muc' | 'pubsub' | 'admin', string][] = [
    ['muc', 'setAffiliations'],
    ['muc', 'setRole'],
    ['muc', 'leave'],
    ['muc', 'createRoom'],
    ['muc', 'configureRoom'],
    ['muc', 'destroyRoom'],
    ['pubsub', 'setAffiliations'],
    ['pubsub', 'setSubscriptions'],
    ['pubsub', 'getSubscriptions'],
    ['pubsub', 'createNode'],
    ['pubsub', 'configureNode'],
    ['pubsub', 'publish'],
    ['admin', 'deleteUser'],
    ['admin', 'addUser'],
    ['admin', 'changePassword'],
  ]
  for (const [api, op] of ops) {
    session.stub(api, op, (...args) => {
      log.push(`${who}.${api}.${op} ${JSON.stringify(args)}`)
      return Promise.resolve(ok(op === 'getSubscriptions' ? [] : undefined))
    })
  }
  session.stub('muc', 'join', (room, nick) => {
    log.push(`${who}.muc.join ${JSON.stringify([room, nick])}`)
    return joined(String(room), String(nick), who === 'admin' ? 'moderator' : 'participant')
  })
}

/**
 * An AdminOps over fakes. The role's session joins as `participant`, then (after the admin's
 * setRole) as `visitor`, as ejabberd's stored role does.
 */
export async function rig(options: { readonly vault?: boolean } = {}): Promise<Rig> {
  const log: string[] = []
  const progress: ProgressEvent[] = []
  const logins: string[] = []
  const storage = new Map<string, string>()
  const admin = new FakeSession({
    jid: `admin@${DOMAIN}/ops`,
    services: { muc: MUC, pubsub: `pubsub.${DOMAIN}` },
  })
  const role = new FakeSession({ jid: `blue-observer@${DOMAIN}/x`, services: admin.services })
  withStorage(admin, storage)
  logged(admin, 'admin', log)
  logged(role, 'role', log)
  let stored: Joined['role'] = 'participant'
  admin.stub('muc', 'setRole', (...args) => {
    log.push(`admin.muc.setRole ${JSON.stringify(args)}`)
    if (args[2] === 'visitor' || args[2] === 'participant') stored = args[2]
    return Promise.resolve(ok(undefined))
  })
  role.stub('muc', 'join', (room, nick) => {
    log.push(`role.muc.join ${JSON.stringify([room, nick])}`)
    return joined(String(room), String(nick), stored)
  })
  const origDisconnect = role.disconnect.bind(role)
  role.disconnect = () => {
    log.push('role.disconnect')
    return origDisconnect()
  }
  const transport: Transport = {
    kind: 'mock',
    connect: (opts) => {
      if (opts.credentials.kind !== 'password') return Promise.resolve(err('not-authorized'))
      logins.push(`${opts.credentials.username}:${opts.credentials.password}`)
      log.push(`connect ${opts.credentials.username}`)
      const session: Session = role
      return Promise.resolve(ok(session))
    },
  }
  let vault: ObserverVault | undefined
  if (options.vault !== false) {
    const created = await ObserverVault.create(admin.admin, PASSPHRASE, FAST)
    if (!created.ok) throw new Error(created.error.message)
    vault = created.value
    const set = await vault.set('blue-observer', 'observer-password')
    if (!set.ok) throw new Error(set.error.message)
  }
  const ops = new AdminOps({
    session: admin,
    login: { transport, endpoint: { websocketUrl: 'fake://', domain: DOMAIN } },
    ...(vault === undefined ? {} : { vault }),
    onProgress: (e) => progress.push(e),
  })
  log.length = 0
  return { admin, role, ops, vault, log, progress, storage, logins }
}

/** The log with arguments dropped: `admin.muc.setAffiliations`, … */
export function ops(log: readonly string[]): string[] {
  return log.map((line) => line.split(' ')[0] ?? line)
}
