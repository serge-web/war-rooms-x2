// Review F12 in the publish controller, against a mock server: the unlocked vault locks itself
// after a configurable time without admin activity (never in the middle of a run), activity
// restarts the count, and a new vault's passphrase must not be easy to guess.
import { AdminOps, VAULT_KDF } from '@wrx/admin-ops'
import { MockServer, MockTransport } from '@wrx/mock-server'
import { sampleDesign } from '@wrx/schemas/fixtures'
import { describe, expect, it } from 'vitest'
import { draftFromDesign } from '../draft/index.ts'
import { PublishController, VAULT_IDLE_LOCK_MS } from './controller.ts'
import type { IdleTimers, PublishConnection } from './controller.ts'

const domain = 'wrx.test'
const endpoint = { websocketUrl: 'mock://controller', domain }
const PASSPHRASE = 'a long enough vault passphrase'

/** A clock the test moves by hand. */
function manualTimers(): IdleTimers & { advance(ms: number): void } {
  let now = 0
  const pending = new Set<{ at: number; run: () => void }>()
  return {
    now: () => now,
    after(run, ms) {
      const job = { at: now + ms, run }
      pending.add(job)
      return () => {
        pending.delete(job)
      }
    },
    advance(ms) {
      now += ms
      for (const job of [...pending].sort((a, b) => a.at - b.at)) {
        if (job.at > now) continue
        pending.delete(job)
        job.run()
      }
    },
  }
}

async function controller(extra: Partial<PublishConnection> = {}) {
  const transport = new MockTransport(new MockServer({ domain, adminPassword: 'demo-admin' }))
  const session = await transport.connect({
    endpoint,
    credentials: { kind: 'password', username: 'admin', password: 'demo-admin' },
  })
  if (!session.ok) throw new Error('admin login')
  const timers = manualTimers()
  let draft = draftFromDesign(sampleDesign())
  const c = new PublishController({
    connection: {
      ops: new AdminOps({ session: session.value, login: { transport, endpoint } }),
      kind: 'xmpp',
      vaultIterations: VAULT_KDF.minIterations,
      ...extra,
    },
    getDraft: () => draft,
    commit: (next) => {
      draft = next
    },
    timers,
  })
  return { c, timers }
}

describe('F12: the vault locks itself when the admin is idle', () => {
  it('after 15 minutes by default; activity restarts the count', async () => {
    const { c, timers } = await controller()
    expect(await c.createVault(PASSPHRASE)).toBeUndefined()
    expect(c.getSnapshot().vault).toBe('unlocked')
    timers.advance(VAULT_IDLE_LOCK_MS - 60_000)
    c.noteActivity()
    timers.advance(VAULT_IDLE_LOCK_MS - 60_000)
    expect(c.getSnapshot().vault).toBe('unlocked')
    expect(c.currentVault()?.unlocked).toBe(true)
    timers.advance(VAULT_IDLE_LOCK_MS)
    expect(c.getSnapshot()).toMatchObject({ vault: 'locked', vaultIdleLocked: true })
    expect(c.currentVault()).toBeUndefined()
    // Unlocking again clears the notice and starts a new count.
    expect(await c.unlockVault(PASSPHRASE)).toBeUndefined()
    expect(c.getSnapshot()).toMatchObject({ vault: 'unlocked', vaultIdleLocked: false })
    c.dispose()
  })

  it('takes the time from the connection, and Infinity turns it off', async () => {
    const short = await controller({ vaultIdleLockMs: 60_000 })
    expect(await short.c.createVault(PASSPHRASE)).toBeUndefined()
    short.timers.advance(60_000)
    expect(short.c.getSnapshot().vault).toBe('locked')

    const never = await controller({ vaultIdleLockMs: Infinity })
    expect(await never.c.createVault(PASSPHRASE)).toBeUndefined()
    never.timers.advance(VAULT_IDLE_LOCK_MS * 100)
    expect(never.c.getSnapshot().vault).toBe('unlocked')
    never.c.dispose()
  })

  it('waits for a run that is using the vault', async () => {
    const { c, timers } = await controller({ vaultIdleLockMs: 60_000 })
    expect(await c.createVault(PASSPHRASE)).toBeUndefined()
    const planning = c.plan()
    expect(c.getSnapshot().busy).toBe('planning')
    timers.advance(60_000)
    expect(c.getSnapshot().vault).toBe('unlocked')
    await planning
    timers.advance(5_000)
    expect(c.getSnapshot()).toMatchObject({ vault: 'locked', vaultIdleLocked: true })
  })

  it('a lock by the admin is not reported as idle, and stops the timer', async () => {
    const { c, timers } = await controller({ vaultIdleLockMs: 60_000 })
    expect(await c.createVault(PASSPHRASE)).toBeUndefined()
    c.lockVault()
    timers.advance(60_000)
    expect(c.getSnapshot()).toMatchObject({ vault: 'locked', vaultIdleLocked: false })
  })

  it('refuses an easily guessed passphrase for a new vault', async () => {
    const { c } = await controller()
    expect(await c.createVault('Password1234')).toMatch(/too easy to guess/)
    expect(c.getSnapshot().vault).not.toBe('unlocked')
  })
})
