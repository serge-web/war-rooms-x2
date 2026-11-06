import './jitless.ts'
import { z } from 'zod'

/** Size limits shared by the client, the mock and the admin tools (SRD §3 rule 12, PLY-53, R15). */
export const LIMITS = Object.freeze({
  /** ejabberd's default PubSub item limit, in bytes. Operator-configurable on the server. */
  pubsubItemBytes: 250_000,
  /** Bytes kept free in each item for the XML wrapper around the JSON payload. */
  pubsubItemOverheadBytes: 2_000,
  /** Default asset limit (decoded bytes). The admin may lower it; it may not exceed `assetHardBytes`. */
  assetDefaultBytes: 100 * 1024,
  /** Largest asset whose base64 form still fits in one PubSub item. */
  assetHardBytes: 180_000,
  /**
   * Cap on each outgoing message stanza (UTF-8, after XML escaping). The server sets no
   * WebSocket limit (WP 0.1), so the client enforces this one (PLY-53, R15).
   */
  messageStanzaBytes: 65_536,
  /**
   * Cap on a world-state message stanza in the map room, counted the same way (PLY-53, D25):
   * about 2,500 assets in plain JSON. Every other message keeps `messageStanzaBytes`.
   */
  worldStateStanzaBytes: 500_000,
  /** Most assets one world state may hold; the stanza cap is reached first in practice. */
  worldStateAssets: 5_000,
  /** An asset's category and state, in characters (§3 rule 17). */
  worldLabelChars: 60,
  /** Highest turn number (D7); a bound for validation, far above any game. */
  turnMax: 10_000,
  /** Highest zoom a map room's config may open at (web map zoom levels). */
  mapZoomMax: 22,
  /** Message text cap in characters; fits the stanza cap even at 7 bytes a character escaped. */
  messageTextChars: 8_000,
  announcementTextChars: 2_000,
  nameChars: 120,
  descriptionChars: 1_000,
  briefingChars: 20_000,
  objectivesChars: 50_000,
  slugChars: 64,
  /**
   * Cap on one XEP-0049 private-storage value, as UTF-8 after XML escaping (WP 6.3): the
   * reference server ends a stream whose stanza is over 262,144 bytes (`max_stanza_size`), so
   * the transports refuse a larger value with `too-large` before sending. The script store
   * (PY-7) holds every script of an account in one value.
   */
  privateValueBytes: 200_000,
  /** A script run's time limit when none is set, in seconds (PY-10; the runner's default). */
  scriptRunDefaultSeconds: 30,
  /** The longest time limit a script run may have, in seconds (PY-10). */
  scriptRunMaxSeconds: 600,
})

/**
 * A readable, URL-safe name: lowercase letters, digits and single hyphens. Room-type ids
 * (`chat`) and role login names are slugs; entity ids are GUIDs (`idSchema`, SRD §3 rule 1).
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(LIMITS.slugChars)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must be a lowercase slug: letters, digits and single hyphens',
  )
  .describe('Readable URL-safe name: lowercase letters, digits and single hyphens')

/** A lowercase GUID (RFC 9562 text form), e.g. `0f8fad5b-d9cb-469f-a165-70867728950e`. */
export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The id of a force, role, room or asset: a lowercase GUID, generated at creation, stable and
 * never reused; display names are separate fields (SRD §3 rule 1). Node names and MUC room
 * localparts carry it, so they reveal nothing but how many entities there are (ADM-42).
 */
export const idSchema = z
  .string()
  .regex(ID_PATTERN, 'must be a lowercase GUID')
  .describe('Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1)')

export function isId(value: string): boolean {
  return ID_PATTERN.test(value)
}

/** What `newEntityId` needs of WebCrypto; `randomUUID` exists only in a secure context. */
export interface RandomSource {
  readonly randomUUID?: () => string
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>
}

/**
 * A new entity id (§3 rule 1): `crypto.randomUUID()` where the page is a secure context, else a
 * version 4 GUID from `crypto.getRandomValues`, which every context has (the file-hosting mode,
 * NFR-8, may serve the admin over plain http).
 */
export function newEntityId(source: RandomSource = globalThis.crypto): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID().toLowerCase()
  const bytes = source.getRandomValues(new Uint8Array(16))
  // RFC 9562 §5.4: version 4, variant 10.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * A role's login name: the XMPP account's localpart (`<loginName>@<domain>`), which a player
 * types at login (PLY-1). Unique in the game, not reserved, never given to another role while a
 * `retired` record holds it, and fixed once the role is published (§3 rule 1, ADM-5).
 */
export const loginNameSchema = slugSchema.describe(
  "Login name: the role's XMPP account name, readable, fixed once published (§3 rule 1, ADM-5)",
)

export const hexColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour')
  .describe('Colour as #rrggbb')

export const nameSchema = z.string().trim().min(1).max(LIMITS.nameChars).describe('Display name')

export const orderSchema = z
  .int()
  .min(0)
  .describe('Admin-set display order; ties sort by id (SRD §3 rule 7)')

export const isoDateTimeSchema = z.iso.datetime({ offset: true }).describe('ISO 8601 date-time')

export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex SHA-256 digest')
  .describe('SHA-256 of the decoded bytes, lowercase hex')

/** Login names are XMPP localparts, so these are taken by the server or the app. */
export const RESERVED_LOGIN_NAMES: readonly string[] = Object.freeze(['admin', 'anonymous'])

/**
 * The shape of the localparts ejabberd gives online SASL ANONYMOUS sessions, which its
 * registered-users list includes and the transport leaves out (transport-xmpp `ejabberd.ts`).
 * No login name may have it, so the filter can never hide a role's account (security review F4).
 */
export const ANONYMOUS_LIKE_NAME = /^\d{16,}$/

/** Whether a slug can never be a login name: reserved, or shaped like an anonymous session. */
export function isReservedLoginName(name: string): boolean {
  return RESERVED_LOGIN_NAMES.includes(name) || ANONYMOUS_LIKE_NAME.test(name)
}
