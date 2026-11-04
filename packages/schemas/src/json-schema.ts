// JSON Schema export (D26, ARC-6, P8): the world-state, turn and room documents as JSON Schema
// 2020-12 files, generated from the zod schemas, so clients outside this code base (the post-v1
// reconcilers, in Python) validate the same shapes. `pnpm json-schema` writes them to
// docs/json-schema/; `--check`, part of `pnpm check`, fails when they are stale.
import { z } from 'zod'
import { gameStateSchema, roomSchema } from './documents.ts'
import { chatRoomConfigSchema } from './template.ts'
import { mapRoomConfigSchema, worldAssetSchema, worldStateMessageBodySchema } from './world.ts'

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

/** Every exported schema (D26: world-state, turn and room documents), in file-name order. */
export const JSON_SCHEMA_EXPORTS: readonly JsonSchemaExport[] = Object.freeze([
  {
    file: 'chat-room-config.schema.json',
    title: 'Chat room config, version 2',
    schema: chatRoomConfigSchema,
  },
  { file: 'game-state.schema.json', title: 'Turn state (`game-state`)', schema: gameStateSchema },
  { file: 'map-room-config.schema.json', title: 'Map room config', schema: mapRoomConfigSchema },
  { file: 'room.schema.json', title: 'Room document (`rooms:<roomId>`)', schema: roomSchema },
  { file: 'world-asset.schema.json', title: 'World-state asset', schema: worldAssetSchema },
  {
    file: 'world-state-message.schema.json',
    title: 'World-state message body',
    schema: worldStateMessageBodySchema,
  },
])

/**
 * One export as JSON Schema 2020-12, with its `$id` and title. Refinements zod cannot express
 * (each asset keyed by its own id, unique participants) are not in the JSON Schema; the
 * descriptions say so where it matters, and zod remains the authority in this code base.
 */
export function toJsonSchema(entry: JsonSchemaExport): Record<string, unknown> {
  const generated = z.toJSONSchema(entry.schema, { target: 'draft-2020-12', io: 'input' })
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
