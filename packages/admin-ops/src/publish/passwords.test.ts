// Role passwords (NFR-6, ADM-26) and the publish marker store.
import { describe, expect, it } from 'vitest'
import { memoryMarkerStore, newMarker, parseMarker, storageMarkerStore } from './marker.ts'
import {
  CredentialsBook,
  PASSWORD_ALPHABET,
  demoRolePassword,
  generatePassword,
} from './passwords.ts'

describe('generatePassword (NFR-6)', () => {
  it('is four groups of four from an unambiguous alphabet', () => {
    const password = generatePassword()
    expect(password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/)
    expect(password).not.toMatch(/[01ilo]/)
  })

  it('differs every time (WebCrypto randomness)', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword()))
    expect(seen.size).toBe(200)
  })

  it('redraws bytes above the largest multiple of the alphabet, so no symbol is favoured', () => {
    const limit = 256 - (256 % PASSWORD_ALPHABET.length)
    let call = 0
    const random = (bytes: Uint8Array) => {
      // First draw: only rejected bytes; then every byte maps to the first symbol.
      bytes.fill(call++ === 0 ? limit : 0)
      return bytes
    }
    expect(generatePassword(random)).toBe('aaaa-aaaa-aaaa-aaaa')
    expect(call).toBe(2)
  })
})

describe('CredentialsBook (ADM-26)', () => {
  it('issues random passwords and keeps them only in memory', () => {
    const book = new CredentialsBook('random', () => new Date('2026-10-25T10:00:00Z'))
    const first = book.issue('blue-co')
    expect(book.passwordFor('blue-co')).toBe(first)
    expect(book.issue('blue-co')).not.toBe(first)
    expect(book.list()).toEqual([expect.objectContaining({ roleId: 'blue-co', demo: false })])
    expect(() => JSON.stringify(book)).toThrow(/never serialised/)
    book.clear()
    expect(book.list()).toEqual([])
  })

  it('on the mock, gives the known demo passwords, labelled as demo', () => {
    const book = new CredentialsBook('demo')
    expect(book.issue('red-co')).toBe(demoRolePassword('red-co'))
    expect(book.get('red-co')?.demo).toBe(true)
  })

  it('tells subscribers about changes', () => {
    const book = new CredentialsBook()
    let calls = 0
    const stop = book.subscribe(() => calls++)
    book.issue('a')
    book.forget('a')
    stop()
    book.issue('b')
    expect(calls).toBe(2)
  })
})

describe('publish marker stores', () => {
  it('memory: write, read, clear', () => {
    const store = memoryMarkerStore()
    store.write(newMarker(3, new Date('2026-10-25T00:00:00Z')))
    expect(store.read()?.designVersion).toBe(3)
    store.clear()
    expect(store.read()).toBeUndefined()
  })

  it('web storage: survives as text; garbage counts as a marker of unknown version; errors are swallowed', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    }
    const store = storageMarkerStore(storage, 'k')
    store.write(newMarker(4, new Date()))
    expect(storageMarkerStore(storage, 'k').read()?.designVersion).toBe(4)
    data.set('k', 'garbage')
    expect(store.read()?.designVersion).toBe(1)
    expect(parseMarker('{"format":"other"}').designVersion).toBe(1)
    const broken = storageMarkerStore(
      {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('quota')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
      },
      'k',
    )
    expect(broken.read()).toBeUndefined()
    expect(() => {
      broken.write(newMarker(1, new Date()))
      broken.clear()
    }).not.toThrow()
  })
})
