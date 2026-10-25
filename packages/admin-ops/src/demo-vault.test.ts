// The mock's demo seed starts published, observer vault included (ADM-37, NFR-6): its stored
// envelope opens with the DEMO passphrase and holds the demo passwords of exactly the demo
// design's read-only roles, the plan of the demo design is empty, and the audit is clean with the
// observer's voice read through the vault. When the demo design's read-only roles change, the
// first test fails with a new envelope to paste into packages/mock-server/src/demo.ts.
import {
  DEMO_VAULT_PASSPHRASE,
  MockServer,
  MockTransport,
  demoSeed,
  demoState,
} from '@wrx/mock-server'
import { designFileSchema } from '@wrx/schemas'
import type { AdminApi, Session } from '@wrx/transport'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findings } from './audit/index.ts'
import { runAudit } from './audit/run.ts'
import { AdminOps } from './ops.ts'
import { demoRolePassword } from './publish/passwords.ts'
import { preparePublish } from './publish/prepare.ts'
import { targetState } from './target.ts'
import { ObserverVault, VAULT_KDF, VAULT_STORAGE_KEY } from './vault.ts'

const design = designFileSchema.parse(demoSeed().design)
const target = targetState(design)
const readOnly = target.readOnlyRoles
/** Role and room pairs where a role is read-only: the audit reads each one's stored role. */
const readOnlyPairs = target.rooms.flatMap((r) =>
  [...r.access.values()].filter((a) => a === 'read'),
)

/** A new envelope for the demo seed, as `DEMO_VAULT_ENVELOPE` should hold it. */
async function freshEnvelope(): Promise<string | undefined> {
  const stored = new Map<string, string>()
  const admin = {
    getPrivate: (key: string) => Promise.resolve({ ok: true, value: stored.get(key) }),
    setPrivate: (key: string, value: string) => {
      stored.set(key, value)
      return Promise.resolve({ ok: true, value: undefined })
    },
  } as unknown as AdminApi
  const created = await ObserverVault.create(admin, DEMO_VAULT_PASSPHRASE, {
    iterations: VAULT_KDF.minIterations,
  })
  if (!created.ok) return undefined
  for (const roleId of readOnly) await created.value.set(roleId, demoRolePassword(roleId))
  return stored.get(VAULT_STORAGE_KEY)
}

describe('the demo seed’s observer vault', () => {
  const state = demoState()
  const server = new MockServer({ seed: state })
  const transport = new MockTransport(server)
  const endpoint = { websocketUrl: 'mock://demo-vault', domain: state.domain }
  let session: Session | undefined
  let ops: AdminOps | undefined

  beforeAll(async () => {
    const login = await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'admin', password: 'demo-admin' },
      resource: 'demo-vault',
    })
    if (!login.ok) throw new Error(`admin login: ${login.error.condition}`)
    session = login.value
    ops = new AdminOps({ session, login: { transport, endpoint } })
  })

  afterAll(async () => {
    await session?.disconnect()
  })

  const theOps = (): AdminOps => {
    if (ops === undefined) throw new Error('not set up')
    return ops
  }

  it('is stored under the admin, with the vault’s key', () => {
    expect(state.privateStorage.map((p) => [p.jid, p.key])).toEqual([
      [`admin@${state.domain}`, VAULT_STORAGE_KEY],
    ])
  })

  it('opens with the demo passphrase and holds the read-only roles’ demo passwords', async () => {
    expect(readOnly).not.toEqual([])
    const vault = await ObserverVault.unlock(theOps().session.admin, DEMO_VAULT_PASSPHRASE)
    const contents = vault.ok
      ? vault.value.roles().map((id) => [id, vault.value.get(id)])
      : vault.error.code
    const expected = readOnly.map((id) => [id, demoRolePassword(id)])
    if (JSON.stringify(contents) !== JSON.stringify(expected)) {
      expect.fail(
        `The demo vault no longer matches the demo design (${JSON.stringify(contents)}, want ` +
          `${JSON.stringify(expected)}). Set DEMO_VAULT_ENVELOPE in ` +
          `packages/mock-server/src/demo.ts to:\n${await freshEnvelope()}`,
      )
    }
    if (vault.ok) vault.value.lock()
  })

  it('refuses another passphrase', async () => {
    const vault = await ObserverVault.unlock(theOps().session.admin, 'not-the-demo-one')
    expect(vault.ok ? 'opened' : vault.error.code).toBe('wrong-passphrase')
  })

  it('leaves nothing to publish, and audits clean with the observer’s voice read', async () => {
    const vault = await ObserverVault.unlock(theOps().session.admin, DEMO_VAULT_PASSPHRASE)
    if (!vault.ok) throw new Error(vault.error.message)
    theOps().useVault(vault.value)
    const prepared = await preparePublish(theOps(), design, { vault: vault.value })
    if (!prepared.ok) throw new Error(prepared.error.message)
    expect(prepared.value.plan.steps.map((s) => s.id)).toEqual([])
    expect(prepared.value.view.vault).toEqual({ exists: true, roles: readOnly })
    const audited = await runAudit(theOps(), design, { vault: vault.value })
    if (!audited.ok) throw new Error(audited.error.message)
    const { report } = audited.value
    expect(findings(report).map((i) => `${i.id} [${i.found}]`)).toEqual([])
    expect(report.vault).toBe('unlocked')
    expect(report.voiceChecked).toBe(readOnlyPairs.length)
    theOps().useVault(undefined)
    vault.value.lock()
  })
})
