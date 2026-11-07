// JSON Schema export (D26, ARC-6, P8): the world-state, turn and room documents as JSON Schema
// 2020-12 files, generated from the zod schemas, so clients outside this code base (the post-v1
// reconcilers, in Python) validate the same shapes. `pnpm json-schema` writes them to
// docs/json-schema/; `--check`, part of `pnpm check`, fails when they are stale.
import { z } from 'zod'
import {
  bridgeErrorCodeSchema,
  bridgeErrorReplySchema,
  bridgeEventSchema,
  messageEventSchema,
  phaseEventSchema,
  bridgeOkReplySchema,
  bridgeOpSchema,
  bridgeProtocolSchema,
  bridgeReplySchema,
  bridgeRequestsSchema,
  bridgeResultsSchema,
  contextSchema,
  emptyRequestSchema,
  messageSenderSchema,
  postProposalRequestSchema,
  readDraftResultSchema,
  readForcesResultSchema,
  readGameSetupResultSchema,
  readObjectivesRequestSchema,
  readObjectivesResultSchema,
  readRolesResultSchema,
  readRoomMessagesRequestSchema,
  readRoomMessagesResultSchema,
  readRoomsResultSchema,
  readTurnResultSchema,
  readWorldStateResultSchema,
  roomMessageSchema,
  sendMessageRequestSchema,
  sendTemplateRequestSchema,
  sentResultSchema,
  subscribeMessagesRequestSchema,
  subscribedResultSchema,
  writeDraftRequestSchema,
  writeDraftResultSchema,
} from './bridge.ts'
import {
  forceSchema,
  gameSetupSchema,
  gameStateSchema,
  objectivesSchema,
  participantSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import { chatMessageBodySchema } from './message.ts'
import { chatRoomConfigSchema, templateEntrySchema, templateMessageBodySchema } from './template.ts'
import { themeSchema, themeTokensSchema } from './theme.ts'
import {
  umpireRoomConfigSchema,
  worldProposalContentSchema,
  worldProposalMessageBodySchema,
} from './umpire.ts'
import {
  latLonSchema,
  mapRoomConfigSchema,
  worldAssetSchema,
  worldStateMessageBodySchema,
  worldStateSchema,
} from './world.ts'

/** Where the files are published, under the repository: `docs/json-schema/`. */
export const JSON_SCHEMA_DIR = 'docs/json-schema'

/** The `$id` prefix of the exported files: a URN, stable, so reconcilers may cite it. */
export const JSON_SCHEMA_ID_BASE = 'urn:wrx1:json-schema:'

export interface JsonSchemaExport {
  /** File name under {@link JSON_SCHEMA_DIR}. */
  readonly file: string
  readonly title: string
  readonly schema: z.ZodType
}

/**
 * Every exported schema (D26: world-state, turn and room documents; WP 6.1: the other documents
 * and message bodies the Python SDK reads, and the bridge protocol), in file-name order.
 */
export const JSON_SCHEMA_EXPORTS: readonly JsonSchemaExport[] = Object.freeze([
  {
    file: 'bridge-protocol.schema.json',
    title: 'Python SDK bridge protocol, version 2',
    schema: bridgeProtocolSchema,
  },
  { file: 'chat-message.schema.json', title: 'Chat message body', schema: chatMessageBodySchema },
  {
    file: 'chat-room-config.schema.json',
    title: 'Chat room config, version 2',
    schema: chatRoomConfigSchema,
  },
  { file: 'force.schema.json', title: 'Force (`forces:<forceId>`)', schema: forceSchema },
  { file: 'game-setup.schema.json', title: 'Game setup (`game-setup`)', schema: gameSetupSchema },
  { file: 'game-state.schema.json', title: 'Turn state (`game-state`)', schema: gameStateSchema },
  { file: 'map-room-config.schema.json', title: 'Map room config', schema: mapRoomConfigSchema },
  {
    file: 'objectives.schema.json',
    title: 'Objectives (`objectives:<forceId>`)',
    schema: objectivesSchema,
  },
  { file: 'role.schema.json', title: 'Role (`roles:<roleId>`)', schema: roleSchema },
  { file: 'room.schema.json', title: 'Room document (`rooms:<roomId>`)', schema: roomSchema },
  {
    file: 'template-message.schema.json',
    title: 'Template message body',
    schema: templateMessageBodySchema,
  },
  {
    file: 'umpire-room-config.schema.json',
    title: 'Umpire room config',
    schema: umpireRoomConfigSchema,
  },
  { file: 'world-asset.schema.json', title: 'World-state asset', schema: worldAssetSchema },
  {
    file: 'world-proposal-message.schema.json',
    title: 'White Force proposal message body',
    schema: worldProposalMessageBodySchema,
  },
  {
    file: 'world-state-message.schema.json',
    title: 'World-state message body',
    schema: worldStateMessageBodySchema,
  },
])

/** `world-state-message.schema.json` → `WorldStateMessage`. */
export function exportName(file: string): string {
  return file
    .replace(/\.schema\.json$/, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * The definitions named in `$defs` wherever they appear (WP 6.1), so generated models get these
 * names, not ones made up from a field (S17 found the asset model called `Assets`). An exported
 * schema is named after its file (`exportName`); the rest are named here.
 */
function definitionNames(): Map<z.core.$ZodType, string> {
  return new Map<z.core.$ZodType, string>([
    ...JSON_SCHEMA_EXPORTS.map((e): [z.core.$ZodType, string] => [e.schema, exportName(e.file)]),
    [worldStateSchema, 'WorldState'],
    [themeSchema, 'Theme'],
    [themeTokensSchema, 'ThemeTokens'],
    [participantSchema, 'Participant'],
    [chatMessageBodySchema.shape.content, 'ChatContent'],
    [templateMessageBodySchema.shape.content, 'TemplateContent'],
    [templateEntrySchema, 'TemplateEntry'],
    [latLonSchema, 'LatLon'],
    [bridgeOpSchema, 'BridgeOp'],
    [bridgeErrorCodeSchema, 'BridgeErrorCode'],
    [bridgeRequestsSchema, 'BridgeRequests'],
    [bridgeResultsSchema, 'BridgeResults'],
    [bridgeReplySchema, 'BridgeReply'],
    [bridgeOkReplySchema, 'BridgeOkReply'],
    [bridgeErrorReplySchema, 'BridgeErrorReply'],
    [emptyRequestSchema, 'EmptyRequest'],
    [readRoomMessagesRequestSchema, 'ReadRoomMessagesRequest'],
    [readObjectivesRequestSchema, 'ReadObjectivesRequest'],
    [contextSchema, 'Context'],
    [messageSenderSchema, 'MessageSender'],
    [roomMessageSchema, 'RoomMessage'],
    [readGameSetupResultSchema, 'ReadGameSetupResult'],
    [readTurnResultSchema, 'ReadTurnResult'],
    [readForcesResultSchema, 'ReadForcesResult'],
    [readRolesResultSchema, 'ReadRolesResult'],
    [readRoomsResultSchema, 'ReadRoomsResult'],
    [readRoomMessagesResultSchema, 'ReadRoomMessagesResult'],
    [readWorldStateResultSchema, 'ReadWorldStateResult'],
    [readObjectivesResultSchema, 'ReadObjectivesResult'],
    [worldProposalContentSchema, 'WorldProposalContent'],
    [bridgeEventSchema, 'BridgeEvent'],
    [messageEventSchema, 'MessageEvent'],
    [phaseEventSchema, 'PhaseEvent'],
    [sendMessageRequestSchema, 'SendMessageRequest'],
    [sendTemplateRequestSchema, 'SendTemplateRequest'],
    [writeDraftRequestSchema, 'WriteDraftRequest'],
    [postProposalRequestSchema, 'PostProposalRequest'],
    [subscribeMessagesRequestSchema, 'SubscribeMessagesRequest'],
    [sentResultSchema, 'SentResult'],
    [readDraftResultSchema, 'ReadDraftResult'],
    [writeDraftResultSchema, 'WriteDraftResult'],
    [subscribedResultSchema, 'SubscribedResult'],
  ])
}

/**
 * The metadata the export reads: zod's own (descriptions, `maxProperties`), plus a `$defs` name
 * for each named definition except the export's root, which stays the document itself.
 */
function exportMetadata(root: z.core.$ZodType): z.core.$ZodRegistry<z.core.GlobalMeta> {
  const names = definitionNames()
  const registry = z.registry<z.core.GlobalMeta>()
  registry.get = (schema) => {
    const meta = z.globalRegistry.get(schema)
    const name = schema === root ? undefined : names.get(schema)
    return name === undefined ? meta : { ...meta, id: name }
  }
  return registry
}

/**
 * One export as JSON Schema 2020-12, with its `$id` and title. Refinements JSON Schema cannot
 * express (each asset keyed by its own id, unique participants) are not in it; the descriptions
 * say so where it matters, the Python SDK checks the asset keys itself, and zod remains the
 * authority in this code base. The 5,000-asset cap is `maxProperties`.
 */
export function toJsonSchema(entry: JsonSchemaExport): Record<string, unknown> {
  const generated = z.toJSONSchema(entry.schema, {
    target: 'draft-2020-12',
    io: 'input',
    metadata: exportMetadata(entry.schema),
  })
  const { $schema, ...rest } = generated
  return {
    $schema: $schema ?? 'https://json-schema.org/draft/2020-12/schema',
    $id: `${JSON_SCHEMA_ID_BASE}${entry.file}`,
    title: entry.title,
    ...rest,
  }
}

/** Every file's text, by file name, as `pnpm json-schema` writes it. */
export function renderJsonSchemas(): Map<string, string> {
  return new Map(
    JSON_SCHEMA_EXPORTS.map((entry) => [
      entry.file,
      `${JSON.stringify(toJsonSchema(entry), null, 2)}\n`,
    ]),
  )
}
