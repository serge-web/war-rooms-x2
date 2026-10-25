// The observer-password vault (ADM-37): WebCrypto AES-GCM under a PBKDF2-SHA-256 key, with only
// ciphertext in the admin's private storage.
import { FakeSession, err } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { FAST, PASSPHRASE, withStorage } from './fixtures.ts'
import { ObserverVault, VAULT_KDF, VAULT_STORAGE_KEY } from './vault.ts'

function storage(): { readonly session: FakeSession; readonly map: Map<string, string> } {
  const session = new FakeSession({ jid: 'admin@wrx.test/v' })
  const map = new Map<string, string>()
  withStorage(session, map)
  return { session, map }
}

async function created(session: FakeSession): Promise<ObserverVault> {
  const result = await ObserverVault.create(session.admin, PASSPHRASE, FAST)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function stored(map: Map<string, string>): Record<string, unknown> {
  const text = map.get(VAULT_STORAGE_KEY)
  if (text === undefined) throw new Error('nothing stored')
  const json: unknown = JSON.parse(text)
  if (typeof json !== 'object' || json === null) throw new Error('not an object')
  return Object.fromEntries(Object.entries(json))
}

function rewrite(map: Map<string, string>, change: (envelope: Record<string, unknown>) => void) {
  const envelope = stored(map)
  change(envelope)
  map.set(VAULT_STORAGE_KEY, JSON.stringify(envelope))
}

describe('ObserverVault', () => {
  it('stores only ciphertext, and unlocks with the passphrase', async () => {
    const { session, map } = storage()
    const vault = await created(session)
    expect((await vault.set('blue-observer', 'hunter2-observer')).ok).toBe(true)
    const text = map.get(VAULT_STORAGE_KEY) ?? ''
    expect(text).not.toContain('hunter2-observer')
    expect(text).not.toContain('blue-observer')
    expect(text).not.toContain(PASSPHRASE)
    expect(stored(map)).toMatchObject({
      format: 'wrx1-observer-vault',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: VAULT_KDF.minIterations },
      cipher: { name: 'AES-GCM' },
    })
    const unlocked = await ObserverVault.unlock(session.admin, PASSPHRASE)
    if (!unlocked.ok) throw new Error(unlocked.error.message)
    expect(unlocked.value.get('blue-observer')).toBe('hunter2-observer')
    expect(unlocked.value.roles()).toEqual(['blue-observer'])
  })

  it('defaults to 600,000 iterations', () => {
    expect(VAULT_KDF.defaultIterations).toBe(600_000)
  })

  it('a wrong passphrase fails cleanly', async () => {
    const { session } = storage()
    await created(session)
    const wrong = await ObserverVault.unlock(session.admin, 'not the passphrase at all')
    expect(wrong).toMatchObject({ ok: false, error: { code: 'wrong-passphrase' } })
  })

  it('altered ciphertext or header does not decrypt', async () => {
    const { session, map } = storage()
    const vault = await created(session)
    await vault.set('blue-observer', 'pw')
    const original = map.get(VAULT_STORAGE_KEY) ?? ''
    rewrite(map, (e) => {
      const text = typeof e.ciphertext === 'string' ? e.ciphertext : ''
      e.ciphertext = `${text.startsWith('A') ? 'B' : 'A'}${text.slice(1)}`
    })
    expect(await ObserverVault.unlock(session.admin, PASSPHRASE)).toMatchObject({
      ok: false,
      error: { code: 'wrong-passphrase' },
    })
    map.set(VAULT_STORAGE_KEY, original)
    rewrite(map, (e) => {
      e.kdf = {
        ...(typeof e.kdf === 'object' ? e.kdf : {}),
        iterations: VAULT_KDF.minIterations + 1,
      }
    })
    expect(await ObserverVault.unlock(session.admin, PASSPHRASE)).toMatchObject({
      ok: false,
      error: { code: 'wrong-passphrase' },
    })
  })

  it('refuses KDF parameters outside the bounds, and unreadable storage', async () => {
    const { session, map } = storage()
    await created(session)
    rewrite(map, (e) => {
      e.kdf = { ...(typeof e.kdf === 'object' ? e.kdf : {}), iterations: 1_000 }
    })
    expect(await ObserverVault.unlock(session.admin, PASSPHRASE)).toMatchObject({
      ok: false,
      error: { code: 'vault-corrupt' },
    })
    map.set(VAULT_STORAGE_KEY, 'not json')
    expect(await ObserverVault.unlock(session.admin, PASSPHRASE)).toMatchObject({
      ok: false,
      error: { code: 'vault-corrupt' },
    })
  })

  it('changes the passphrase with a new salt; the old one no longer opens it', async () => {
    const { session, map } = storage()
    const vault = await created(session)
    await vault.set('blue-observer', 'pw')
    const salt = (stored(map).kdf as { salt?: unknown } | undefined)?.salt
    const next = 'a different long passphrase'
    expect((await vault.changePassphrase(next, FAST)).ok).toBe(true)
    expect((stored(map).kdf as { salt?: unknown } | undefined)?.salt).not.toBe(salt)
    expect((await ObserverVault.unlock(session.admin, PASSPHRASE)).ok).toBe(false)
    const reopened = await ObserverVault.unlock(session.admin, next)
    expect(reopened.ok ? reopened.value.get('blue-observer') : undefined).toBe('pw')
    // And the vault keeps working under the new key.
    expect((await vault.set('red-liaison', 'pw2')).ok).toBe(true)
    const again = await ObserverVault.unlock(session.admin, next)
    expect(again.ok ? again.value.roles() : []).toEqual(['blue-observer', 'red-liaison'])
  })

  it('uses a fresh IV for every save', async () => {
    const { session, map } = storage()
    const vault = await created(session)
    const ivs = new Set<unknown>()
    for (const pw of ['a', 'b', 'c']) {
      await vault.set('blue-observer', pw)
      ivs.add((stored(map).cipher as { iv?: unknown } | undefined)?.iv)
    }
    expect(ivs.size).toBe(3)
  })

  it('removes a role, and removing an absent one is success', async () => {
    const { session } = storage()
    const vault = await created(session)
    await vault.set('blue-observer', 'pw')
    expect((await vault.remove('blue-observer')).ok).toBe(true)
    expect((await vault.remove('blue-observer')).ok).toBe(true)
    const reopened = await ObserverVault.unlock(session.admin, PASSPHRASE)
    expect(reopened.ok ? reopened.value.roles() : ['x']).toEqual([])
  })

  it('refuses a second vault, a missing vault, a short passphrase and too few iterations', async () => {
    const { session } = storage()
    expect(await ObserverVault.unlock(session.admin, PASSPHRASE)).toMatchObject({
      ok: false,
      error: { code: 'vault-not-found' },
    })
    expect(await ObserverVault.create(session.admin, 'short', FAST)).toMatchObject({
      ok: false,
      error: { code: 'weak-passphrase' },
    })
    expect(await ObserverVault.create(session.admin, PASSPHRASE, { iterations: 10 })).toMatchObject(
      {
        ok: false,
        error: { code: 'invalid' },
      },
    )
    await created(session)
    expect(await ObserverVault.create(session.admin, PASSPHRASE, FAST)).toMatchObject({
      ok: false,
      error: { code: 'vault-exists' },
    })
  })

  it('refuses to overwrite a change made elsewhere', async () => {
    const { session } = storage()
    const here = await created(session)
    const unlocked = await ObserverVault.unlock(session.admin, PASSPHRASE)
    if (!unlocked.ok) throw new Error('unlock')
    const there = unlocked.value
    expect((await there.set('blue-observer', 'from-there')).ok).toBe(true)
    expect(await here.set('red-liaison', 'from-here')).toMatchObject({
      ok: false,
      error: { code: 'vault-conflict' },
    })
  })

  it('forgets everything on lock', async () => {
    const { session } = storage()
    const vault = await created(session)
    await vault.set('blue-observer', 'pw')
    vault.lock()
    expect(vault.unlocked).toBe(false)
    expect(vault.get('blue-observer')).toBeUndefined()
    expect(await vault.set('blue-observer', 'x')).toMatchObject({
      ok: false,
      error: { code: 'vault-locked' },
    })
  })

  it('reports a storage refusal as a typed error', async () => {
    const session = new FakeSession({ jid: 'admin@wrx.test/v' })
    session.stub('admin', 'getPrivate', () => Promise.resolve(err('forbidden')))
    expect(await ObserverVault.unlock(session.admin, PASSPHRASE)).toMatchObject({
      ok: false,
      error: { code: 'refused', cause: { condition: 'forbidden' } },
    })
  })
})
