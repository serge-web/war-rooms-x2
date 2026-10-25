// What crosses a tab or worker boundary (WP 1.5): the mock server's frames (protocol.ts in
// mock-server) wrapped in the host's own messages. Another tab, or a worker built from another
// release, is outside this context's control, so every message is validated on arrival
// (NFR-19) and an invalid one is dropped with a log entry.
import { XMPP_CONDITIONS } from '@wrx/transport'
import type { ClientFrame, OpMap, OpName, Reply, Request, ServerFrame } from '@wrx/mock-server'
import { z } from 'zod'

// ---- transport values -----------------------------------------------------------------------

const jid = z.string()
const optionalString = z.union([z.string(), z.undefined()])

const transportError = z.object({
  condition: z.enum([
    ...XMPP_CONDITIONS,
    'timeout',
    'disconnected',
    'invalid-response',
    'too-large',
  ] as const),
  type: z.enum(['auth', 'cancel', 'continue', 'modify', 'wait']).optional(),
  text: z.string().optional(),
})

const credentials = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('password'), username: z.string(), password: z.string() }),
  z.object({ kind: z.literal('anonymous') }),
])

const services = z.object({ muc: z.string(), pubsub: z.string() })
const endReason = z.enum([
  'logout',
  'session-ended',
  'account-removed',
  'auth-failed',
  'unreachable',
])
const mucRole = z.enum(['moderator', 'participant', 'visitor', 'none'])
const mucAffiliation = z.enum(['owner', 'admin', 'member', 'outcast', 'none'])

const joined = z.object({ room: jid, nick: z.string(), role: mucRole, affiliation: mucAffiliation })
const affiliationEntry = z.object({ jid, affiliation: mucAffiliation })
const roomConfig = z.object({
  name: z.string(),
  description: z.string().optional(),
  membersOnly: z.boolean(),
  moderated: z.boolean(),
  persistent: z.boolean(),
  public: z.boolean(),
  whois: z.enum(['anyone', 'moderators']),
  archive: z.boolean(),
})
const roomMessage = z.object({
  room: jid,
  stanzaId: z.string(),
  nick: z.string(),
  from: optionalString,
  timestamp: z.string(),
  body: z.string(),
})
const occupantEvent = z.object({
  room: jid,
  nick: z.string(),
  jid: optionalString,
  role: mucRole,
  affiliation: mucAffiliation,
  available: z.boolean(),
  self: z.boolean(),
  statusCodes: z.array(z.int()),
})
const mamQuery = z.object({ before: z.string().optional(), max: z.number() })
const mamPage = z.object({
  messages: z.array(roomMessage),
  first: optionalString,
  last: optionalString,
  complete: z.boolean(),
})
const item = z.object({ id: z.string(), payload: z.string(), publisher: optionalString })
const itemsEvent = z.object({
  node: z.string(),
  items: z.array(item),
  retracted: z.array(z.string()),
  deleted: z.boolean(),
})
const nodeConfig = z.object({
  accessModel: z.enum(['open', 'presence', 'roster', 'authorize', 'whitelist']),
  publishModel: z.enum(['publishers', 'subscribers', 'open']),
  maxItems: z.number(),
  notifyRetract: z.boolean(),
  title: z.string().optional(),
})
const serverNodeConfig = nodeConfig.extend({
  notifyDelete: z.boolean(),
  itemReply: z.enum(['publisher', 'none']),
})
const pubsubAffiliationEntry = z.object({
  jid,
  affiliation: z.enum(['owner', 'publisher', 'publish-only', 'member', 'none', 'outcast']),
})
const subscriptionEntry = z.object({
  jid,
  subscription: z.enum(['subscribed', 'pending', 'unconfigured', 'none']),
})

// ---- requests and replies -------------------------------------------------------------------

const s = z.string()
const none = z.undefined()

/** Each operation's arguments and result, as in OpMap. */
const OPS = {
  'muc.join': [z.tuple([s, s]), joined],
  'muc.leave': [z.tuple([s]), none],
  'muc.send': [z.tuple([s, s]), z.object({ stanzaId: s })],
  'muc.setRole': [z.tuple([s, s, mucRole]), none],
  'muc.setAffiliations': [z.tuple([s, z.array(affiliationEntry)]), none],
  'muc.getAffiliations': [z.tuple([s, mucAffiliation]), z.array(affiliationEntry)],
  'muc.createRoom': [z.tuple([s, roomConfig]), none],
  'muc.configureRoom': [z.tuple([s, roomConfig]), none],
  'muc.getRoomConfig': [z.tuple([s]), roomConfig],
  'muc.destroyRoom': [z.tuple([s]), none],
  'muc.listRooms': [z.tuple([]), z.array(s)],
  'mam.queryRoom': [z.tuple([s, mamQuery]), mamPage],
  'pubsub.getItems': [z.tuple([s, z.union([z.number(), z.undefined()])]), z.array(item)],
  'pubsub.publish': [z.tuple([s, s, s]), none],
  'pubsub.retract': [z.tuple([s, s]), none],
  'pubsub.subscribe': [z.tuple([s]), none],
  'pubsub.unsubscribe': [z.tuple([s]), none],
  'pubsub.listNodes': [z.tuple([]), z.array(s)],
  'pubsub.createNode': [z.tuple([s, serverNodeConfig]), none],
  'pubsub.configureNode': [z.tuple([s, serverNodeConfig]), none],
  'pubsub.getNodeConfig': [z.tuple([s]), nodeConfig],
  'pubsub.deleteNode': [z.tuple([s]), none],
  'pubsub.getAffiliations': [z.tuple([s]), z.array(pubsubAffiliationEntry)],
  'pubsub.setAffiliations': [z.tuple([s, z.array(pubsubAffiliationEntry)]), none],
  'pubsub.getSubscriptions': [z.tuple([s]), z.array(subscriptionEntry)],
  'pubsub.setSubscriptions': [z.tuple([s, z.array(subscriptionEntry)]), none],
  'admin.onlineUsers': [z.tuple([]), z.array(s)],
  'admin.registeredUsers': [z.tuple([]), z.array(s)],
  'admin.addUser': [z.tuple([s, s]), none],
  'admin.deleteUser': [z.tuple([s]), none],
  'admin.changePassword': [z.tuple([s, s]), none],
  'admin.endUserSessions': [z.tuple([s]), none],
  'admin.getPrivate': [z.tuple([s]), optionalString],
  'admin.setPrivate': [z.tuple([s, s]), none],
} as const satisfies Record<OpName, readonly [z.ZodType, z.ZodType]>

// The table must match OpMap exactly; a mismatch names the operation in a type error here.
type Ops = typeof OPS
type Mismatched = {
  [K in OpName]: [z.output<Ops[K][0]>] extends [OpMap[K]['args']]
    ? [z.output<Ops[K][1]>] extends [OpMap[K]['result']]
      ? never
      : K
    : K
}[OpName]
const _opsMatchOpMap: [Mismatched] extends [never] ? true : Mismatched = true

function resultOf<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: transportError }),
  ])
}

const opNames = Object.keys(OPS) as OpName[]

// Built from the table, whose agreement with OpMap is checked above; the union itself is too
// wide for TypeScript to infer, so its type is stated.
const requestSchema = z.discriminatedUnion(
  'op',
  opNames.map((op) => z.object({ op: z.literal(op), args: OPS[op][0] })) as unknown as [
    z.ZodObject<{ op: z.ZodLiteral<OpName> }>,
  ],
) as unknown as z.ZodType<Request>

const replySchema = z.discriminatedUnion(
  'op',
  opNames.map((op) => z.object({ op: z.literal(op), result: resultOf(OPS[op][1]) })) as unknown as [
    z.ZodObject<{ op: z.ZodLiteral<OpName> }>,
  ],
) as unknown as z.ZodType<Reply>

const requestId = z.int().nonnegative()

export const clientFrameSchema: z.ZodType<ClientFrame> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('login'), credentials, resource: z.string().optional() }),
  z.object({ t: z.literal('request'), id: requestId, request: requestSchema }),
  z.object({ t: z.literal('logout') }),
  z.object({ t: z.literal('drop') }),
])

const serverEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('presence'), occupant: occupantEvent }),
  z.object({ kind: z.literal('message'), message: roomMessage }),
  z.object({ kind: z.literal('items'), event: itemsEvent }),
])

export const serverFrameSchema: z.ZodType<ServerFrame> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('bound'), jid, anonymous: z.boolean(), services }),
  z.object({ t: z.literal('refused'), error: transportError }),
  z.object({ t: z.literal('reply'), id: requestId, reply: replySchema }),
  z.object({ t: z.literal('event'), event: serverEvent }),
  z.object({ t: z.literal('end'), reason: endReason, text: z.string().optional() }),
  z.object({ t: z.literal('closed') }),
  z.object({ t: z.literal('dropped') }),
])

// ---- notices --------------------------------------------------------------------------------

/** Something the person using the app should be told about the mock database (DOC-17). */
export type MockNotice = z.output<typeof noticeSchema>

export const noticeSchema = z.discriminatedUnion('kind', [
  /** Stored state from an older release was migrated. */
  z.object({ kind: z.literal('migrated'), from: z.int(), to: z.int(), text: z.string() }),
  /** Stored state could not be read or migrated; the mock started again from the seed. */
  z.object({ kind: z.literal('reset-unreadable'), reason: z.string(), text: z.string() }),
  /** IndexedDB is unavailable: the mock runs, but nothing survives a reload. */
  z.object({ kind: z.literal('storage-unavailable'), reason: z.string(), text: z.string() }),
  /** A save failed, e.g. over the storage quota. Reported once per host. */
  z.object({ kind: z.literal('storage-failed'), reason: z.string(), text: z.string() }),
  /** The browser cannot share the mock between tabs; this tab has a server of its own. */
  z.object({ kind: z.literal('not-shared'), reason: z.string(), text: z.string() }),
  /** Someone reset the mock to its seed (PLY-21). */
  z.object({ kind: z.literal('reset'), text: z.string() }),
  /** Someone imported a mock database (PLY-21). */
  z.object({ kind: z.literal('imported'), text: z.string() }),
  /** A newer release took over the mock; this tab should reload. */
  z.object({ kind: z.literal('superseded'), text: z.string() }),
])

// ---- host messages --------------------------------------------------------------------------

/** Database controls (PLY-21), applied by the host to the one shared server. */
export type Control = z.output<typeof controlSchema>
const controlSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('reset') }),
  z.object({ op: z.literal('export') }),
  z.object({ op: z.literal('import'), json: z.string() }),
])

export type ControlResult = z.output<typeof controlResultSchema>
const controlResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), json: z.string().optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

const tab = z.string().min(1).max(64)
const conn = z.int().nonnegative()

/** Tab to host. */
export type UpMessage = z.output<typeof upMessageSchema>
export const upMessageSchema = z.discriminatedUnion('k', [
  /** First message on a SharedWorker port. The seed is validated by the host. */
  z.object({ k: z.literal('hello'), tab, seed: z.unknown() }),
  z.object({ k: z.literal('c2s'), tab, conn, frame: clientFrameSchema }),
  z.object({ k: z.literal('control'), tab, id: requestId, control: controlSchema }),
  /** The tab is going away: drop its connections. */
  z.object({ k: z.literal('bye'), tab }),
])

/** Host to tab. */
export type DownMessage = z.output<typeof downMessageSchema>
export const downMessageSchema = z.discriminatedUnion('k', [
  /** The host is serving; `notices` are those from its start (migration, reset, storage). */
  z.object({ k: z.literal('ready'), tab, notices: z.array(noticeSchema) }),
  z.object({ k: z.literal('s2c'), tab, conn, frame: serverFrameSchema }),
  z.object({ k: z.literal('result'), tab, id: requestId, result: controlResultSchema }),
  /** To every tab. */
  z.object({ k: z.literal('notice'), notice: noticeSchema }),
])

/** Between tabs on the BroadcastChannel, when a leader tab hosts the server. */
export type BusMessage = z.output<typeof busMessageSchema>
export const busMessageSchema = z.discriminatedUnion('k', [
  /** To the leader `to`; others ignore it. */
  z.object({ k: z.literal('up'), to: tab, m: upMessageSchema }),
  /** From the leader `from`; tabs follow only their current leader. */
  z.object({ k: z.literal('down'), from: tab, m: downMessageSchema }),
  /** A tab asks who leads. */
  z.object({ k: z.literal('who'), tab }),
  /** The leader announces itself, on election and in answer to `who`. */
  z.object({ k: z.literal('leader'), leader: tab, notices: z.array(noticeSchema) }),
])

/** A log entry about a message that was dropped, or a host failure. */
export interface LogEntry {
  readonly level: 'warn' | 'error'
  readonly message: string
  readonly detail?: unknown
}

export type Log = (entry: LogEntry) => void

/** Parses a message from another context; logs and returns undefined if it is invalid. */
export function parseMessage<T>(
  schema: z.ZodType<T>,
  data: unknown,
  where: string,
  log: Log,
): T | undefined {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  log({
    level: 'warn',
    message: `mock host: dropped an invalid message (${where})`,
    detail: z.prettifyError(parsed.error),
  })
  return undefined
}
