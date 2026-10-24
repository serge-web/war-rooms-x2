// The room-type registry (ARC-5): one entry per room type, shared by admin and player.
//
// The registry is framework-neutral: the player component and admin editor are generic slots
// (`Player`, `Editor`), so this package does not depend on React. The React shapes for the slots
// live in `@wrx/hooks` (`ReactRoomTypeDefinition`). WP 2.6 and WP 2.2 fill them by building a
// registry with `withSlots`, which returns a new registry; nothing is ever mutated, so one
// registry can be shared by every pane (ARC-2).
import { chatMessageBodySchema, slugSchema } from '@wrx/schemas'
import type { GameSetup, MessageBody, Result, Room } from '@wrx/schemas'
import { z } from 'zod'

export interface RoomTypeDefinition<Player = unknown, Editor = unknown, Config = unknown> {
  /** The `roomType` slug stored in `rooms:<roomId>` documents. */
  readonly type: string
  /** Shown in the admin's room-type picker. */
  readonly label: string
  /**
   * Name of an icon in the client's bundled icon set (NFR-7), e.g. `chat`. A name rather than
   * an image or component keeps this entry framework-neutral; the UI kit maps names to icons.
   */
  readonly icon: string
  /** Validates `room.config`, after `game-setup.roomTypeDefaults[type]` is merged under it. */
  readonly configSchema: z.ZodType<Config>
  /** Validates the bodies of this room's messages, after `messageBodySchema` (R9). */
  readonly messageSchema: z.ZodType<MessageBody>
  /** The room panel in the player workspace. Filled by WP 2.6; `undefined` until then. */
  readonly playerComponent: Player | undefined
  /** The type-specific part of the admin's room editor. Filled by WP 2.2. */
  readonly adminEditor: Editor | undefined
}

export interface RoomTypeRegistry<Player = unknown, Editor = unknown> {
  get(type: string): RoomTypeDefinition<Player, Editor> | undefined
  /** Every registered type, in registration order. */
  list(): readonly RoomTypeDefinition<Player, Editor>[]
}

/** Config of a chat room: nothing in v1. */
export const chatConfigSchema = z.object({}).describe('Chat room config: empty in v1')
export type ChatConfig = z.infer<typeof chatConfigSchema>

/** The `chat` room type, with its UI slots empty. */
export const chatRoomType: RoomTypeDefinition<never, never, ChatConfig> = Object.freeze({
  type: 'chat',
  label: 'Chat',
  icon: 'chat',
  configSchema: chatConfigSchema,
  messageSchema: chatMessageBodySchema,
  playerComponent: undefined,
  adminEditor: undefined,
})

/** Builds a registry. Throws on a bad or duplicate type: registries are code, not network data. */
export function createRoomTypeRegistry<Player, Editor>(
  definitions: readonly RoomTypeDefinition<Player, Editor>[],
): RoomTypeRegistry<Player, Editor> {
  const byType = new Map<string, RoomTypeDefinition<Player, Editor>>()
  for (const definition of definitions) {
    if (!slugSchema.safeParse(definition.type).success) {
      throw new RangeError(`Room type ${JSON.stringify(definition.type)} is not a slug`)
    }
    if (byType.has(definition.type)) {
      throw new RangeError(`Room type "${definition.type}" is registered twice`)
    }
    byType.set(definition.type, Object.freeze({ ...definition }))
  }
  const list = Object.freeze([...byType.values()])
  return Object.freeze({ get: (type: string) => byType.get(type), list: () => list })
}

/** The v1 registry with empty UI slots: what the domain layer and tests use. */
export function defaultRoomTypes(): RoomTypeRegistry<never, never> {
  return createRoomTypeRegistry([chatRoomType])
}

/**
 * A copy of `registry` with UI slots filled in, by type; types not named get empty slots.
 * Filling a slot for an unregistered type throws. Typical use, once per app:
 * `withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), { chat: { playerComponent: ChatPanel } })`.
 */
export function withSlots<Player, Editor>(
  registry: RoomTypeRegistry,
  slots: Readonly<
    Record<string, { readonly playerComponent?: Player; readonly adminEditor?: Editor }>
  >,
): RoomTypeRegistry<Player, Editor> {
  for (const type of Object.keys(slots)) {
    if (registry.get(type) === undefined) {
      throw new RangeError(`Room type "${type}" is not registered`)
    }
  }
  return createRoomTypeRegistry<Player, Editor>(
    registry.list().map((definition) => {
      const filled = slots[definition.type]
      return {
        ...definition,
        playerComponent: filled?.playerComponent,
        adminEditor: filled?.adminEditor,
      }
    }),
  )
}

/**
 * A room's effective config: the game's default for its type, overlaid by the room's own, then
 * validated by the type (ARC-5). Fails for an unknown type or invalid config.
 */
export function roomConfig<Player, Editor>(
  registry: RoomTypeRegistry<Player, Editor>,
  room: Room,
  game: GameSetup | undefined,
): Result<unknown, string> {
  const definition = registry.get(room.roomType)
  if (definition === undefined) {
    return { ok: false, error: `room type "${room.roomType}" is not supported` }
  }
  const merged = { ...(game?.roomTypeDefaults[room.roomType] ?? {}), ...room.config }
  const parsed = definition.configSchema.safeParse(merged)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) }
}
