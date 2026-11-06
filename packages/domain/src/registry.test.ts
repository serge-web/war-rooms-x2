import { messageBodySchema, worldStateMessageBodySchema } from '@wrx/schemas'
import { blueReportsConfig, sampleWorldState } from '@wrx/schemas/fixtures'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { game, room } from './fixtures.ts'
import {
  chatConfigSchema,
  chatRoomType,
  createRoomTypeRegistry,
  defaultRoomTypes,
  mapRoomType,
  roomConfig,
  withSlots,
} from './registry.ts'
import type { RoomTypeDefinition, RoomTypeRegistry } from './registry.ts'

describe('room-type registry (ARC-5)', () => {
  it('registers chat, with its config version 2 and chat and templated messages', () => {
    const registry = defaultRoomTypes()
    const chat = registry.get('chat')
    expect(registry.list().map((d) => d.type)).toEqual(['chat', 'map', 'umpire'])
    const proposal = {
      type: 'world-proposal',
      schemaVersion: 1,
      content: { state: sampleWorldState(), summary: 'Moved.' },
    }
    const text = { type: 'chat', schemaVersion: 1, content: { text: 'hi' } }
    expect(chat?.messageSchema.safeParse(text).success).toBe(true)
    // PY-8: a proposal is never a chat room's message; the umpire room takes it.
    expect(messageBodySchema.safeParse(proposal).success).toBe(true)
    expect(chat?.messageSchema.safeParse(proposal).success).toBe(false)
    const umpire = registry.get('umpire')
    expect(umpire?.messageSchema.safeParse(proposal).success).toBe(true)
    expect(umpire?.messageSchema.safeParse(text).success).toBe(true)
    expect(umpire?.configSchema.safeParse({}).success).toBe(true)
    expect(umpire?.configSchema.safeParse({ freeText: false }).success).toBe(false)
    expect(chat?.configSchema.safeParse({}).success).toBe(true)
    expect(chat?.configSchema.safeParse(blueReportsConfig()).success).toBe(true)
    expect(chat?.configSchema.safeParse({ schemaVersion: 2 }).success).toBe(false)
    expect(chat?.playerComponent).toBeUndefined()
    expect(chat?.adminEditor).toBeUndefined()
    expect(chat?.icon).toBe('chat')
    expect(registry.get('poll')).toBeUndefined()
  })

  it('registers map, with its config and world-state messages only (ARC-5, D25)', () => {
    const map = defaultRoomTypes().get('map')
    expect(map?.label).toBe('Map')
    expect(map?.icon).toBe('map')
    expect(map?.messageSchema).toBe(worldStateMessageBodySchema)
    expect(map?.playerComponent).toBeUndefined()
    expect(map?.configSchema.safeParse({}).success).toBe(true)
    expect(map?.configSchema.safeParse({ schemaVersion: 1, zoom: 8 }).success).toBe(true)
    expect(map?.configSchema.safeParse({ zoom: -1 }).success).toBe(false)
    const state = { type: 'world-state', schemaVersion: 1, content: sampleWorldState() }
    expect(mapRoomType.messageSchema.safeParse(state).success).toBe(true)
    const chat = { type: 'chat', schemaVersion: 1, content: { text: 'hi' } }
    expect(mapRoomType.messageSchema.safeParse(chat).success).toBe(false)
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
    expect(() => withSlots(defaultRoomTypes(), { poll: { playerComponent: 1 } })).toThrow(
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
    // Version 1 (`{}`): free text, no templates (Annex A).
    expect(roomConfig(registry, chat, game())).toEqual({
      ok: true,
      value: { schemaVersion: 2, freeText: true, templates: [] },
    })
    expect(roomConfig(registry, { ...chat, config: blueReportsConfig() }, game())).toEqual({
      ok: true,
      value: blueReportsConfig(),
    })
    expect(roomConfig(registry, { ...chat, roomType: 'poll' }, undefined)).toEqual({
      ok: false,
      error: 'room type "poll" is not supported',
    })
    expect(roomConfig(registry, { ...chat, roomType: 'map' }, undefined)).toEqual({
      ok: true,
      value: { schemaVersion: 1 },
    })
    const off = { schemaVersion: 2, freeText: false, templates: [] }
    const withDefaults = { ...game(), roomTypeDefaults: { chat: off } }
    expect(roomConfig(registry, chat, withDefaults)).toEqual({ ok: true, value: off })
    const broken = { ...game(), roomTypeDefaults: { chat: { schemaVersion: 2, freeText: 'no' } } }
    expect(roomConfig(registry, chat, broken).ok).toBe(false)
    expect(chatConfigSchema.safeParse({ schemaVersion: 3 }).success).toBe(false)
  })
})
