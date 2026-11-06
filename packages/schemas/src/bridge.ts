// The bridge protocol between the Python SDK `wrx` and whatever runs it (SRD Annex C PD2, PD3,
// PY-2, PY-4; WP 6.1): an operation name and a JSON request go in, one JSON reply comes out. The
// browser runner (WP 6.2) answers on the page, from the logged-in session, checked against the
// role; the native runner (later) answers from its own XMPP connection. Only strings cross, so
// the side that answers parses every request with these schemas as untrusted input.
//
// Version 1 holds the read operations (PY-2's read layer). Act and adjudicate (WP 6.4) add their
// operations in a later version; `writeDraft` and `postProposal`, the spike's names, are kept for
// them. The protocol is exported as JSON Schema (`docs/json-schema/bridge-protocol.schema.json`),
// from which the SDK's Python models are generated, so the two sides cannot drift (PY-1).
//
// Imported as `@wrx/schemas/bridge`, not from the package index: the app's main bundle does not
// carry it (PY-5).
import { z } from 'zod'
import { idSchema, isoDateTimeSchema, loginNameSchema } from './common.ts'
import {
  forceSchema,
  gameSetupSchema,
  gameStateSchema,
  objectivesSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import { chatMessageBodySchema } from './message.ts'
import { templateMessageBodySchema } from './template.ts'
import { worldStateMessageBodySchema, worldStateSchema } from './world.ts'

/** The protocol's version; a change to an operation's shapes is a new version. */
export const BRIDGE_PROTOCOL_VERSION = 1

/** Every operation of version 1, the read layer (PY-2). */
export const BRIDGE_OPS = Object.freeze([
  'readContext',
  'readGameSetup',
  'readTurn',
  'readForces',
  'readRoles',
  'readRooms',
  'readRoomMessages',
  'readWorldState',
  'readObjectives',
] as const)
export type BridgeOp = (typeof BRIDGE_OPS)[number]

/** Why an operation failed, so a script can tell a refusal from a fault. */
export const BRIDGE_ERROR_CODES = Object.freeze([
  'unknown-op',
  'invalid-request',
  'forbidden',
  'not-found',
  'unavailable',
  'failed',
] as const)
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number]

export const BRIDGE_LIMITS = Object.freeze({
  /** A request's JSON, in characters. Read requests are small. */
  requestChars: 10_000,
  /** Most messages in one page of `readRoomMessages`. */
  messagesPage: 500,
  /** Messages in a page when the request does not say. */
  messagesPageDefault: 100,
  /** A paging cursor, in characters; opaque to the SDK. */
  cursorChars: 512,
  /** A message id (the server's stanza id), in characters. */
  messageIdChars: 256,
  /** An error reply's text, in characters. */
  errorChars: 2_000,
})

export const bridgeOpSchema = z.enum(BRIDGE_OPS).describe('A bridge operation (protocol 1)')

export const bridgeErrorCodeSchema = z
  .enum(BRIDGE_ERROR_CODES)
  .describe(
    '`unknown-op`: not an operation of this protocol; `invalid-request`: the request failed its schema; `forbidden`: the role may not do it (PD2); `not-found`: no such room or force for this role; `unavailable`: not loaded yet or offline; `failed`: anything else',
  )

/** The request of an operation that takes none: `{}`. */
export const emptyRequestSchema = z.strictObject({}).describe('No parameters: `{}`')

export const readRoomMessagesRequestSchema = z
  .strictObject({
    roomId: idSchema.describe('A room the role is in'),
    limit: z
      .int()
      .min(1)
      .max(BRIDGE_LIMITS.messagesPage)
      .default(BRIDGE_LIMITS.messagesPageDefault)
      .describe('Most messages in this page'),
    order: z
      .enum(['oldest-first', 'newest-first'])
      .default('oldest-first')
      .describe('The page order, and the direction `cursor` continues in'),
    cursor: z
      .string()
      .min(1)
      .max(BRIDGE_LIMITS.cursorChars)
      .optional()
      .describe("The previous page's `cursor`, to continue; unset, start at the first message"),
  })
  .describe("One page of a room's messages, as the role sees them")

export const readObjectivesRequestSchema = z
  .strictObject({ forceId: idSchema.describe('The force whose objectives to read') })
  .describe("A force's objectives, if the role may read them (§3 rule 14)")

export const contextSchema = z
  .object({
    protocolVersion: z
      .literal(BRIDGE_PROTOCOL_VERSION)
      .describe('The protocol version the bridge speaks'),
    isAdmin: z.boolean().describe('The script runs as the game admin'),
    roleId: idSchema
      .nullable()
      .describe('The role the script runs as (PD2); null for the admin, who has no role'),
    forceId: idSchema.nullable().describe("The role's force; null for the admin"),
  })
  .describe('Who the script runs as: data, not access; the bridge enforces access (PD2, PY-4)')

export const messageSenderSchema = z
  .object({
    isAdmin: z.boolean().describe("Sent from the admin's real JID"),
    roleId: idSchema
      .nullable()
      .describe('The role whose account sent it; null for the admin or an unknown account'),
    loginName: loginNameSchema
      .nullable()
      .describe("The sender's account name (`admin` for the admin); null if unknown"),
  })
  .describe('Who sent a message, from the stanza, never from the body (§3 rule 3)')

export const roomMessageSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(BRIDGE_LIMITS.messageIdChars)
      .describe("The server's stanza id; unique within the room"),
    roomId: idSchema.describe('The room it was posted in'),
    sentAt: isoDateTimeSchema.describe('Server time'),
    sender: messageSenderSchema,
    body: z
      .discriminatedUnion('type', [
        chatMessageBodySchema,
        templateMessageBodySchema,
        worldStateMessageBodySchema,
      ])
      .describe('The body; messages whose body fails validation are left out, as clients do'),
  })
  .describe('A message in a room, with its sender and server time')

export const readGameSetupResultSchema = z
  .object({ setup: gameSetupSchema })
  .describe('The game setup document')

export const readTurnResultSchema = z
  .object({
    state: gameStateSchema.nullable().describe('The turn and phase; null before the first publish'),
  })
  .describe('The current turn and phase (D7)')

export const readForcesResultSchema = z
  .object({ forces: z.array(forceSchema).describe('The forces the role can read, in order') })
  .describe("The game's forces")

export const readRolesResultSchema = z
  .object({ roles: z.array(roleSchema).describe('The roles the role can read, in order') })
  .describe("The game's roles")

export const readRoomsResultSchema = z
  .object({ rooms: z.array(roomSchema).describe('The rooms the role is in, in order') })
  .describe("The role's rooms")

export const readRoomMessagesResultSchema = z
  .object({
    messages: z.array(roomMessageSchema).describe('This page, in the requested order'),
    cursor: z
      .string()
      .min(1)
      .max(BRIDGE_LIMITS.cursorChars)
      .nullable()
      .describe('Pass it back for the next page; null when there are no more'),
  })
  .describe("One page of a room's messages")

export const readWorldStateResultSchema = z
  .object({
    state: worldStateSchema
      .nullable()
      .describe('The latest world state from the admin in the map room (D25); null if none'),
    messageId: z
      .string()
      .min(1)
      .max(BRIDGE_LIMITS.messageIdChars)
      .nullable()
      .describe('The stanza id of the message that carried it'),
    sentAt: isoDateTimeSchema.nullable().describe('When the admin posted it, server time'),
  })
  .describe('The latest published world state')

export const readObjectivesResultSchema = z
  .object({
    objectives: objectivesSchema
      .nullable()
      .describe("The force's newest objectives (§3 rule 14); null if none"),
  })
  .describe("A force's objectives")

/** Each operation's request schema. */
export const BRIDGE_REQUESTS = Object.freeze({
  readContext: emptyRequestSchema,
  readGameSetup: emptyRequestSchema,
  readTurn: emptyRequestSchema,
  readForces: emptyRequestSchema,
  readRoles: emptyRequestSchema,
  readRooms: emptyRequestSchema,
  readRoomMessages: readRoomMessagesRequestSchema,
  readWorldState: emptyRequestSchema,
  readObjectives: readObjectivesRequestSchema,
} satisfies Record<BridgeOp, z.ZodType>)

/** Each operation's result: the `value` of its `ok` reply. */
export const BRIDGE_RESULTS = Object.freeze({
  readContext: contextSchema,
  readGameSetup: readGameSetupResultSchema,
  readTurn: readTurnResultSchema,
  readForces: readForcesResultSchema,
  readRoles: readRolesResultSchema,
  readRooms: readRoomsResultSchema,
  readRoomMessages: readRoomMessagesResultSchema,
  readWorldState: readWorldStateResultSchema,
  readObjectives: readObjectivesResultSchema,
} satisfies Record<BridgeOp, z.ZodType>)

export type BridgeRequest<Op extends BridgeOp> = z.output<(typeof BRIDGE_REQUESTS)[Op]>
export type BridgeResult<Op extends BridgeOp> = z.input<(typeof BRIDGE_RESULTS)[Op]>

export const bridgeOkReplySchema = z
  .object({
    ok: z.literal(true),
    value: z.unknown().describe("The operation's result"),
  })
  .describe('A successful reply')

export const bridgeErrorReplySchema = z
  .object({
    ok: z.literal(false),
    code: bridgeErrorCodeSchema,
    error: z.string().max(BRIDGE_LIMITS.errorChars).describe('What went wrong, for the script'),
  })
  .describe('A refused or failed operation')

export const bridgeReplySchema = z
  .discriminatedUnion('ok', [bridgeOkReplySchema, bridgeErrorReplySchema])
  .describe('Every reply, as JSON text')

export type BridgeReply = z.infer<typeof bridgeReplySchema>

export const bridgeRequestsSchema = z
  .object(BRIDGE_REQUESTS)
  .describe("Each operation's request, by operation name")

export const bridgeResultsSchema = z
  .object(BRIDGE_RESULTS)
  .describe("Each operation's result, the `value` of its reply, by operation name")

/**
 * The whole protocol as one schema, for the JSON Schema export: a catalogue, not a message.
 * `op` names every operation; `requests` and `results` give, by operation, a call's request
 * and its reply's `value`; `reply` is the envelope of every reply.
 */
export const bridgeProtocolSchema = z
  .object({
    protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
    op: bridgeOpSchema,
    requests: bridgeRequestsSchema,
    results: bridgeResultsSchema,
    reply: bridgeReplySchema,
  })
  .describe(
    'The bridge protocol between the Python SDK and its runner, version 1: a catalogue of its parts, not a message',
  )

export type ParsedBridgeCall =
  | { readonly [Op in BridgeOp]: { ok: true; op: Op; request: BridgeRequest<Op> } }[BridgeOp]
  | { ok: false; reply: string }

function isOp(op: string): op is BridgeOp {
  return (BRIDGE_OPS as readonly string[]).includes(op)
}

/**
 * Parses a call from the SDK: the operation name and the request's JSON text, both untrusted.
 * On failure, `reply` is the error reply to send back.
 */
export function parseBridgeCall(op: string, payload: string): ParsedBridgeCall {
  if (!isOp(op)) return { ok: false, reply: bridgeError('unknown-op', 'not an operation') }
  if (payload.length > BRIDGE_LIMITS.requestChars) {
    return { ok: false, reply: bridgeError('invalid-request', 'the request is too long') }
  }
  let json: unknown
  try {
    json = JSON.parse(payload)
  } catch {
    return { ok: false, reply: bridgeError('invalid-request', 'the request is not JSON') }
  }
  const parsed = BRIDGE_REQUESTS[op].safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue === undefined || issue.path.length === 0 ? '' : `${issue.path.join('.')}: `
    return {
      ok: false,
      reply: bridgeError('invalid-request', `${where}${issue?.message ?? 'invalid'}`),
    }
  }
  const accepted = { ok: true as const, op, request: parsed.data }
  return accepted as ParsedBridgeCall
}

/**
 * The reply to a successful call, as JSON text. The value is checked against the operation's
 * result schema first; a value that fails is a fault on this side, and goes back as `failed`.
 */
export function bridgeOk<Op extends BridgeOp>(op: Op, value: BridgeResult<Op>): string {
  const checked = BRIDGE_RESULTS[op].safeParse(value)
  if (!checked.success) return bridgeError('failed', `the ${op} result failed its schema`)
  return JSON.stringify({ ok: true, value: checked.data })
}

/** An error reply, as JSON text. */
export function bridgeError(code: BridgeErrorCode, error: string): string {
  return JSON.stringify({ ok: false, code, error: error.slice(0, BRIDGE_LIMITS.errorChars) })
}
