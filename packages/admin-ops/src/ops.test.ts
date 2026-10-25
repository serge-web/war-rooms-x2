// Unit tests of AdminOps against FakeSession: the order of requests each rule depends on (R-A to
// R-F), fail-closed behaviour, and typed results. Effects on a real server are checked by the
// integration runs (integration/scenario.ts).
import { err, ok } from '@wrx/transport'
import type { SubscriptionEntry } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { DOMAIN, MUC, joined, ops, rig } from './fixtures.ts'
import type { Rig } from './fixtures.ts'
import { AdminOps } from './ops.ts'
import { gameNodeConfig, gameRoomConfig } from './target.ts'
import { VAULT_STORAGE_KEY } from './vault.ts'

const room = (id: string) => `${id}@${MUC}`
const jid = (id: string) => `${id}@${DOMAIN}`

describe('R-A: revoking node access', () => {
  it('grants first, then removes the affiliation, then every full-JID subscription of the role', async () => {
    const { admin, ops: adminOps, log } = await rig()
    const subs: SubscriptionEntry[] = [
      { jid: `${jid('blue-co')}/pane-1`, subscription: 'subscribed' },
      { jid: `${jid('blue-co')}/pane-2`, subscription: 'subscribed' },
      { jid: jid('blue-co'), subscription: 'subscribed' },
      { jid: `${jid('red-co')}/pane-1`, subscription: 'subscribed' },
    ]
    let reads = 0
    admin.stub('pubsub', 'getSubscriptions', () => {
      log.push('admin.pubsub.getSubscriptions')
      reads++
      return Promise.resolve(ok(reads === 1 ? subs : subs.slice(3)))
    })
    const result = await adminOps.applyNodeAccess('objectives:blue', [
      { roleId: 'blue-co', access: 'none' },
      { roleId: 'umpire-1', access: 'publish' },
    ])
    expect(result).toEqual({ ok: true, value: undefined })
    expect(ops(log)).toEqual([
      'admin.pubsub.setAffiliations',
      'admin.pubsub.setAffiliations',
      'admin.pubsub.getSubscriptions',
      'admin.pubsub.setSubscriptions',
      'admin.pubsub.getSubscriptions',
    ])
    expect(log[0]).toContain('"publisher"')
    expect(log[1]).toContain(`{"jid":"${jid('blue-co')}","affiliation":"none"}`)
    const removed = admin.calls.find((c) => c.op === 'setSubscriptions')?.args[1]
    expect(removed).toEqual([
      { jid: `${jid('blue-co')}/pane-1`, subscription: 'none' },
      { jid: `${jid('blue-co')}/pane-2`, subscription: 'none' },
      { jid: jid('blue-co'), subscription: 'none' },
    ])
  })

  it('fails verify-failed when a subscription survives', async () => {
    const { admin, ops: adminOps } = await rig()
    const left = [{ jid: `${jid('blue-co')}/p`, subscription: 'subscribed' as const }]
    admin.stub('pubsub', 'getSubscriptions', () => Promise.resolve(ok(left)))
    const result = await adminOps.setNodeAccess('roles:blue-co', 'blue-co', 'none')
    expect(result.ok ? undefined : result.error.code).toBe('verify-failed')
  })

  it('reports a server refusal as a typed error, without throwing', async () => {
    const { admin, ops: adminOps, progress } = await rig()
    admin.stub('pubsub', 'setAffiliations', () => Promise.resolve(err('forbidden', 'no', 'auth')))
    const result = await adminOps.setNodeAccess('roles:blue-co', 'blue-co', 'read')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'refused', step: 'grant affiliation', cause: { condition: 'forbidden' } },
    })
    expect(progress.at(-1)).toMatchObject({ state: 'failed', step: 'grant affiliation' })
  })
})

describe('R-B: read-only room access (the vault route)', () => {
  it('grants membership, then at once the role joins and the admin revokes its voice, then verifies', async () => {
    const { ops: adminOps, log, logins } = await rig()
    const result = await adminOps.makeReadOnly('blue-observer', ['blue-hq'])
    expect(result).toEqual({ ok: true, value: undefined })
    expect(logins).toEqual(['blue-observer:observer-password'])
    expect(ops(log)).toEqual([
      'connect',
      'admin.muc.join',
      'admin.muc.setAffiliations',
      'role.muc.join',
      'admin.muc.setRole',
      'role.muc.leave',
      'role.muc.join',
      'role.muc.leave',
      'admin.muc.leave',
      'role.disconnect',
    ])
    expect(log[2]).toContain('"member"')
    expect(log[4]).toContain('["blue-hq@conference.wrx.test","blue-observer","visitor"')
  })

  it('re-applies voice revocation after an affiliation change (read access via applyRoomAccess)', async () => {
    const { ops: adminOps, log } = await rig()
    const result = await adminOps.applyRoomAccess('blue-hq', [
      { roleId: 'blue-co', access: 'write' },
      { roleId: 'blue-observer', access: 'read' },
      { roleId: 'red-co', access: 'none' },
    ])
    expect(result.ok).toBe(true)
    const steps = ops(log)
    const grantRead = log.findIndex((l) => l.includes('blue-observer') && l.includes('"member"'))
    expect(steps.slice(grantRead, grantRead + 3)).toEqual([
      'admin.muc.setAffiliations',
      'role.muc.join',
      'admin.muc.setRole',
    ])
    // Writers first, revocations last.
    expect(log.findIndex((l) => l.includes('blue-co') && l.includes('"member"'))).toBeLessThan(
      grantRead,
    )
    expect(log.findIndex((l) => l.includes('red-co') && l.includes('"none"'))).toBeGreaterThan(
      grantRead,
    )
  })

  it('takes an existing membership away before logging in, then grants it and checks voice', async () => {
    const { admin, role, ops: adminOps, log } = await rig()
    admin.stub('muc', 'getAffiliations', () =>
      Promise.resolve(ok([{ jid: jid('blue-observer'), affiliation: 'member' as const }])),
    )
    role.stub('muc', 'join', (r, n) => {
      log.push('role.muc.join')
      return joined(String(r), String(n), 'visitor')
    })
    expect((await adminOps.makeReadOnly('blue-observer', ['blue-hq'])).ok).toBe(true)
    const affs = log.filter((l) => l.startsWith('admin.muc.setAffiliations'))
    expect(affs.map((l) => (l.includes('"none"') ? 'none' : 'member'))).toEqual(['none', 'member'])
    expect(ops(log).indexOf('admin.muc.setAffiliations')).toBeLessThan(ops(log).indexOf('connect'))
    // Already a visitor on joining: no setRole.
    expect(ops(log)).not.toContain('admin.muc.setRole')
  })

  it('fails closed: a refused voice revocation takes the membership away again', async () => {
    const { admin, ops: adminOps, log } = await rig()
    admin.stub('muc', 'setRole', () => Promise.resolve(err('not-allowed', 'no', 'cancel')))
    const result = await adminOps.makeReadOnly('blue-observer', ['blue-hq'])
    expect(result).toMatchObject({ ok: false, error: { code: 'refused', rolledBack: true } })
    const affs = log.filter((l) => l.startsWith('admin.muc.setAffiliations'))
    expect(affs.at(-1)).toContain('"none"')
    expect(ops(log).at(-1)).toBe('role.disconnect')
  })

  it('fails closed when the rejoin shows the role still has voice', async () => {
    const { admin, ops: adminOps, log } = await rig()
    admin.stub('muc', 'setRole', () => Promise.resolve(ok(undefined)))
    const result = await adminOps.makeReadOnly('blue-observer', ['blue-hq'])
    expect(result).toMatchObject({ ok: false, error: { code: 'verify-failed', rolledBack: true } })
    expect(log.filter((l) => l.startsWith('admin.muc.setAffiliations')).at(-1)).toContain('"none"')
  })

  it('grants nothing when the vault has no password for the role, or is not attached', async () => {
    const { ops: adminOps, log } = await rig()
    const missing = await adminOps.makeReadOnly('red-liaison', ['red-hq'])
    expect(missing.ok ? undefined : missing.error.code).toBe('no-password')
    const locked = await (
      await rig({ vault: false })
    ).ops.makeReadOnly('blue-observer', ['blue-hq'])
    expect(locked.ok ? undefined : locked.error.code).toBe('vault-locked')
    expect(log).toEqual([])
  })

  it('a failed role login grants nothing', async () => {
    const { admin, vault, log } = await rig()
    const failing = new AdminOps({
      session: admin,
      login: {
        transport: { kind: 'mock', connect: () => Promise.resolve(err('not-authorized')) },
        endpoint: { websocketUrl: 'fake://', domain: DOMAIN },
      },
      ...(vault === undefined ? {} : { vault }),
    })
    const result = await failing.makeReadOnly('blue-observer', ['blue-hq'])
    expect(result.ok ? undefined : result.error.code).toBe('login-failed')
    expect(log.filter((l) => l.includes('setAffiliations'))).toEqual([])
  })

  it('read to write restores voice through the role login', async () => {
    const { admin, role, ops: adminOps, log } = await rig()
    admin.stub('muc', 'getAffiliations', () =>
      Promise.resolve(ok([{ jid: jid('blue-observer'), affiliation: 'member' as const }])),
    )
    role.stub('muc', 'join', (r, n) => {
      log.push('role.muc.join')
      return joined(String(r), String(n), 'visitor')
    })
    expect((await adminOps.setRoomAccess('blue-hq', 'blue-observer', 'write', 'read')).ok).toBe(
      true,
    )
    expect(log.find((l) => l.startsWith('admin.muc.setRole'))).toContain('"participant"')
  })

  it('read to write without a vault password clears the stored role with an affiliation round trip', async () => {
    const { admin, ops: adminOps, log } = await rig()
    admin.stub('muc', 'getAffiliations', () =>
      Promise.resolve(ok([{ jid: jid('red-liaison'), affiliation: 'member' as const }])),
    )
    expect((await adminOps.setRoomAccess('red-hq', 'red-liaison', 'write', 'read')).ok).toBe(true)
    const affs = log.filter((l) => l.startsWith('admin.muc.setAffiliations'))
    expect(affs.map((l) => (l.includes('"none"') ? 'none' : 'member'))).toEqual(['none', 'member'])
  })
})

describe('R-B: write to read fails closed (security review F1)', () => {
  const refusingLogin = (admin: Rig['admin'], vault: Rig['vault']) =>
    new AdminOps({
      session: admin,
      login: {
        transport: { kind: 'mock', connect: () => Promise.resolve(err('not-authorized')) },
        endpoint: { websocketUrl: 'fake://', domain: DOMAIN },
      },
      ...(vault === undefined ? {} : { vault }),
    })
  const memberOf = (admin: Rig['admin'], ...roleIds: string[]) => {
    admin.stub('muc', 'getAffiliations', () =>
      Promise.resolve(ok(roleIds.map((r) => ({ jid: jid(r), affiliation: 'member' as const })))),
    )
  }
  const dropped = (log: readonly string[], roleId: string) =>
    log.filter(
      (l) =>
        l.startsWith('admin.muc.setAffiliations') &&
        l.includes(jid(roleId)) &&
        l.includes('"none"'),
    )

  it('a refused role login takes an existing membership away first', async () => {
    const { admin, vault, log } = await rig()
    memberOf(admin, 'blue-observer')
    const result = await refusingLogin(admin, vault).applyRoomAccess('blue-hq', [
      { roleId: 'blue-observer', access: 'read' },
    ])
    expect(result).toMatchObject({ ok: false, error: { code: 'login-failed', rolledBack: true } })
    expect(dropped(log, 'blue-observer')).toHaveLength(1)
    expect(log.filter((l) => l.includes('"member"'))).toEqual([])
  })

  it('no vault password, or a locked vault, takes an existing membership away', async () => {
    const { admin, ops: adminOps, log } = await rig()
    memberOf(admin, 'red-co')
    const result = await adminOps.makeReadOnly('red-co', ['blue-hq', 'red-hq'])
    expect(result).toMatchObject({ ok: false, error: { code: 'no-password', rolledBack: true } })
    expect(dropped(log, 'red-co')).toHaveLength(2)

    const locked = await rig({ vault: false })
    memberOf(locked.admin, 'blue-observer')
    const lockedResult = await locked.ops.makeReadOnly('blue-observer', ['blue-hq'])
    expect(lockedResult.ok ? undefined : lockedResult.error.code).toBe('vault-locked')
    expect(dropped(locked.log, 'blue-observer')).toHaveLength(1)
  })

  it('takes every membership away before the role logs in', async () => {
    const { admin, ops: adminOps, log } = await rig()
    memberOf(admin, 'blue-observer')
    expect((await adminOps.makeReadOnly('blue-observer', ['blue-hq', 'red-hq'])).ok).toBe(true)
    const steps = ops(log)
    const login = steps.indexOf('connect')
    expect(steps.slice(0, login)).toEqual([
      'admin.muc.setAffiliations',
      'admin.muc.setAffiliations',
    ])
    expect(dropped(log, 'blue-observer')).toHaveLength(2)
    // Then, per room, membership and voice revocation back to back (R-B).
    expect(steps.slice(login + 1, login + 5)).toEqual([
      'admin.muc.join',
      'admin.muc.setAffiliations',
      'role.muc.join',
      'admin.muc.setRole',
    ])
  })

  it('handles every room after one fails, and reports each failure', async () => {
    const { admin, role, ops: adminOps, log } = await rig()
    memberOf(admin, 'blue-observer')
    const visitorIn = new Set<string>()
    admin.stub('muc', 'setRole', (r, ...rest) => {
      log.push(`admin.muc.setRole ${JSON.stringify([r, ...rest])}`)
      if (String(r).startsWith('blue-hq@') || String(r).startsWith('red-hq@')) {
        return Promise.resolve(err('not-allowed', 'no', 'cancel'))
      }
      visitorIn.add(String(r))
      return Promise.resolve(ok(undefined))
    })
    role.stub('muc', 'join', (r, n) => {
      log.push(`role.muc.join ${JSON.stringify([r, n])}`)
      return joined(String(r), String(n), visitorIn.has(String(r)) ? 'visitor' : 'participant')
    })
    const result = await adminOps.makeReadOnly('blue-observer', ['blue-hq', 'red-hq', 'umpire-hq'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatchObject({ code: 'refused', target: 'blue-hq', rolledBack: true })
    expect(result.error.failures?.map((f) => f.target)).toEqual(['blue-hq', 'red-hq'])
    // umpire-hq was still handled: the role joined it and the admin set it to visitor.
    expect(log.some((l) => l.startsWith('admin.muc.setRole') && l.includes('umpire-hq@'))).toBe(
      true,
    )
    // Each failed room ends with the membership taken away.
    for (const room of ['blue-hq', 'red-hq']) {
      expect(
        log
          .filter((l) => l.startsWith('admin.muc.setAffiliations') && l.includes(`${room}@`))
          .at(-1),
      ).toContain('"none"')
    }
  })

  it('applyRoomAccess runs the other changes after a read-only change fails', async () => {
    const { admin, vault, log } = await rig()
    memberOf(admin, 'blue-observer')
    const result = await refusingLogin(admin, vault).applyRoomAccess('blue-hq', [
      { roleId: 'blue-observer', access: 'read' },
      { roleId: 'red-co', access: 'none' },
    ])
    expect(result.ok ? undefined : result.error.code).toBe('login-failed')
    expect(dropped(log, 'red-co')).toHaveLength(1)
  })
})

describe('R-C: rooms', () => {
  it('creates a missing room with the NFR-3 config, moderated', async () => {
    const { admin, ops: adminOps, log } = await rig()
    let exists = false
    admin.stub('muc', 'listRooms', () => Promise.resolve(ok(exists ? [room('blue-hq')] : [])))
    admin.stub('muc', 'createRoom', (...args) => {
      log.push(`admin.muc.createRoom ${JSON.stringify(args)}`)
      exists = true
      return Promise.resolve(ok(undefined))
    })
    admin.stub('muc', 'getRoomConfig', () => Promise.resolve(ok(gameRoomConfig('Blue HQ'))))
    expect(await adminOps.ensureRoom('blue-hq', { name: 'Blue HQ' })).toEqual({
      ok: true,
      value: 'created',
    })
    expect(admin.calls.find((c) => c.op === 'createRoom')?.args[1]).toEqual(
      gameRoomConfig('Blue HQ'),
    )
    expect(gameRoomConfig('x')).toMatchObject({
      moderated: true,
      membersOnly: true,
      public: false,
      whois: 'anyone',
    })
    // Never asks a possibly missing room for its config (ejabberd would create it, public).
    const firstConfigRead = admin.calls.findIndex((c) => c.op === 'getRoomConfig')
    expect(firstConfigRead).toBeGreaterThan(admin.calls.findIndex((c) => c.op === 'createRoom'))
  })

  it('reconfigures an unmoderated room, and fails verify when it stays unmoderated', async () => {
    const { admin, ops: adminOps } = await rig()
    admin.stub('muc', 'listRooms', () => Promise.resolve(ok([room('blue-hq')])))
    admin.stub('muc', 'getRoomConfig', () =>
      Promise.resolve(ok({ ...gameRoomConfig('Blue HQ'), moderated: false })),
    )
    const result = await adminOps.ensureRoom('blue-hq', { name: 'Blue HQ' })
    expect(admin.calls.find((c) => c.op === 'configureRoom')?.args[1]).toMatchObject({
      moderated: true,
    })
    expect(result.ok ? undefined : result.error.code).toBe('verify-failed')
  })

  it('reading a missing room returns undefined without an owner request', async () => {
    const { admin, ops: adminOps } = await rig()
    expect(await adminOps.readRoom('gone')).toEqual({ ok: true, value: undefined })
    expect(admin.calls.filter((c) => c.api === 'muc').map((c) => c.op)).toEqual(['listRooms'])
  })
})

describe('R-D: moving a role', () => {
  it('grants every new room and node access before revoking any old access', async () => {
    const { ops: adminOps, log } = await rig()
    const result = await adminOps.moveRole('blue-co', {
      rooms: [
        { roomId: 'blue-hq', access: 'none' },
        { roomId: 'red-hq', access: 'write' },
      ],
      nodes: [
        { node: 'objectives:blue', access: 'none' },
        { node: 'objectives:red', access: 'read' },
      ],
    })
    expect(result.ok).toBe(true)
    const changes = log.filter((l) => l.includes('setAffiliations'))
    expect(
      changes.map(
        (l) =>
          `${l.includes('muc') ? 'room' : 'node'} ${l.includes('"none"') ? 'revoke' : 'grant'}`,
      ),
    ).toEqual(['room grant', 'node grant', 'room revoke', 'node revoke'])
    expect(changes[0]).toContain('red-hq')
    expect(changes[2]).toContain('blue-hq')
  })

  it('stops before revoking anything when a grant fails', async () => {
    const { admin, ops: adminOps, log } = await rig()
    admin.stub('pubsub', 'setAffiliations', () => Promise.resolve(err('forbidden')))
    const result = await adminOps.moveRole('blue-co', {
      rooms: [
        { roomId: 'blue-hq', access: 'none' },
        { roomId: 'red-hq', access: 'write' },
      ],
      nodes: [{ node: 'objectives:red', access: 'read' }],
    })
    expect(result.ok).toBe(false)
    expect(log.filter((l) => l.includes('"none"'))).toEqual([])
  })
})

describe('R-E: deleting a role', () => {
  it('removes room affiliations, node affiliations and subscriptions, then the account, then its vault entry', async () => {
    const { admin, ops: adminOps, vault, log, storage } = await rig()
    admin.stub('pubsub', 'getSubscriptions', () => {
      log.push('admin.pubsub.getSubscriptions')
      return Promise.resolve(ok([]))
    })
    let subs = [{ jid: `${jid('blue-observer')}/a`, subscription: 'subscribed' as const }]
    admin.stub('pubsub', 'getSubscriptions', () => {
      log.push('admin.pubsub.getSubscriptions')
      const now = subs
      return Promise.resolve(ok(now))
    })
    admin.stub('pubsub', 'setSubscriptions', () => {
      log.push('admin.pubsub.setSubscriptions')
      subs = []
      return Promise.resolve(ok(undefined))
    })
    admin.stub('admin', 'deleteUser', () => {
      log.push('admin.admin.deleteUser')
      return Promise.resolve(err('item-not-found', 'No hook has processed this command'))
    })
    const before = storage.get(VAULT_STORAGE_KEY)
    const result = await adminOps.deleteRole('blue-observer', {
      rooms: ['blue-hq', 'gone'],
      nodes: ['roles:blue-observer'],
    })
    expect(result).toEqual({ ok: true, value: undefined })
    expect(ops(log)).toEqual([
      'admin.muc.setAffiliations',
      'admin.muc.setAffiliations',
      'admin.pubsub.setAffiliations',
      'admin.pubsub.getSubscriptions',
      'admin.pubsub.setSubscriptions',
      'admin.pubsub.getSubscriptions',
      'admin.admin.deleteUser',
    ])
    expect(storage.get(VAULT_STORAGE_KEY)).not.toBe(before)
    expect(vault?.has('blue-observer')).toBe(false)
  })

  it('skips rooms and nodes that no longer exist', async () => {
    const { admin, ops: adminOps } = await rig()
    admin.stub('muc', 'setAffiliations', () => Promise.resolve(err('item-not-found')))
    admin.stub('pubsub', 'setAffiliations', () => Promise.resolve(err('item-not-found')))
    expect(
      (await adminOps.deleteRole('red-co', { rooms: ['x'], nodes: ['roles:red-co'] })).ok,
    ).toBe(true)
  })

  it('discovers rooms and nodes when no scope is given', async () => {
    const { admin, ops: adminOps, log } = await rig()
    admin.stub('muc', 'listRooms', () => Promise.resolve(ok([room('blue-hq'), 'x@elsewhere'])))
    admin.stub('pubsub', 'listNodes', () => Promise.resolve(ok(['roles:red-co', 'not-ours'])))
    expect((await adminOps.deleteRole('red-co')).ok).toBe(true)
    expect(log.filter((l) => l.includes('setAffiliations')).map((l) => l.split('"')[1])).toEqual([
      room('blue-hq'),
      'roles:red-co',
    ])
  })

  it('refuses while a stored vault is locked, so the vault cannot fall out of step', async () => {
    const locked = await rig()
    const unattached = new AdminOps({ session: locked.admin })
    const result = await unattached.deleteRole('blue-observer', { rooms: [], nodes: [] })
    expect(result.ok ? undefined : result.error.code).toBe('vault-locked')
    expect(locked.log).toEqual([])
  })

  it('never touches the admin account', async () => {
    const { ops: adminOps, log } = await rig()
    for (const result of [
      await adminOps.deleteRole('admin'),
      await adminOps.deleteAccount('admin'),
      await adminOps.setPassword('admin', 'x'),
      await adminOps.setRoomAccess('blue-hq', 'admin', 'none'),
    ]) {
      expect(result.ok ? undefined : result.error.code).toBe('invalid')
    }
    expect(log).toEqual([])
  })

  it('refuses a role id that looks like an anonymous session (security review F4)', async () => {
    const { ops: adminOps, log } = await rig()
    for (const result of [
      await adminOps.createAccount('1234567890123456', 'pw'),
      await adminOps.deleteRole('1234567890123456'),
    ]) {
      expect(result.ok ? undefined : result.error.code).toBe('invalid')
    }
    expect(log).toEqual([])
  })
})

describe('R-F: destroying a room', () => {
  it('counts the archive first, reports it, and destroys only at the confirmed count', async () => {
    const { admin, ops: adminOps, log, progress } = await rig()
    const page = (n: number, complete: boolean, first: string) => ({
      messages: Array.from({ length: n }, (_, i) => ({
        room: room('negotiation'),
        stanzaId: `${first}${i}`,
        nick: 'x',
        from: undefined,
        timestamp: '2026-10-24T09:00:00Z',
        body: '{}',
      })),
      first,
      last: undefined,
      complete,
    })
    admin.stub('mam', 'queryRoom', (_r, q) => {
      const before = typeof q === 'object' && q !== null && 'before' in q ? q.before : undefined
      return Promise.resolve(
        ok(before === undefined ? page(100, false, 'p1') : page(7, true, 'p2')),
      )
    })
    expect(await adminOps.roomMessageCount('negotiation')).toEqual({ ok: true, value: 107 })
    const changed = await adminOps.destroyRoom('negotiation', { messageCount: 100 })
    expect(changed).toMatchObject({
      ok: false,
      error: { code: 'count-changed', messageCount: 107 },
    })
    expect(ops(log)).not.toContain('admin.muc.destroyRoom')
    const done = await adminOps.destroyRoom('negotiation', { messageCount: 107 })
    expect(done).toEqual({ ok: true, value: { messageCount: 107 } })
    const counted = progress.findIndex((e) => e.step === 'count messages' && e.messageCount === 107)
    const destroyed = progress.findIndex((e) => e.step === 'destroy room' && e.state === 'done')
    expect(counted).toBeGreaterThanOrEqual(0)
    expect(destroyed).toBeGreaterThan(counted)
  })
})

describe('nodes are created before publishing', () => {
  it('creates a missing node, checks its config, then publishes', async () => {
    const { admin, ops: adminOps, log } = await rig()
    const config = gameNodeConfig('whitelist', 1)
    let created = false
    admin.stub('pubsub', 'getNodeConfig', () =>
      Promise.resolve(created ? ok(config) : err('item-not-found', 'Node not found')),
    )
    admin.stub('pubsub', 'createNode', () => {
      log.push('admin.pubsub.createNode')
      created = true
      return Promise.resolve(ok(undefined))
    })
    expect((await adminOps.publishDocument('roles:blue-co', config, 'current', '{}')).ok).toBe(true)
    expect(ops(log)).toEqual(['admin.pubsub.createNode', 'admin.pubsub.publish'])
  })

  it('does not publish when the node cannot be created', async () => {
    const { admin, ops: adminOps, log } = await rig()
    admin.stub('pubsub', 'getNodeConfig', () => Promise.resolve(err('item-not-found')))
    admin.stub('pubsub', 'createNode', () => Promise.resolve(err('forbidden')))
    expect(
      (
        await adminOps.publishDocument(
          'roles:blue-co',
          gameNodeConfig('whitelist', 1),
          'current',
          '{}',
        )
      ).ok,
    ).toBe(false)
    expect(ops(log)).not.toContain('admin.pubsub.publish')
  })

  it('reconfigures a node whose config differs (an auto-created open node)', async () => {
    const { admin, ops: adminOps } = await rig()
    const wanted = gameNodeConfig('whitelist', 1)
    let fixed = false
    admin.stub('pubsub', 'getNodeConfig', () =>
      Promise.resolve(ok(fixed ? wanted : { ...wanted, accessModel: 'open' as const })),
    )
    admin.stub('pubsub', 'configureNode', () => {
      fixed = true
      return Promise.resolve(ok(undefined))
    })
    expect(await adminOps.ensureNode('roles:blue-co', wanted)).toEqual({
      ok: true,
      value: 'updated',
    })
  })

  it('refuses names that are not WRX1 nodes', async () => {
    const { ops: adminOps } = await rig()
    const result = await adminOps.ensureNode('random', gameNodeConfig('open', 1))
    expect(result.ok ? undefined : result.error.code).toBe('invalid')
  })
})

describe('accounts and the vault', () => {
  it('a password reset writes the vault, then the server; a refusal restores the vault', async () => {
    const { admin, ops: adminOps, vault } = await rig()
    expect((await adminOps.setPassword('blue-observer', 'new-one')).ok).toBe(true)
    expect(vault?.get('blue-observer')).toBe('new-one')
    admin.stub('admin', 'changePassword', () => Promise.resolve(err('forbidden')))
    const refused = await adminOps.setPassword('blue-observer', 'newer')
    expect(refused).toMatchObject({ ok: false, error: { code: 'refused', rolledBack: true } })
    expect(vault?.get('blue-observer')).toBe('new-one')
  })

  it('a password reset of a role outside the vault leaves the vault alone', async () => {
    const { ops: adminOps, storage } = await rig()
    const before = storage.get(VAULT_STORAGE_KEY)
    expect((await adminOps.setPassword('blue-co', 'pw')).ok).toBe(true)
    expect(storage.get(VAULT_STORAGE_KEY)).toBe(before)
  })

  it('creates a read-only role with its password in the vault; an existing account is `exists`', async () => {
    const { admin, ops: adminOps, vault } = await rig()
    expect((await adminOps.createAccount('red-liaison', 'pw-1', { readOnly: true })).ok).toBe(true)
    expect(vault?.get('red-liaison')).toBe('pw-1')
    admin.stub('admin', 'addUser', () => Promise.resolve(err('conflict', 'User already exists')))
    const again = await adminOps.createAccount('red-liaison', 'pw-2', { readOnly: true })
    expect(again.ok ? undefined : again.error.code).toBe('exists')
    expect(vault?.get('red-liaison')).toBe('pw-1')
  })

  it('deleting an account treats item-not-found as deleted and removes the vault entry', async () => {
    const { admin, ops: adminOps, vault } = await rig()
    admin.stub('admin', 'deleteUser', () => Promise.resolve(err('item-not-found')))
    expect((await adminOps.deleteAccount('blue-observer')).ok).toBe(true)
    expect(vault?.has('blue-observer')).toBe(false)
  })
})

describe('reading state', () => {
  it('reads rooms with every affiliation and nodes with subscriptions', async () => {
    const { admin, ops: adminOps } = await rig()
    admin.stub('muc', 'listRooms', () => Promise.resolve(ok([room('blue-hq')])))
    admin.stub('muc', 'getAffiliations', (_r, a) =>
      Promise.resolve(
        ok(a === 'member' ? [{ jid: jid('blue-co'), affiliation: 'member' as const }] : []),
      ),
    )
    admin.stub('pubsub', 'getSubscriptions', () =>
      Promise.resolve(ok([{ jid: `${jid('blue-co')}/p`, subscription: 'subscribed' as const }])),
    )
    const state = await adminOps.readState({ rooms: ['blue-hq', 'gone'], nodes: ['roles:blue-co'] })
    expect(state).toMatchObject({
      ok: true,
      value: {
        rooms: [
          { roomId: 'blue-hq', affiliations: [{ jid: jid('blue-co'), affiliation: 'member' }] },
        ],
        nodes: [{ node: 'roles:blue-co', subscriptions: [{ jid: `${jid('blue-co')}/p` }] }],
        missingRooms: ['gone'],
        missingNodes: [],
      },
    })
  })
})
