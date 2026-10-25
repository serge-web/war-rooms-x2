// The mock's durable state as one JSON document (PLY-21, PLY-34): what `exportState` writes and
// `importState` and seeds read. It holds what ejabberd keeps across a restart (accounts, rooms
// with affiliations, stored roles and archives, nodes with items and subscriptions, private
// storage) and nothing it loses: sessions, occupants and join history are not part of it.
//
// State read back from storage or a file is untrusted, so it is validated here (NFR-19).
import type { Result } from '@wrx/schemas'
import { z } from 'zod'

export const MOCK_STATE_FORMAT = 'wrx1-mock-state'

const roomConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  membersOnly: z.boolean(),
  moderated: z.boolean(),
  persistent: z.boolean(),
  public: z.boolean(),
  whois: z.enum(['anyone', 'moderators']),
  archive: z.boolean(),
})

const nodeConfigSchema = z.object({
  accessModel: z.enum(['open', 'presence', 'roster', 'authorize', 'whitelist']),
  publishModel: z.enum(['publishers', 'subscribers', 'open']),
  maxItems: z.int().min(1),
  notifyRetract: z.boolean(),
  title: z.string().optional(),
  notifyDelete: z.boolean(),
  itemReply: z.enum(['publisher', 'none']),
})

/** Stanza-ids are the archive time in microseconds since the epoch, as ejabberd's are. */
const stanzaIdSchema = z.string().regex(/^\d{1,20}$/, 'a stanza-id is a microsecond timestamp')

export const mockStateSchema = z.object({
  format: z.literal(MOCK_STATE_FORMAT),
  version: z.literal(1),
  domain: z.string().min(1),
  accounts: z.array(
    z.object({
      jid: z.string().min(3),
      /** Stored in clear: the mock is for demos and tests only. */
      password: z.string(),
      admin: z.boolean(),
      /** A known demo password, to be shown as such (NFR-6). */
      demo: z.boolean(),
    }),
  ),
  rooms: z.array(
    z.object({
      jid: z.string().min(3),
      config: roomConfigSchema,
      affiliations: z.array(
        z.object({ jid: z.string(), affiliation: z.enum(['owner', 'admin', 'member', 'outcast']) }),
      ),
      /** Roles set by a moderator, per bare JID, applied on later joins in moderated rooms (R13). */
      storedRoles: z.array(
        z.object({ jid: z.string(), role: z.enum(['moderator', 'participant', 'visitor']) }),
      ),
      archive: z.array(
        z.object({
          stanzaId: stanzaIdSchema,
          nick: z.string(),
          from: z.string(),
          body: z.string(),
        }),
      ),
    }),
  ),
  nodes: z.array(
    z.object({
      name: z.string().min(1),
      config: nodeConfigSchema,
      affiliations: z.array(
        z.object({
          jid: z.string(),
          affiliation: z.enum(['owner', 'publisher', 'publish-only', 'member', 'outcast']),
        }),
      ),
      subscriptions: z.array(
        z.object({
          jid: z.string(),
          subscription: z.enum(['subscribed', 'pending', 'unconfigured']),
        }),
      ),
      /** Oldest first. */
      items: z.array(z.object({ id: z.string(), payload: z.string(), publisher: z.string() })),
    }),
  ),
  privateStorage: z.array(z.object({ jid: z.string(), key: z.string(), value: z.string() })),
  /** The last stanza-id issued, so ids stay increasing across an export and import. */
  lastStanzaId: stanzaIdSchema,
})

export type MockState = z.infer<typeof mockStateSchema>
export type RoomState = MockState['rooms'][number]
export type NodeState = MockState['nodes'][number]
export type ArchivedMessage = RoomState['archive'][number]

/** Validates state from storage or a file. */
export function parseMockState(input: unknown): Result<MockState, string> {
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'invalid JSON' }
    }
  }
  const parsed = mockStateSchema.safeParse(value)
  if (parsed.success) return { ok: true, value: parsed.data }
  return { ok: false, error: z.prettifyError(parsed.error) }
}

/** A server with only the admin account. */
export function emptyState(domain: string, adminPassword: string, demo = true): MockState {
  return {
    format: MOCK_STATE_FORMAT,
    version: 1,
    domain,
    accounts: [{ jid: `admin@${domain}`, password: adminPassword, admin: true, demo }],
    rooms: [],
    nodes: [],
    privateStorage: [],
    lastStanzaId: '0',
  }
}
