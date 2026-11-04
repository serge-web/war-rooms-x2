// The audit scenario (WP 2.10), run against the mock (src/audit/mock.audit.test.ts) and against
// ejabberd (ejabberd-audit/audit.ejabberd.test.ts), through the real planner, executor, audit
// and repair:
//
// 1. publish `sampleDesignWithWhiteCell()` on a clean server; the audit finds nothing;
// 2. inject drift with ordinary admin and moderator operations on the test game, each a step the
//    tooling could have missed (R14): Red HQ unmoderated; Blue CO granted Red's objectives,
//    subscribed, then its affiliation removed without its subscription (R-A); Blue Observer given
//    voice back by a moderator while it is in Blue HQ (R-B); an extra account; Blue's objectives
//    node opened to `open` access; Red's force document changed; the White observer made a
//    publisher of White's objectives (F5); an edit on Blue's objectives by Blue CO, left by a
//    publisher affiliation since taken back (D21, §3 rule 14), beside White Cell's own edit
//    there, which is allowed and stays; a template the design does not have published to
//    `templates` (Annex A);
// 3. the audit finds each, with its full JID for the subscription and the stored role through
//    the vault login for the observer;
// 4. repairing everything (destructive items confirmed) leaves a clean re-audit, and the effects
//    hold for players; repairing again changes nothing (idempotent).
import { nodeName } from '@wrx/schemas'
import { sampleDesignWithWhiteCell, sampleTemplates, tid } from '@wrx/schemas/fixtures'
import type { Endpoint, Outcome, Session, Transport, TransportError } from '@wrx/transport'
import { CLOSED_SIDE_CHANNELS } from '@wrx/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminOps,
  CredentialsBook,
  ObserverVault,
  VAULT_KDF,
  VAULT_STORAGE_KEY,
  executePlan,
  planConfirmations,
  findings,
  gameRoomConfig,
  isClean,
  preparePublish,
  prepareReset,
  repairAndAudit,
  runAudit,
  targetState,
} from '../src/index.ts'
import type { AuditItem, AuditReport, ObserverVault as Vault } from '../src/index.ts'
import { mustOps } from './planner.ts'
import { changedDesign as opsChangedDesign } from './scenario.ts'
import { publishChangedDesign } from './publish-scenario.ts'

export interface AuditBackend {
  readonly name: string
  readonly transport: Transport
  readonly endpoint: Endpoint
  readonly adminPassword: string
}

const STRAY = 'stray-account'

/** A template the design does not have, as drift (Annex A). */
const STRAY_TEMPLATE = { ...sampleTemplates()[0], id: tid('stray-template'), name: 'Stray' }

function must<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: TransportError },
  what: string,
): T {
  if (result.ok) return result.value
  throw new Error(`${what}: ${result.error.condition} ${result.error.text ?? ''}`)
}

function errorOf(
  result:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: TransportError },
): TransportError | undefined {
  return result.ok ? undefined : result.error
}

export function defineAuditIntegration(backend: AuditBackend): void {
  describe(`audit and repair (${backend.name})`, () => {
    const design = sampleDesignWithWhiteCell()
    const book = new CredentialsBook('random')
    const run = Math.random().toString(36).slice(2, 8)
    const passphrase = `audit passphrase ${run}`
    const opened: Session[] = []
    let admin: Session | undefined
    let ops: AdminOps | undefined
    let vault: Vault | undefined
    let drifted: AuditReport | undefined
    let blueSubscriber: Session | undefined

    const connect = (username: string, password: string): Outcome<Session> =>
      backend.transport.connect({
        endpoint: backend.endpoint,
        credentials: { kind: 'password', username, password },
        resource: `audit-${Math.random().toString(36).slice(2, 8)}`,
      })
    const theOps = (): AdminOps => {
      if (ops === undefined) throw new Error('not set up')
      return ops
    }
    const room = (roomId: string) => theOps().roomJid(roomId)
    const login = async (roleId: string): Promise<Session> => {
      const password = book.get(roleId)?.password
      if (password === undefined) throw new Error(`no password for ${roleId}`)
      const session = must(await connect(roleId, password), `login ${roleId}`)
      opened.push(session)
      return session
    }
    const closeAll = async () => {
      await Promise.all(opened.splice(0).map((s) => s.disconnect()))
    }
    const auditOptions = () => (vault === undefined ? {} : { vault })
    const audit = async (): Promise<AuditReport> =>
      mustOps(await runAudit(theOps(), design, auditOptions()), 'audit').report
    const resetServer = async () => {
      const prepared = mustOps(await prepareReset(theOps(), auditOptions()), 'plan reset')
      const result = await executePlan(theOps(), prepared.plan, {
        passwordFor: (id) => book.passwordFor(id),
        confirmed: planConfirmations(prepared.plan),
      })
      if (!result.ok) throw new Error(`reset failed at ${result.failed?.stepId}`)
      await theOps().deleteRole(STRAY, { rooms: [], nodes: [] })
    }
    const item = (id: string): AuditItem => {
      const found = drifted?.items.find((i) => i.id === id)
      if (found === undefined) {
        throw new Error(`no ${id} in ${drifted?.items.map((i) => i.id).join(', ') ?? 'nothing'}`)
      }
      return found
    }
    const describeFindings = (report: AuditReport) =>
      findings(report).map((i) => `${i.id} [${i.found}]`)

    beforeAll(async () => {
      admin = must(await connect('admin', backend.adminPassword), 'admin login')
      must(await admin.admin.setPrivate(VAULT_STORAGE_KEY, ''), 'clear vault')
      ops = new AdminOps({
        session: admin,
        login: { transport: backend.transport, endpoint: backend.endpoint },
      })
      // Leftovers from the other scenarios on the same server use these ids too (D11).
      for (const d of [design, opsChangedDesign(), publishChangedDesign()]) {
        for (const role of d.roles) await theOps().deleteRole(role.id, { rooms: [], nodes: [] })
      }
      await resetServer()
      vault = mustOps(
        await ObserverVault.create(admin.admin, passphrase, {
          iterations: VAULT_KDF.minIterations,
        }),
        'create vault',
      )
      theOps().useVault(vault)
      const prepared = mustOps(await preparePublish(theOps(), design, { vault }), 'plan')
      const published = await executePlan(theOps(), prepared.plan, {
        passwordFor: (id) => book.passwordFor(id),
        confirmed: planConfirmations(prepared.plan),
      })
      if (!published.ok) throw new Error(`publish failed: ${published.failed?.error.message}`)
    }, 300_000)

    afterAll(async () => {
      await closeAll()
      if (ops !== undefined) await resetServer()
      await admin?.admin.setPrivate(VAULT_STORAGE_KEY, '')
      await admin?.disconnect()
    }, 300_000)

    it('1. a freshly published server audits clean, with the observer’s voice read', async () => {
      const report = await audit()
      expect(describeFindings(report)).toEqual([])
      expect(report.vault).toBe('unlocked')
      expect(report.voiceChecked).toBeGreaterThanOrEqual(1)
      expect(report.items.find((i) => i.kind === 'node-names-public')?.severity).toBe('info')
    })

    it('1b. a design that renames or reuses a published login name is refused, not audited (ADM-5, V2)', async () => {
      const renamed = {
        ...design,
        roles: design.roles.map((r) =>
          r.loginName === 'blue-co' ? { ...r, loginName: 'blue-commander' } : r,
        ),
      }
      const run = await runAudit(theOps(), renamed, auditOptions())
      expect(run.ok).toBe(false)
      if (!run.ok) expect(run.error).toMatchObject({ code: 'invalid', target: tid('blue-co') })
      // Blue CO's login name on a role of another GUID (a fresh or converted draft).
      const reused = {
        ...design,
        roles: design.roles.map((r) =>
          r.loginName === 'blue-co' ? { ...r, id: tid('blue-co-again') } : r,
        ),
        rooms: design.rooms.map((room) => ({
          ...room,
          participants: room.participants.map((p) =>
            p.id === tid('blue-co') ? { ...p, id: tid('blue-co-again') } : p,
          ),
        })),
      }
      const again = await runAudit(theOps(), reused, auditOptions())
      expect(again.ok).toBe(false)
      if (!again.ok) expect(again.error.message).toMatch(/belongs to the published role Blue CO/)
      // Nothing changed: the design itself still audits clean.
      expect(describeFindings(await audit())).toEqual([])
    })

    describe('2. drift, injected with ordinary admin and moderator operations', () => {
      beforeAll(async () => {
        const session = theOps().session
        // Red HQ unmoderated.
        must(
          await session.muc.configureRoom(room(tid('red-hq')), {
            ...gameRoomConfig('Red HQ'),
            moderated: false,
          }),
          'unmoderate red-hq',
        )
        // The negotiation room's side channels opened, with every standard field still right
        // (review F6): before, the audit compared only the standard fields and saw nothing.
        must(
          await session.muc.configureRoom(room(tid('negotiation')), {
            ...gameRoomConfig(design.rooms.find((r) => r.id === tid('negotiation'))?.name ?? ''),
            visitorPrivateMessages: 'anyone',
            subscriptions: true,
          }),
          'open the side channels of negotiation',
        )
        // A revoked reader keeps its subscription: Blue CO reads Red's objectives, subscribes,
        // and only its affiliation is removed (the missed R-A step).
        must(
          await session.pubsub.setAffiliations(nodeName.objectives(tid('red')), [
            { jid: theOps().roleJid('blue-co'), affiliation: 'member' },
          ]),
          'grant blue-co',
        )
        blueSubscriber = await login('blue-co')
        must(await blueSubscriber.pubsub.subscribe(nodeName.objectives(tid('red'))), 'subscribe')
        must(
          await session.pubsub.setAffiliations(nodeName.objectives(tid('red')), [
            { jid: theOps().roleJid('blue-co'), affiliation: 'none' },
          ]),
          'revoke blue-co, leaving the subscription',
        )
        // The observer given voice back by a moderator while it is in the room (R-B).
        const observer = await login('blue-observer')
        must(await session.muc.join(room(tid('blue-hq')), 'admin'), 'admin joins blue-hq')
        const joined = must(await observer.muc.join(room(tid('blue-hq')), 'blue-observer'), 'join')
        expect(joined.role).toBe('visitor')
        must(
          await session.muc.setRole(room(tid('blue-hq')), 'blue-observer', 'participant', 'drift'),
          'voice the observer',
        )
        must(await observer.muc.leave(room(tid('blue-hq'))), 'observer leaves')
        must(await session.muc.leave(room(tid('blue-hq'))), 'admin leaves')
        await observer.disconnect()
        // An account that is no role.
        must(await session.admin.addUser(theOps().roleJid(STRAY), `pw-${run}`), 'extra account')
        // Blue's objectives opened to anyone.
        const objectives = targetState(design).nodes.find(
          (n) => n.node === nodeName.objectives(tid('blue')),
        )
        if (objectives === undefined)
          throw new Error(`no ${nodeName.objectives(tid('blue'))} in the target`)
        must(
          await session.pubsub.configureNode(nodeName.objectives(tid('blue')), {
            ...objectives.config,
            accessModel: 'open',
          }),
          `open ${nodeName.objectives(tid('blue'))}`,
        )
        // Red's force document changed.
        const red = design.forces.find((f) => f.id === 'red')
        must(
          await session.pubsub.publish(
            nodeName.force(tid('red')),
            'current',
            JSON.stringify({ ...red, name: 'Tampered' }),
          ),
          `change ${nodeName.force(tid('red'))}`,
        )
        // The White observer a publisher of White's objectives (review F5, D21).
        must(
          await session.pubsub.setAffiliations(nodeName.objectives(tid('white')), [
            { jid: theOps().roleJid('white-observer'), affiliation: 'publisher' },
          ]),
          'the White observer publishes objectives',
        )
        // White Cell edits Blue's objectives during play, as it may (§3 rule 14): not drift.
        const objectivesOf = (force: string, markdown: string) =>
          JSON.stringify({
            schemaVersion: 1,
            forceId: tid(force),
            markdown,
            updatedAt: '2026-10-30T09:00:00.000Z',
          })
        const cell = await login('white-cell')
        must(
          await cell.pubsub.publish(
            nodeName.objectives(tid('blue')),
            'white-cell-e1',
            objectivesOf('blue', 'Umpire’s amendment'),
          ),
          'White Cell edits Blue’s objectives',
        )
        // An edit by Blue CO, which may not publish there: it was made a publisher, wrote, and
        // was set back to member, leaving its item (§3 rule 14: only the White Force's stay).
        must(
          await session.pubsub.setAffiliations(nodeName.objectives(tid('blue')), [
            { jid: theOps().roleJid('blue-co'), affiliation: 'publisher' },
          ]),
          'Blue CO publishes, for a moment',
        )
        must(
          await (
            await login('blue-co')
          ).pubsub.publish(
            nodeName.objectives(tid('blue')),
            'blue-co-e1',
            objectivesOf('blue', 'Our own version'),
          ),
          'Blue CO edits its objectives',
        )
        must(
          await session.pubsub.setAffiliations(nodeName.objectives(tid('blue')), [
            { jid: theOps().roleJid('blue-co'), affiliation: 'member' },
          ]),
          'Blue CO back to member',
        )
        // A template the design does not have, published by hand (Annex A).
        must(
          await session.pubsub.publish(
            'templates',
            STRAY_TEMPLATE.id,
            JSON.stringify(STRAY_TEMPLATE),
          ),
          'publish a stray template',
        )
        drifted = await audit()
      }, 300_000)

      it('finds the White observer publishing objectives, and Blue CO’s edit, not White Cell’s (D21)', () => {
        expect(
          item(`node-access:${nodeName.objectives(tid('white'))}:white-observer`),
        ).toMatchObject({
          severity: 'critical',
          expected: 'member',
          found: 'publisher',
        })
        expect(item(`stray-items:${nodeName.objectives(tid('blue'))}:blue-co-e1`)).toMatchObject({
          severity: 'medium',
          repairable: true,
          repair: [
            { type: 'retract-item', node: nodeName.objectives(tid('blue')), itemId: 'blue-co-e1' },
          ],
        })
        const flagged = (drifted?.items ?? []).map((i) => i.id)
        expect(flagged.some((id) => id.includes('white-cell-e1'))).toBe(false)
      })

      it('finds the unmoderated room', () => {
        expect(item(`room-config:${tid('red-hq')}`)).toMatchObject({
          severity: 'critical',
          found: 'moderated: false',
        })
      })

      it('finds the opened side channels of a room that is otherwise right (F6)', () => {
        expect(item(`room-config:${tid('negotiation')}`)).toMatchObject({
          severity: 'critical',
          expected: 'visitorPrivateMessages: nobody, subscriptions: false',
          found: 'visitorPrivateMessages: anyone, subscriptions: true',
        })
      })

      it('finds the leftover subscription, by full JID', () => {
        const jid = blueSubscriber?.jid ?? ''
        expect(jid).toContain('/')
        expect(item(`subscription:${nodeName.objectives(tid('red'))}:${jid}`)).toMatchObject({
          severity: 'critical',
          roleId: 'blue-co',
          target: jid,
        })
      })

      it('finds the observer’s voice, through its own login', () => {
        expect(item(`voice:blue-observer:${tid('blue-hq')}`)).toMatchObject({
          kind: 'voice',
          severity: 'critical',
          found: 'participant: can post',
        })
      })

      it('finds the White observer voiced by the unmoderated Red HQ (§3 rule 4, F5)', () => {
        // Unmoderated, the room gives every member voice, so the White observer, which reads
        // every room, could post there.
        expect(item(`voice:white-observer:${tid('red-hq')}`)).toMatchObject({
          kind: 'voice',
          severity: 'critical',
          found: 'participant: can post',
        })
      })

      it('finds the extra account', () => {
        expect(item(`account-unknown:${STRAY}`)).toMatchObject({ destructive: true })
      })

      it('finds the opened node', () => {
        expect(item(`node-config:${nodeName.objectives(tid('blue'))}`)).toMatchObject({
          severity: 'critical',
          found: 'accessModel: open',
        })
      })

      it('finds the template the design does not have (Annex A)', () => {
        expect(item(`stray-items:templates:${STRAY_TEMPLATE.id}`)).toMatchObject({
          severity: 'low',
          destructive: true,
          repair: [{ type: 'retract-item', node: 'templates', itemId: STRAY_TEMPLATE.id }],
        })
      })

      it('finds the changed document', () => {
        expect(item(`document:${nodeName.force(tid('red'))}:current`)).toMatchObject({
          found: 'differs',
        })
      })

      it('finds nothing else', () => {
        const kinds = drifted === undefined ? [] : findings(drifted).map((i) => i.kind)
        expect(kinds.sort()).toEqual([
          'account-unknown',
          'document',
          'node-access',
          'node-config',
          'room-config',
          'room-config',
          'stray-items',
          'stray-items',
          'subscription',
          'voice',
          'voice',
        ])
      })
    })

    describe('3. repair', () => {
      let after: AuditReport | undefined

      beforeAll(async () => {
        const report = drifted ?? (await audit())
        const repairable = report.items.filter((i) => i.repairable)
        const result = mustOps(
          await repairAndAudit(theOps(), design, repairable, {
            confirmed: new Set(repairable.filter((i) => i.destructive).map((i) => i.id)),
            passwordFor: (id) => book.passwordFor(id),
            audit: auditOptions(),
          }),
          'repair',
        )
        if (!result.repair.ok) {
          throw new Error(
            `repair failed: ${result.repair.failed.map((f) => `${f.itemId}: ${f.error.message}`).join('; ')}`,
          )
        }
        after = result.after
      }, 300_000)

      it('the re-audit is clean', () => {
        expect(after === undefined ? ['no re-audit'] : describeFindings(after)).toEqual([])
        expect(after !== undefined && isClean(after)).toBe(true)
      })

      it('the observer is read-only again; Red HQ is moderated', async () => {
        const observer = await login('blue-observer')
        const joined = must(await observer.muc.join(room(tid('blue-hq')), 'blue-observer'), 'join')
        expect(joined.role).toBe('visitor')
        const posted = await observer.muc.send(room(tid('blue-hq')), JSON.stringify({ text: run }))
        expect(errorOf(posted)?.condition).toBe('forbidden')
        const config = must(await theOps().session.muc.getRoomConfig(room(tid('red-hq'))), 'config')
        expect(config.moderated).toBe(true)
        const negotiation = must(
          await theOps().session.muc.getRoomConfig(room(tid('negotiation'))),
          'negotiation config',
        )
        expect(negotiation).toMatchObject(CLOSED_SIDE_CHANNELS)
      })

      it('Blue CO no longer receives or reads Red’s objectives', async () => {
        const subs = must(
          await theOps().session.pubsub.getSubscriptions(nodeName.objectives(tid('red'))),
          'subscriptions',
        )
        expect(subs.filter((s) => s.jid.startsWith(theOps().roleJid('blue-co')))).toEqual([])
        const blue = await login('blue-co')
        expect(errorOf(await blue.pubsub.getItems(nodeName.objectives(tid('red'))))).toBeDefined()
      })

      it('the extra account is gone, Blue’s objectives are closed, Red’s document restored', async () => {
        const stray = await connect(STRAY, `pw-${run}`)
        expect(errorOf(stray)?.condition).toBe('not-authorized')
        if (stray.ok) await stray.value.disconnect()
        const anonymous = await backend.transport.connect({
          endpoint: backend.endpoint,
          credentials: { kind: 'anonymous' },
        })
        const anon = must(anonymous, 'anonymous login')
        opened.push(anon)
        expect(errorOf(await anon.pubsub.getItems(nodeName.objectives(tid('blue'))))).toBeDefined()
        const items = must(
          await theOps().session.pubsub.getItems(nodeName.force(tid('red'))),
          nodeName.force(tid('red')),
        )
        expect(JSON.parse(items[0]?.payload ?? '{}')).toMatchObject({ name: 'Red' })
      })

      it('the stray template is gone (Annex A)', async () => {
        const ids = must(await theOps().session.pubsub.getItems('templates'), 'templates').map(
          (i) => i.id,
        )
        expect(ids).not.toContain(STRAY_TEMPLATE.id)
      })

      it('Blue’s objectives keep the admin’s item and White Cell’s edit, newest last; the observer cannot publish (D21)', async () => {
        const items = must(
          await theOps().session.pubsub.getItems(nodeName.objectives(tid('blue'))),
          nodeName.objectives(tid('blue')),
        )
        expect(items.map((i) => i.publisher)).toEqual([
          theOps().roleJid('admin'),
          theOps().roleJid('white-cell'),
        ])
        expect(items.at(-1)?.id).toBe('white-cell-e1')
        const observer = await login('white-observer')
        expect(
          errorOf(
            await observer.pubsub.publish(nodeName.objectives(tid('white')), 'white-obs-1', '{}'),
          )?.condition,
        ).toBe('forbidden')
      })

      it('repairing again changes nothing (idempotent)', async () => {
        const report = drifted ?? (await audit())
        const again = mustOps(
          await repairAndAudit(
            theOps(),
            design,
            report.items.filter((i) => i.repairable && !i.destructive),
            { passwordFor: (id) => book.passwordFor(id), audit: auditOptions() },
          ),
          'repair again',
        )
        expect(again.repair.ok).toBe(true)
        expect(describeFindings(again.after)).toEqual([])
      })

      afterAll(closeAll)
    })
  })
}
