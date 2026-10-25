// Role passwords (NFR-6, ADM-26): random from WebCrypto by default; known demo passwords only on
// the mock, labelled as such. Issued passwords are kept only in a CredentialsBook in memory, for
// the printable credentials sheet; nothing here stores them anywhere (§3 rule 9, NFR-1).

/** No 0/O, 1/l/I: easy to read off a printed sheet. 31 symbols. */
export const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Four groups of four: 16 symbols of 31, about 79 bits. */
export const PASSWORD_GROUPS = 4
export const PASSWORD_GROUP_LENGTH = 4

/** A random password, e.g. `k7mq-2hxa-r9tw-c4pz`. Unbiased: bytes outside a multiple of the alphabet are redrawn. */
export function generatePassword(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = defaultRandom,
): string {
  const n = PASSWORD_ALPHABET.length
  const limit = 256 - (256 % n)
  const symbols: string[] = []
  const total = PASSWORD_GROUPS * PASSWORD_GROUP_LENGTH
  while (symbols.length < total) {
    for (const byte of random(new Uint8Array(total * 2))) {
      if (byte >= limit) continue
      symbols.push(PASSWORD_ALPHABET.charAt(byte % n))
      if (symbols.length === total) break
    }
  }
  const groups: string[] = []
  for (let i = 0; i < total; i += PASSWORD_GROUP_LENGTH) {
    groups.push(symbols.slice(i, i + PASSWORD_GROUP_LENGTH).join(''))
  }
  return groups.join('-')
}

function defaultRandom(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  return crypto.getRandomValues(bytes)
}

/** The mock's known demo password for a role: the same as `@wrx/mock-server`'s `demoPassword`. */
export function demoRolePassword(roleId: string): string {
  return `demo-${roleId}`
}

export type PasswordMode =
  /** WebCrypto randomness (NFR-6). The default, and the only mode for a real server. */
  | 'random'
  /** Known demo passwords, for the mock only; every entry is marked `demo`. */
  | 'demo'

export interface Credential {
  readonly roleId: string
  readonly password: string
  /** A known demo password, not a secret (NFR-6). */
  readonly demo: boolean
  readonly issuedAt: Date
}

/**
 * Passwords issued in this browser session, in memory only. Never serialised: there is no
 * method that writes it anywhere, and `clear()` drops everything (e.g. on logout).
 */
export class CredentialsBook {
  private readonly entries = new Map<string, Credential>()
  private readonly listeners = new Set<() => void>()

  constructor(
    readonly mode: PasswordMode = 'random',
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** A new password for the role, replacing any held; used when an account is created or reset. */
  issue(roleId: string): string {
    const password = this.mode === 'demo' ? demoRolePassword(roleId) : generatePassword()
    this.entries.set(roleId, {
      roleId,
      password,
      demo: this.mode === 'demo',
      issuedAt: this.clock(),
    })
    this.changed()
    return password
  }

  /** The held password, or a new one if none is held: the same password across a retry. */
  passwordFor(roleId: string): string {
    return this.entries.get(roleId)?.password ?? this.issue(roleId)
  }

  get(roleId: string): Credential | undefined {
    return this.entries.get(roleId)
  }

  list(): readonly Credential[] {
    return [...this.entries.values()].sort((a, b) => (a.roleId < b.roleId ? -1 : 1))
  }

  /** Puts back an entry taken from `get`, e.g. when the server refused a new password. */
  restore(credential: Credential): void {
    this.entries.set(credential.roleId, credential)
    this.changed()
  }

  forget(roleId: string): void {
    if (this.entries.delete(roleId)) this.changed()
  }

  clear(): void {
    this.entries.clear()
    this.changed()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Not JSON: a book must never be serialised by accident. */
  toJSON(): never {
    throw new Error('CredentialsBook is never serialised (ADM-26)')
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
