// The contract suite (WP 1.2, §11): one set of tests that defines how the transport behaves.
// `defineContractSuite` is called from a test file with a backend; the same checks run against
// ejabberd and, from WP 1.4, against the mock (NFR-16, ARC-10, ARC-11).
//
// Each check cites the XEP section it exercises and the spike check it ports (serge-web/
// xmpp-spike @ 4992530, spike/tests/checks/*). Tests tagged `r1` are the R1 gate that every
// ejabberd upgrade must pass (NFR-22): S01, S01b and C01.
import type { Outcome, Session } from '@wrx/transport'
import { afterAll, afterEach, describe } from 'vitest'
import type { ContractBackend, Login } from './backend.ts'
import { c01 } from './checks/c01-admin-tooling.ts'
import { errors } from './checks/errors.ts'
import { ordering } from './checks/ordering.ts'
import { recovery } from './checks/recovery.ts'
import { s00 } from './checks/s00-connectivity.ts'
import { s01 } from './checks/s01-read-only.ts'
import { s01b } from './checks/s01b-bypass.ts'
import { s02 } from './checks/s02-pubsub-acl.ts'
import { s03 } from './checks/s03-item-size.ts'
import { s04 } from './checks/s04-admin-provisioning.ts'
import { s05 } from './checks/s05-mam-paging.ts'
import { s06 } from './checks/s06-publisher-notifications.ts'
import { s10 } from './checks/s10-anonymous.ts'
import { s11 } from './checks/s11-two-sessions.ts'
import { s12 } from './checks/s12-live-changes.ts'
import { s13 } from './checks/s13-absent-role-change.ts'
import type { Ctx } from './context.ts'
import { bare, makeFixture, provision, teardown } from './fixture.ts'
import type { Fixture } from './fixture.ts'
import { must, setupOrFail, uniq } from './harness.ts'

/** Tags the suite uses; a runner's vitest config declares them (`test.tags`). */
export const CONTRACT_TAGS = Object.freeze([
  { name: 'r1', description: 'R1 tests (S01, S01b, C01): the gate for every ejabberd upgrade' },
  {
    name: 'raw',
    description: 'Probes that send raw stanzas from the session under test (needs RawAccess)',
  },
])

/** Raw stanza access to a session, for the S01b bypass probes (XMPP backends only). */
export interface RawAccess {
  /** Sends XML on the session's own stream, bypassing the transport. */
  send(session: Session, xml: string): void
  /** Every XML element the session receives, as text. */
  onIncoming(session: Session, listener: (xml: string) => void): () => void
}

export interface SuiteOptions {
  /**
   * Raw stanza access. The S01b probes for channels the interface does not offer (private
   * messages, subject, corrections, MUC/Sub, presence status, nick change, XEP-0077) need it; a
   * backend without such channels (the mock) omits it and those probes are not declared.
   */
  readonly raw?: RawAccess
  /** Messages seeded for the MAM paging check (spike S5 used 10,000). Default 120. */
  readonly mamMessages?: number
}

export function defineContractSuite(backend: ContractBackend, options: SuiteOptions = {}): void {
  describe(`transport contract (${backend.name})`, () => {
    let fixture: Fixture | undefined
    let adminSession: Session | undefined
    const opened: Session[] = []

    const track = async (outcome: Outcome<Session>): Outcome<Session> => {
      const result = await outcome
      if (result.ok) opened.push(result.value)
      return result
    }

    const ctx: Ctx = {
      backend,
      fx: () => {
        if (fixture === undefined) throw new Error('the fixture is not provisioned')
        return fixture
      },
      admin: () => {
        if (adminSession === undefined) throw new Error('no admin session')
        return adminSession
      },
      tryLogin: (login: Login) => track(backend.connect(login)),
      login: async (user, opts = {}) => {
        const login: Login = {
          kind: 'password',
          username: user,
          password: opts.password ?? ctx.fx().password,
          resource: opts.resource ?? uniq('pane'),
        }
        return must(await ctx.tryLogin(login), `login ${user}`)
      },
      anonymous: async () =>
        must(await ctx.tryLogin({ kind: 'anonymous', resource: uniq('anon') }), 'anonymous login'),
      adminSession: async () => must(await track(backend.admin()), 'admin login'),
      room: (localpart) => `${localpart}@${ctx.admin().services.muc}`,
      jid: (user) => bare(ctx.fx(), user),
    }

    // A failed setup fails every test rather than skipping them (NFR-16): an unreachable server
    // is a red build.
    setupOrFail(async () => {
      adminSession = must(await backend.admin(), `admin login on ${backend.name}`)
      const fx = makeFixture(backend.domain)
      fixture = fx
      await provision(fx, adminSession, () => ctx.login(fx.users.blueObs))
    }, 120_000)

    afterEach(async () => {
      const sessions = opened.splice(0)
      await Promise.all(sessions.map((s) => s.disconnect()))
    })

    afterAll(async () => {
      if (fixture !== undefined && adminSession !== undefined) await teardown(fixture, adminSession)
      await adminSession?.disconnect()
    }, 120_000)

    s00(ctx)
    recovery(ctx)
    s01(ctx)
    s01b(ctx, options.raw)
    c01(ctx)
    s02(ctx)
    s03(ctx)
    s04(ctx, options.raw)
    s05(ctx, options.mamMessages ?? 120)
    s06(ctx)
    s10(ctx)
    s11(ctx)
    s12(ctx)
    s13(ctx, options.raw)
    errors(ctx)
    ordering(ctx)
  })
}
