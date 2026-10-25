// The observer-password vault (ADM-37, plan/decisions/S13.md). No admin feature can make an
// absent member a MUC visitor, so the tooling logs in as each read-only role to have its voice
// revoked, and needs that role's password. The passwords are encrypted here, in the admin's
// browser, and only the ciphertext is stored, in the admin account's XEP-0049 private storage.
//
// - Key: PBKDF2-HMAC-SHA-256 over the passphrase, random 16-byte salt, 600,000 iterations by
//   default (OWASP 2023), into a non-extractable AES-256-GCM key. The passphrase is not kept.
// - Each save: a fresh random 12-byte IV. The envelope's header (format, version, KDF
//   parameters) is the GCM additional data, so a changed header fails to decrypt.
// - Unlocking refuses KDF parameters outside fixed bounds, so altered storage cannot make the
//   key cheap to guess or the unlock hang.
// - A wrong passphrase and altered ciphertext both fail GCM's tag check: `wrong-passphrase`.
// - A lost passphrase cannot be recovered: reset the read-only roles' passwords (ADM-26) and
//   create a new vault.
import { slugSchema } from '@wrx/schemas'
import type { AdminApi } from '@wrx/transport'
import { z } from 'zod'
import { opsErr, opsOk } from './errors.ts'
import type { OpsOutcome, OpsResult } from './errors.ts'

/** The private-storage key (a safe namespace suffix for XEP-0049). */
export const VAULT_STORAGE_KEY = 'wrx-observer-vault'

export const VAULT_KDF = Object.freeze({
  /** Used for new vaults and passphrase changes. */
  defaultIterations: 600_000,
  /** The fewest a vault may use, on create and on unlock. */
  minIterations: 100_000,
  /** The most an unlock will run, so altered storage cannot hang the browser. */
  maxIterations: 10_000_000,
  saltBytes: 16,
  ivBytes: 12,
})

/** Shorter passphrases are refused. */
export const MIN_PASSPHRASE_CHARS = 12

const FORMAT = 'wrx1-observer-vault'

/** A WebCrypto key; the global type name is not in every TypeScript lib. */
type AesKey = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>

const base64Schema = z.base64()

const envelopeSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(1),
  kdf: z.object({
    name: z.literal('PBKDF2'),
    hash: z.literal('SHA-256'),
    iterations: z.int().min(VAULT_KDF.minIterations).max(VAULT_KDF.maxIterations),
    salt: base64Schema,
  }),
  cipher: z.object({ name: z.literal('AES-GCM'), iv: base64Schema }),
  ciphertext: base64Schema,
})

type Envelope = z.infer<typeof envelopeSchema>

const contentsSchema = z.object({ passwords: z.record(slugSchema, z.string().min(1)) })

export interface VaultOptions {
  /** PBKDF2 iterations for a new key; at least `VAULT_KDF.minIterations`. */
  readonly iterations?: number
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** The GCM additional data: the header, in a fixed field order. */
function additionalData(kdf: Envelope['kdf']): Uint8Array<ArrayBuffer> {
  const header = {
    format: FORMAT,
    version: 1,
    kdf: { name: kdf.name, hash: kdf.hash, iterations: kdf.iterations, salt: kdf.salt },
  }
  return new TextEncoder().encode(JSON.stringify(header))
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<AesKey> {
  // NFC, so the same passphrase typed on another keyboard or OS derives the same key.
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

interface Keyed {
  readonly key: AesKey
  readonly kdf: Envelope['kdf']
}

async function newKey(passphrase: string, iterations: number): Promise<Keyed> {
  const salt = randomBytes(VAULT_KDF.saltBytes)
  const key = await deriveKey(passphrase, salt, iterations)
  return { key, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) } }
}

async function seal(keyed: Keyed, passwords: ReadonlyMap<string, string>): Promise<string> {
  const iv = randomBytes(VAULT_KDF.ivBytes)
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ passwords: Object.fromEntries(passwords) }),
  )
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(keyed.kdf) },
    keyed.key,
    plaintext,
  )
  const envelope: Envelope = {
    format: FORMAT,
    version: 1,
    kdf: keyed.kdf,
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
  return JSON.stringify(envelope)
}

function parseEnvelope(text: string): OpsResult<Envelope> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return opsErr('vault-corrupt', 'the stored vault is not JSON')
  }
  const parsed = envelopeSchema.safeParse(json)
  if (!parsed.success) {
    return opsErr(
      'vault-corrupt',
      `the stored vault is not readable: ${z.prettifyError(parsed.error)}`,
    )
  }
  const { salt } = parsed.data.kdf
  if (fromBase64(salt).length !== VAULT_KDF.saltBytes) {
    return opsErr('vault-corrupt', 'the stored vault has a salt of the wrong length')
  }
  if (fromBase64(parsed.data.cipher.iv).length !== VAULT_KDF.ivBytes) {
    return opsErr('vault-corrupt', 'the stored vault has an IV of the wrong length')
  }
  return opsOk(parsed.data)
}

function checkPassphrase(passphrase: string): OpsResult<void> {
  if (Array.from(passphrase.normalize('NFC')).length < MIN_PASSPHRASE_CHARS) {
    return opsErr(
      'weak-passphrase',
      `the passphrase needs at least ${MIN_PASSPHRASE_CHARS} characters`,
    )
  }
  return opsOk(undefined)
}

function checkIterations(iterations: number): OpsResult<void> {
  if (
    !Number.isInteger(iterations) ||
    iterations < VAULT_KDF.minIterations ||
    iterations > VAULT_KDF.maxIterations
  ) {
    return opsErr(
      'invalid',
      `iterations must be an integer from ${VAULT_KDF.minIterations} to ${VAULT_KDF.maxIterations}`,
    )
  }
  return opsOk(undefined)
}

async function read(admin: AdminApi): OpsOutcome<string | undefined> {
  const stored = await admin.getPrivate(VAULT_STORAGE_KEY)
  if (!stored.ok) {
    return opsErr('refused', 'reading the vault failed', {
      cause: stored.error,
      step: 'read vault',
    })
  }
  return opsOk(stored.value)
}

/**
 * An unlocked vault. Holds the derived key and the decrypted passwords in memory until `lock()`;
 * every change is re-encrypted and written back before it resolves.
 */
export class ObserverVault {
  private keyed: Keyed | undefined
  private readonly passwords: Map<string, string>
  /** The envelope this vault last read or wrote, to detect a change made elsewhere. */
  private stored: string

  private constructor(
    private readonly admin: AdminApi,
    keyed: Keyed,
    passwords: Map<string, string>,
    stored: string,
  ) {
    this.keyed = keyed
    this.passwords = passwords
    this.stored = stored
  }

  /** Whether the admin account has a stored vault. */
  static async exists(admin: AdminApi): OpsOutcome<boolean> {
    const stored = await read(admin)
    return stored.ok ? opsOk(stored.value !== undefined) : stored
  }

  /** Creates an empty vault under `passphrase` and stores it. Fails `vault-exists` if one is stored. */
  static async create(
    admin: AdminApi,
    passphrase: string,
    options: VaultOptions = {},
  ): OpsOutcome<ObserverVault> {
    const strong = checkPassphrase(passphrase)
    if (!strong.ok) return strong
    const iterations = options.iterations ?? VAULT_KDF.defaultIterations
    const bounded = checkIterations(iterations)
    if (!bounded.ok) return bounded
    const existing = await read(admin)
    if (!existing.ok) return existing
    if (existing.value !== undefined) {
      return opsErr(
        'vault-exists',
        'a vault is already stored; unlock it, or change its passphrase',
      )
    }
    const keyed = await newKey(passphrase, iterations)
    const passwords = new Map<string, string>()
    const envelope = await seal(keyed, passwords)
    const written = await admin.setPrivate(VAULT_STORAGE_KEY, envelope)
    if (!written.ok) {
      return opsErr('refused', 'storing the vault failed', {
        cause: written.error,
        step: 'write vault',
      })
    }
    return opsOk(new ObserverVault(admin, keyed, passwords, envelope))
  }

  /** Reads and decrypts the stored vault. */
  static async unlock(admin: AdminApi, passphrase: string): OpsOutcome<ObserverVault> {
    const stored = await read(admin)
    if (!stored.ok) return stored
    if (stored.value === undefined) return opsErr('vault-not-found', 'no vault is stored')
    const envelope = parseEnvelope(stored.value)
    if (!envelope.ok) return envelope
    const { kdf, cipher, ciphertext } = envelope.value
    const key = await deriveKey(passphrase, fromBase64(kdf.salt), kdf.iterations)
    let plaintext: ArrayBuffer
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(cipher.iv), additionalData: additionalData(kdf) },
        key,
        fromBase64(ciphertext),
      )
    } catch {
      return opsErr('wrong-passphrase', 'the passphrase does not open the vault, or it was altered')
    }
    let json: unknown
    try {
      json = JSON.parse(new TextDecoder().decode(plaintext))
    } catch {
      return opsErr('vault-corrupt', 'the vault contents are not JSON')
    }
    const contents = contentsSchema.safeParse(json)
    if (!contents.success) return opsErr('vault-corrupt', 'the vault contents are not readable')
    const passwords = new Map(Object.entries(contents.data.passwords))
    return opsOk(new ObserverVault(admin, { key, kdf }, passwords, stored.value))
  }

  get unlocked(): boolean {
    return this.keyed !== undefined
  }

  /** Role ids with a stored password. */
  roles(): readonly string[] {
    return [...this.passwords.keys()].sort()
  }

  has(roleId: string): boolean {
    return this.passwords.has(roleId)
  }

  get(roleId: string): string | undefined {
    return this.keyed === undefined ? undefined : this.passwords.get(roleId)
  }

  /** Stores or replaces a role's password (ADM-26). */
  async set(roleId: string, password: string): OpsOutcome<void> {
    if (!slugSchema.safeParse(roleId).success)
      return opsErr('invalid', `"${roleId}" is not a role id`)
    if (password === '') return opsErr('invalid', 'the password is empty')
    const next = new Map(this.passwords)
    next.set(roleId, password)
    return this.save(next)
  }

  /** Forgets a role's password (ADM-39). Removing an absent role is success. */
  async remove(roleId: string): OpsOutcome<void> {
    if (!this.passwords.has(roleId)) return opsOk(undefined)
    const next = new Map(this.passwords)
    next.delete(roleId)
    return this.save(next)
  }

  /** Re-encrypts the vault under a new passphrase, with a new salt. */
  async changePassphrase(passphrase: string, options: VaultOptions = {}): OpsOutcome<void> {
    const strong = checkPassphrase(passphrase)
    if (!strong.ok) return strong
    const iterations = options.iterations ?? VAULT_KDF.defaultIterations
    const bounded = checkIterations(iterations)
    if (!bounded.ok) return bounded
    if (this.keyed === undefined) return opsErr('vault-locked', 'the vault is locked')
    const keyed = await newKey(passphrase, iterations)
    return this.save(this.passwords, keyed)
  }

  /** Drops the key and the passwords from memory. The vault cannot be used again. */
  lock(): void {
    this.keyed = undefined
    this.passwords.clear()
  }

  private async save(
    passwords: ReadonlyMap<string, string>,
    keyed: Keyed | undefined = this.keyed,
  ): OpsOutcome<void> {
    if (keyed === undefined || this.keyed === undefined) {
      return opsErr('vault-locked', 'the vault is locked')
    }
    // Another admin tab or browser may have changed it: refuse rather than overwrite its change.
    const current = await read(this.admin)
    if (!current.ok) return current
    if (current.value !== this.stored) {
      return opsErr('vault-conflict', 'the vault was changed elsewhere; unlock it again')
    }
    const envelope = await seal(keyed, passwords)
    const written = await this.admin.setPrivate(VAULT_STORAGE_KEY, envelope)
    if (!written.ok) {
      return opsErr('refused', 'storing the vault failed', {
        cause: written.error,
        step: 'write vault',
      })
    }
    this.stored = envelope
    this.keyed = keyed
    if (passwords !== this.passwords) {
      this.passwords.clear()
      for (const [roleId, password] of passwords) this.passwords.set(roleId, password)
    }
    return opsOk(undefined)
  }
}
