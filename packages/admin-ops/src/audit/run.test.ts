// Unit tests of reading the audit and repairing it, against FakeSession (the `rig` of the AdminOps
// tests): what is read, that reading changes nothing, the stored role read through the role's
// own login, and repairs: order, deduplication, confirmation, failures, and the re-audit.
import { sampleDesign } from '@wrx/schemas/fixtures'
import { err, ok } from '@wrx/transport'
import type { AffiliationEntry, MucAffiliation } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { DOMAIN, MUC, ops, rig } from '../fixtures.ts'
import { publishedView } from '../publish/fixtures.ts'
import type { Rig } from '../fixtures.ts'
import { diffAudit, repairAndAudit, repairItems, runAudit } from './index.ts'
import type { AuditItem, AuditProgress } from './index.ts'

const jid = (id: string) => `${id}@${DOMAIN}`

/** A design with only Blue: one writer, the observer, and Blue HQ. */
function blueOnly() {
  const base = sampleDesign()
  return {
    ...base,
    forces: base.forces.filter((f) => f.id === 'blue'),
    roles: base.roles.filter((r) => r.forceId === 'blue'),
    rooms: base.rooms.filter((r) => r.id === 'blue-hq'),
    objectives: base.objectives.filter((o) => o.forceId === 'blue'),
    assets: [],
    game: { ...base.game, theme: { tokens: {} } },
  }
}

/** The admin sees Blue HQ, with both Blue roles as members, and these accounts. */
function serve(r: Rig, accounts: readonly string[]): void {
  r.admin.stub('muc', 'listRooms', () => Promise.resolve(ok([`blue-hq@${MUC}`])))
  r.admin.stub('muc', 'getAffiliations', (_room, affiliation) => {
    const lists: Partial<Record<MucAffiliation, AffiliationEntry[]>> = {
      owner: [{ jid: jid('admin'), affiliation: 'owner' }],
      member: [
        { jid: jid('blue-co'), affiliation: 'member' },
        { jid: jid('blue-observer'), affiliation: 'member' },
      ],
    }
    return Promise.resolve(ok(lists[affiliation as MucAffiliation] ?? []))
  })
  r.admin.stub('admin', 'registeredUsers', () => Promise.resolve(ok(accounts.map(jid))))
}

const WRITES = /\.(set|create|configure|destroy|delete|publish|add|change|retract)/

describe('runAudit', () => {
  it('reads the server, the accounts and the stored roles, and changes nothing', async () => {
    const r = await rig()
    serve(r, ['admin', 'blue-co', 'blue-observer', 'ghost'])
    const progress: AuditProgress[] = []
    const run = await runAudit(r.ops, blueOnly(), {
      ...(r.vault === undefined ? {} : { vault: r.vault }),
      onProgress: (p) => progress.push(p),
    })
    if (!run.ok) throw new Error(run.error.message)
    const report = run.value.report
    // The rig's role joins as a participant until the admin sets it to visitor.
    expect(report.items.find((i) => i.id === 'voice:blue-observer:blue-hq')).toMatchObject({
      kind: 'voice',
      severity: 'critical',
    })
    expect(report.items.some((i) => i.id === 'account-unknown:ghost')).toBe(true)
    expect(report.items.some((i) => i.kind === 'node-missing')).toBe(true)
    expect(r.logins).toEqual(['blue-observer:observer-password'])
    expect(r.log.filter((l) => l.startsWith('role.'))).toEqual([
      `role.muc.join ${JSON.stringify([`blue-hq@${MUC}`, 'blue-observer'])}`,
      `role.muc.leave ${JSON.stringify([`blue-hq@${MUC}`])}`,
      'role.disconnect',
    ])
    expect(r.log.filter((l) => l.startsWith('admin.') && WRITES.test(l))).toEqual([])
    expect(progress.map((p) => p.phase)).toEqual(
      expect.arrayContaining(['server', 'accounts', 'voice']),
    )
  })

  it('without the vault, reports the observer unchecked and the vault locked', async () => {
    const r = await rig()
    serve(r, ['admin', 'blue-co', 'blue-observer'])
    const run = await runAudit(r.ops, blueOnly())
    if (!run.ok) throw new Error(run.error.message)
    expect(run.value.report.vault).toBe('locked')
    expect(run.value.report.items.find((i) => i.roleId === 'blue-observer')).toMatchObject({
      kind: 'voice-unchecked',
      found: 'not checked: the vault is locked',
    })
    expect(r.logins).toEqual([])
  })

  it('fails only when the server cannot be read', async () => {
    const r = await rig()
    serve(r, [])
    r.admin.stub('admin', 'registeredUsers', () => Promise.resolve(err('forbidden')))
    const run = await runAudit(r.ops, blueOnly())
    expect(run).toMatchObject({ ok: false, error: { code: 'refused', step: 'registered users' } })
  })
})

describe('repair', () => {
  const passwordFor = (id: string) => `new-${id}`

  it('revokes the observer’s voice through its login, and the re-audit finds it a visitor', async () => {
    const r = await rig()
    serve(r, ['admin', 'blue-co', 'blue-observer'])
    const vault = r.vault === undefined ? {} : { vault: r.vault }
    const first = await runAudit(r.ops, blueOnly(), vault)
    if (!first.ok) throw new Error(first.error.message)
    const voice = first.value.report.items.filter((i) => i.kind === 'voice')
    r.log.length = 0
    const result = await repairAndAudit(r.ops, blueOnly(), voice, { passwordFor, audit: vault })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.repair).toMatchObject({ ok: true, done: ['voice:blue-observer:blue-hq'] })
    expect(ops(r.log)).toContain('admin.muc.setRole')
    expect(result.value.after.items.some((i) => i.kind === 'voice')).toBe(false)
  })

  it('runs each action once, in the planner’s order, and skips unconfirmed destructive items', async () => {
    const r = await rig()
    const items: AuditItem[] = [
      {
        id: 'account-unknown:ghost',
        kind: 'account-unknown',
        target: 'ghost',
        roleId: 'ghost',
        expected: '',
        found: '',
        severity: 'high',
        repairable: true,
        destructive: true,
        repair: [{ type: 'delete-role', roleId: 'ghost', rooms: [], nodes: [] }],
      },
      ...['pane-1', 'pane-2'].map((pane): AuditItem => ({
        id: `subscription:objectives:red:${pane}`,
        kind: 'subscription',
        target: `${jid('blue-co')}/${pane}`,
        roleId: 'blue-co',
        expected: '',
        found: '',
        severity: 'critical',
        repairable: true,
        destructive: false,
        repair: [
          {
            type: 'node-access',
            node: 'objectives:red',
            changes: [{ roleId: 'blue-co', access: 'none' }],
          },
        ],
      })),
      {
        id: 'room-missing:blue-hq',
        kind: 'room-missing',
        target: 'blue-hq',
        expected: '',
        found: '',
        severity: 'high',
        repairable: true,
        destructive: false,
        repair: [{ type: 'ensure-room', roomId: 'blue-hq', name: 'Blue HQ', create: true }],
      },
    ]
    const events: string[] = []
    const unconfirmed = await repairItems(r.ops, items, {
      passwordFor,
      onItem: (e) => events.push(`${e.itemId} ${e.state}`),
    })
    expect(unconfirmed.skipped).toEqual([
      { itemId: 'account-unknown:ghost', reason: 'not confirmed' },
    ])
    expect(ops(r.log)).not.toContain('admin.admin.deleteUser')
    // The room before the node revocation (rooms, then revokes), and the revocation once.
    const order = ops(r.log)
    expect(order.indexOf('admin.muc.createRoom')).toBeLessThan(
      order.indexOf('admin.pubsub.setAffiliations'),
    )
    expect(order.filter((o) => o === 'admin.pubsub.setAffiliations')).toHaveLength(1)
    expect(events).toContain('subscription:objectives:red:pane-2 done')

    r.log.length = 0
    const confirmed = await repairItems(r.ops, items.slice(0, 1), {
      passwordFor,
      confirmed: new Set(['account-unknown:ghost']),
    })
    expect(confirmed.ok).toBe(true)
    expect(ops(r.log)).toContain('admin.admin.deleteUser')
  })

  it('an account-missing repair never resets an account that exists (security review F3)', async () => {
    const design = sampleDesign()
    const view = publishedView(design, {
      registered: [
        jid('admin'),
        ...design.roles.map((r) => jid(r.id)).filter((j) => j !== jid('blue-co')),
      ],
    })
    const report = diffAudit(design, {
      view,
      registered: view.registered,
      voice: [],
      messageCounts: new Map(),
    })
    const item = report.items.find((i) => i.id === 'account-missing:blue-co')
    if (item === undefined) throw new Error('no account-missing item')
    const r = await rig()
    // The account exists after all (made since the audit, or hidden from the listing).
    r.admin.stub('admin', 'addUser', () => Promise.resolve(err('conflict', 'exists')))
    const result = await repairItems(r.ops, [item], { passwordFor, confirmed: new Set() })
    expect(result.failed).toMatchObject([{ itemId: item.id, error: { code: 'exists' } }])
    expect(ops(r.log)).not.toContain('admin.admin.changePassword')
    expect(result.passwordsSet).toEqual([])
  })

  it('a failed repair does not stop the others', async () => {
    const r = await rig()
    r.admin.stub('pubsub', 'getNodeConfig', () => Promise.resolve(err('forbidden')))
    const base = sampleDesign()
    const report = diffAudit(base, {
      view: {
        domain: DOMAIN,
        rooms: [],
        nodes: [],
        online: [],
        vault: { exists: false },
        marker: undefined,
        registered: [],
      },
      registered: [],
      voice: [],
      messageCounts: new Map(),
    })
    const pick = report.items.filter(
      (i) => i.id === 'node-missing:forces:blue' || i.id === 'account-missing:blue-co',
    )
    const result = await repairItems(r.ops, pick, { passwordFor })
    expect(result.failed.map((f) => f.itemId)).toEqual(['node-missing:forces:blue'])
    expect(result.done).toEqual(['account-missing:blue-co'])
    expect(result.passwordsSet).toEqual(['blue-co'])
  })
})
