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
  /** Message text cap in characters; fits the stanza cap even at 7 bytes a character escaped. */
  messageTextChars: 8_000,
  announcementTextChars: 2_000,
  nameChars: 120,
  descriptionChars: 1_000,
  briefingChars: 20_000,
  objectivesChars: 50_000,
  slugChars: 64,
})

/** Stable, URL-safe id: lowercase letters, digits and single hyphens (SRD §3 rule 1). */
export const slugSchema = z
  .string()
  .min(1)
  .max(LIMITS.slugChars)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must be a lowercase slug: letters, digits and single hyphens',
  )
  .describe('Stable URL-safe id, never reused (SRD §3 rule 1)')

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

/** Role ids become XMPP localparts, so these are taken by the server or the app. */
export const RESERVED_ROLE_IDS: readonly string[] = Object.freeze(['admin', 'anonymous'])
