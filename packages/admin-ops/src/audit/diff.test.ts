// Unit tests of the audit's comparison over hand-built server views (the planner's fixtures):
// a fully published server is clean, and each kind of drift is one item with the right
// severity and repair.
import type { DesignFile } from '@wrx/schemas'
import { sampleDesign } from '@wrx/schemas/fixtures'
import { describe, expect, it } from 'vitest'
import { DOMAIN, jid, publishedView, withNode } from '../publish/fixtures.ts'
import type { ServerView } from '../publish/view.ts'
import { diffAudit, voiceChecks } from './diff.ts'
import type { AuditInput, VoiceReading } from './diff.ts'
import { findings, isClean } from './types.ts'
import type { AuditItem, AuditReport } from './types.ts'

const design = sampleDesign()
const ROLES = design.roles.map((r) => jid(r.id))

/** Every voice check answered as the design wants. */
function goodVoice(view: ServerView): VoiceReading[] {
  return voiceChecks(design, view).checks.map((c) => ({
    ...c,
    role: c.expect === 'visitor' ? 'visitor' : 'participant',
  }))
}

function audit(view: ServerView, input: Partial<AuditInput> = {}, d: DesignFile = design) {
  return diffAudit(d, {
    view,
    registered: [jid('admin'), ...ROLES],
    voice: goodVoice(view),
    messageCounts: new Map(),
    ...input,
  })
}

function item(report: AuditReport, id: string): AuditItem {
  const found = report.items.find((i) => i.id === id)
  if (found === undefined) {
    throw new Error(`no item ${id} in ${report.items.map((i) => i.id).join(', ')}`)
  }
  return found
}

describe('a server that matches the design', () => {
  const view = publishedView(design)
  const report = audit(view)

  it('has no findings, only the ADM-42 notice and the unchecked writers', () => {
    expect(isClean(report)).toBe(true)
    expect(report.items.map((i) => i.kind).sort()).toEqual([
      'node-names-public',
      'writers-unchecked',
    ])
    expect(report.vault).toBe('unlocked')
    expect(report.voiceChecked).toBe(1)
  })

  it('reads the observer’s stored role, and writers only when the vault has their password', () => {
    expect(voiceChecks(design, view).checks).toEqual([
      { roleId: 'blue-observer', roomId: 'blue-hq', expect: 'visitor' },
    ])
    const withWriter = { ...view, vault: { exists: true, roles: ['blue-observer', 'blue-co'] } }
    expect(voiceChecks(design, withWriter).checks).toContainEqual({
      roleId: 'blue-co',
      roomId: 'blue-hq',
      expect: 'voice',
    })
  })

  it('warns that anyone can list node names (ADM-42), as information only', () => {
    const notice = item(report, 'node-names-public')
    expect(notice).toMatchObject({ severity: 'info', repairable: false })
    expect(notice.found).toMatch(/listable by anyone/)
  })
})

describe('drift', () => {
  const view = publishedView(design)

  it('an unmoderated room is critical, repaired by ensuring the room', () => {
    const drifted = {
      ...view,
      rooms: view.rooms.map((r) =>
        r.roomId === 'blue-hq' ? { ...r, config: { ...r.config, moderated: false } } : r,
      ),
    }
    const found = item(audit(drifted), 'room-config:blue-hq')
    expect(found).toMatchObject({
      kind: 'room-config',
      severity: 'critical',
      expected: 'moderated: true',
      found: 'moderated: false',
      repairable: true,
      destructive: false,
      repair: [{ type: 'ensure-room', roomId: 'blue-hq', name: 'Blue HQ', create: false }],
    })
  })

  it('a subscription left on a revoked reader is one item per full JID (R-A)', () => {
    const drifted = withNode(view, 'objectives:red', (n) => ({
      ...n,
      subscriptions: [
        { jid: `${jid('blue-co')}/pane-1`, subscription: 'subscribed' },
        { jid: `${jid('blue-co')}/pane-2`, subscription: 'subscribed' },
        { jid: `${jid('red-co')}/pane-1`, subscription: 'subscribed' },
      ],
    }))
    const report = audit(drifted)
    const subs = report.items.filter((i) => i.kind === 'subscription')
    expect(subs.map((i) => i.target)).toEqual([
      `${jid('blue-co')}/pane-1`,
      `${jid('blue-co')}/pane-2`,
    ])
    expect(subs[0]).toMatchObject({
      severity: 'critical',
      roleId: 'blue-co',
      repair: [
        {
          type: 'node-access',
          node: 'objectives:red',
          changes: [{ roleId: 'blue-co', access: 'none' }],
        },
      ],
    })
    // The affiliation itself is right, so there is no node-access item.
    expect(report.items.some((i) => i.id === 'node-access:objectives:red:blue-co')).toBe(false)
  })

  it('a reader left on a whitelist is a node-access item', () => {
    const drifted = withNode(view, 'objectives:red', (n) => ({
      ...n,
      affiliations: [...n.affiliations, { jid: jid('blue-co'), affiliation: 'member' }],
    }))
    expect(item(audit(drifted), 'node-access:objectives:red:blue-co')).toMatchObject({
      expected: 'none',
      found: 'member',
      severity: 'critical',
    })
  })

  it('an owner affiliation the planner does not model is still found', () => {
    const drifted = withNode(view, 'objectives:red', (n) => ({
      ...n,
      affiliations: [...n.affiliations, { jid: jid('blue-co'), affiliation: 'owner' }],
    }))
    expect(item(audit(drifted), 'node-access:objectives:red:blue-co')).toMatchObject({
      found: 'owner',
      severity: 'critical',
      repair: [{ type: 'node-access', changes: [{ roleId: 'blue-co', access: 'none' }] }],
    })
  })

  it('an observer that joins with voice is critical, repaired through its own login', () => {
    const voice: VoiceReading[] = [
      { roleId: 'blue-observer', roomId: 'blue-hq', expect: 'visitor', role: 'participant' },
    ]
    expect(item(audit(view, { voice }), 'voice:blue-observer:blue-hq')).toMatchObject({
      kind: 'voice',
      severity: 'critical',
      found: 'participant: can post',
      repair: [{ type: 'read-only', roleId: 'blue-observer', roomIds: ['blue-hq'] }],
    })
  })

  it('a writer left a visitor (the missing `from` hint) is restored read to write', () => {
    const withWriter = { ...view, vault: { exists: true, roles: ['blue-observer', 'blue-co'] } }
    const voice: VoiceReading[] = [
      ...goodVoice(withWriter).filter((r) => r.roleId !== 'blue-co'),
      { roleId: 'blue-co', roomId: 'blue-hq', expect: 'voice', role: 'visitor' },
    ]
    expect(item(audit(withWriter, { voice }), 'voice:blue-co:blue-hq')).toMatchObject({
      severity: 'medium',
      repair: [
        {
          type: 'room-access',
          roomId: 'blue-hq',
          changes: [{ roleId: 'blue-co', access: 'write', from: 'read' }],
        },
      ],
    })
  })

  it('a locked vault leaves the observer unchecked and asks for the unlock', () => {
    const locked = { ...view, vault: { exists: true } }
    const voice: VoiceReading[] = [
      { roleId: 'blue-observer', roomId: 'blue-hq', expect: 'visitor', problem: 'vault-locked' },
    ]
    const report = audit(locked, { voice })
    expect(report.vault).toBe('locked')
    expect(item(report, 'voice:blue-observer:blue-hq')).toMatchObject({
      kind: 'voice-unchecked',
      severity: 'high',
      repairable: false,
    })
  })

  it('a refused vault password offers a confirmed password reset, then the revocation', () => {
    const voice: VoiceReading[] = [
      { roleId: 'blue-observer', roomId: 'blue-hq', expect: 'visitor', problem: 'login-failed' },
    ]
    expect(item(audit(view, { voice }), 'voice:blue-observer:blue-hq')).toMatchObject({
      destructive: true,
      repair: [
        { type: 'reset-password', roleId: 'blue-observer', readOnly: true },
        { type: 'read-only', roleId: 'blue-observer', roomIds: ['blue-hq'] },
      ],
    })
  })

  it('an extra account is destructive to repair; a missing one is created', () => {
    const report = audit(view, {
      registered: [jid('admin'), ...ROLES.filter((j) => j !== jid('red-co')), jid('intruder')],
    })
    expect(item(report, 'account-unknown:intruder')).toMatchObject({
      severity: 'high',
      destructive: true,
      repair: [{ type: 'delete-role', roleId: 'intruder', rooms: [], nodes: [] }],
    })
    expect(item(report, 'account-missing:red-co')).toMatchObject({
      destructive: false,
      repair: [{ type: 'create-account', roleId: 'red-co', readOnly: false }],
    })
  })

  it('an account whose name is no role id is reported but not deleted', () => {
    const report = audit(view, { registered: [jid('admin'), ...ROLES, `Bob.Smith@${DOMAIN}`] })
    expect(item(report, `account-unknown:bob.smith@${DOMAIN}`)).toMatchObject({
      repairable: false,
    })
  })

  it('a stray affiliation of a deleted role is removed without touching an account', () => {
    const drifted = {
      ...view,
      rooms: view.rooms.map((r) =>
        r.roomId === 'red-hq'
          ? {
              ...r,
              affiliations: [
                ...r.affiliations,
                { jid: jid('ghost'), affiliation: 'member' as const },
              ],
            }
          : r,
      ),
    }
    expect(item(audit(drifted), 'stray-access:ghost')).toMatchObject({
      severity: 'high',
      destructive: false,
      repair: [{ type: 'delete-role', roleId: 'ghost', rooms: ['red-hq'], nodes: [] }],
    })
  })

  it('a membership the design does not give is critical; a missing one medium', () => {
    const drifted = {
      ...view,
      rooms: view.rooms.map((r) =>
        r.roomId === 'red-hq'
          ? {
              ...r,
              affiliations: [
                ...r.affiliations,
                { jid: jid('blue-co'), affiliation: 'member' as const },
              ],
            }
          : r.roomId === 'blue-hq'
            ? { ...r, affiliations: r.affiliations.filter((a) => a.jid !== jid('blue-observer')) }
            : r,
      ),
    }
    const report = audit(drifted)
    expect(item(report, 'room-access:red-hq:blue-co')).toMatchObject({
      severity: 'critical',
      repair: [
        {
          type: 'room-access',
          roomId: 'red-hq',
          changes: [{ roleId: 'blue-co', access: 'none', from: 'none' }],
        },
      ],
    })
    expect(item(report, 'room-access:blue-hq:blue-observer')).toMatchObject({
      severity: 'medium',
      repair: [{ type: 'read-only', roleId: 'blue-observer', roomIds: ['blue-hq'] }],
    })
  })

  it('a role made a room admin is critical, and set back to member', () => {
    const drifted = {
      ...view,
      rooms: view.rooms.map((r) =>
        r.roomId === 'red-hq'
          ? {
              ...r,
              affiliations: r.affiliations.map((a) =>
                a.jid === jid('red-co') ? { ...a, affiliation: 'admin' as const } : a,
              ),
            }
          : r,
      ),
    }
    expect(item(audit(drifted), 'room-access:red-hq:red-co')).toMatchObject({
      found: 'admin',
      severity: 'critical',
    })
  })

  it('a node opened to `open` access is critical', () => {
    const drifted = withNode(view, 'objectives:blue', (n) => ({
      ...n,
      config: { ...n.config, accessModel: 'open' },
    }))
    expect(item(audit(drifted), 'node-config:objectives:blue')).toMatchObject({
      severity: 'critical',
      expected: 'accessModel: whitelist',
      found: 'accessModel: open',
    })
  })

  it('a changed document is republished as in the design', () => {
    const drifted = withNode(view, 'forces:blue', (n) => ({
      ...n,
      items: n.items.map((i) => ({ ...i, payload: JSON.stringify({ tampered: true }) })),
    }))
    const found = item(audit(drifted), 'document:forces:blue:current')
    expect(found).toMatchObject({ severity: 'medium', found: 'differs' })
    expect(found.repair[0]).toMatchObject({
      type: 'publish',
      node: 'forces:blue',
      itemId: 'current',
    })
  })

  it('game-setup is compared without its version and republished at the server’s version', () => {
    const drifted = withNode(view, 'game-setup', (n) => ({
      ...n,
      items: [
        {
          id: 'current',
          payload: JSON.stringify({ ...design.game, designVersion: 4, name: 'Renamed' }),
          publisher: jid('admin'),
        },
      ],
    }))
    const report = audit(drifted)
    const found = item(report, 'document:game-setup:current')
    const action = found.repair[0]
    expect(action?.type === 'publish' ? JSON.parse(action.payload) : undefined).toMatchObject({
      name: design.game.name,
      designVersion: 4,
    })
    expect(item(report, 'design-version').severity).toBe('info')
  })

  it('a room not in the design is destroyed only with its message count', () => {
    const extra = {
      ...view,
      rooms: [
        ...view.rooms,
        { roomId: 'old-room', config: view.rooms[0]!.config, affiliations: [] },
      ],
    }
    expect(item(audit(extra), 'room-extra:old-room')).toMatchObject({ repairable: false })
    expect(
      item(audit(extra, { messageCounts: new Map([['old-room', 7]]) }), 'room-extra:old-room'),
    ).toMatchObject({
      destructive: true,
      repair: [{ type: 'destroy-room', roomId: 'old-room', messageCount: 7 }],
    })
  })

  it('a JID that is no role account is critical and left to the server’s tools', () => {
    const drifted = withNode(view, 'objectives:blue', (n) => ({
      ...n,
      subscriptions: [{ jid: 'spy@elsewhere.example/x', subscription: 'subscribed' }],
    }))
    expect(
      item(audit(drifted), 'foreign-access:objectives:blue:spy@elsewhere.example/x'),
    ).toMatchObject({ severity: 'critical', repairable: false })
  })

  it('anonymous subscriptions to open nodes are expected (D20)', () => {
    const drifted = withNode(view, 'game-setup', (n) => ({
      ...n,
      subscriptions: [{ jid: 'anon-1@elsewhere.example/x', subscription: 'subscribed' }],
    }))
    expect(isClean(audit(drifted))).toBe(true)
  })

  it('lists the most severe first', () => {
    const drifted = withNode(
      {
        ...view,
        rooms: view.rooms.map((r) =>
          r.roomId === 'blue-hq' ? { ...r, config: { ...r.config, name: 'Renamed' } } : r,
        ),
      },
      'objectives:blue',
      (n) => ({ ...n, config: { ...n.config, accessModel: 'open' } }),
    )
    const severities = findings(audit(drifted)).map((i) => i.severity)
    expect(severities).toEqual(['critical', 'low'])
  })
})
