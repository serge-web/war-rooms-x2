import { chatMessageBodySchema } from '@wrx/schemas'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { game, room } from './fixtures.ts'
import {
  chatConfigSchema,
  chatRoomType,
  createRoomTypeRegistry,
  defaultRoomTypes,
  roomConfig,
  withSlots,
} from './registry.ts'
import type { RoomTypeDefinition, RoomTypeRegistry } from './registry.ts'

describe('room-type registry (ARC-5)', () => {
  it('registers chat, with an empty config schema and the chat message schema', () => {
    const registry = defaultRoomTypes()
    const chat = registry.get('chat')
    expect(registry.list().map((d) => d.type)).toEqual(['chat'])
    expect(chat?.messageSchema).toBe(chatMessageBodySchema)
    expect(chat?.configSchema.safeParse({}).success).toBe(true)
    expect(chat?.playerComponent).toBeUndefined()
    expect(chat?.adminEditor).toBeUndefined()
    expect(chat?.icon).toBe('chat')
    expect(registry.get('map')).toBeUndefined()
  })

  it('validates chat bodies with the message schema', () => {
    const ok = { type: 'chat', schemaVersion: 1, content: { text: 'hi' } }
    expect(chatRoomType.messageSchema.safeParse(ok).success).toBe(true)
    expect(chatRoomType.messageSchema.safeParse({ ...ok, content: { text: '' } }).success).toBe(
      false,
    )
  })

  it('fills UI slots without mutating the original', () => {
    const base = defaultRoomTypes()
    const panel = { name: 'ChatPanel' }
    const filled = withSlots<{ name: string }, string>(base, {
      chat: { playerComponent: panel, adminEditor: 'editor' },
    })
    expect(filled.get('chat')?.playerComponent).toBe(panel)
    expect(filled.get('chat')?.adminEditor).toBe('editor')
    expect(base.get('chat')?.playerComponent).toBeUndefined()
    expect(Object.isFrozen(filled.get('chat'))).toBe(true)
    expectTypeOf(filled).toEqualTypeOf<RoomTypeRegistry<{ name: string }, string>>()
  })

  it('refuses slots for an unknown type, bad type ids and duplicates', () => {
    expect(() => withSlots(defaultRoomTypes(), { map: { playerComponent: 1 } })).toThrow(
      /not registered/,
    )
    expect(() => createRoomTypeRegistry([{ ...chatRoomType, type: 'Not A Slug' }])).toThrow(
      /not a slug/,
    )
    expect(() => createRoomTypeRegistry([chatRoomType, chatRoomType])).toThrow(/twice/)
  })

  it('types the slots generically, so React stays out of this package', () => {
    expectTypeOf<RoomTypeDefinition<'P', 'E'>['playerComponent']>().toEqualTypeOf<'P' | undefined>()
    expectTypeOf<RoomTypeDefinition<'P', 'E'>['adminEditor']>().toEqualTypeOf<'E' | undefined>()
  })

  it('resolves a room config from the game defaults and the room', () => {
    const registry = defaultRoomTypes()
    const chat = room('a', [])
    expect(roomConfig(registry, chat, game())).toEqual({ ok: true, value: {} })
    expect(roomConfig(registry, { ...chat, roomType: 'map' }, undefined)).toEqual({
      ok: false,
      error: 'room type "map" is not supported',
    })
    const strict = createRoomTypeRegistry([
      { ...chatRoomType, configSchema: chatConfigSchema.strict() },
    ])
    const withDefaults = { ...game(), roomTypeDefaults: { chat: { colour: 'x' } } }
    expect(roomConfig(strict, chat, withDefaults).ok).toBe(false)
  })
})
