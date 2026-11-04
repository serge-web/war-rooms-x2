import { describe, expect, it } from 'vitest'
import { LIMITS } from './common.ts'
import { checkDesign, withMapRoom } from './design.ts'
import { INITIAL_GAME_STATE, gameStateSchema } from './documents.ts'
import {
  FORCE,
  ROOM,
  WORLD_ASSET,
  demoDesign,
  mapRoom,
  sampleDesign,
  sampleWorldState,
} from './fixtures.ts'
import { chatMessageBodySchema, messageBodySchema } from './message.ts'
import { parseDocument } from './parse.ts'
import {
  MAP_ROOM_TYPE,
  hasMapParticipants,
  mapParticipants,
  mapRoomConfigReader,
  sidcSchema,
  worldAssetSchema,
  worldStateMessageBodySchema,
  worldStateSchema,
} from './world.ts'
import type { WorldAsset } from './world.ts'

const NEW_ID = '90000000-0000-4000-8000-0000000000aa'

function asset(patch: Partial<WorldAsset> = {}): WorldAsset {
  const base = sampleWorldState().assets[WORLD_ASSET.blueInfantry]
  if (base === undefined) throw new Error('fixture')
  return { ...base, ...patch }
}

describe('turn state (`game-state`, D7)', () => {
  it('holds a turn from 1 and a phase', () => {
    expect(gameStateSchema.safeParse(INITIAL_GAME_STATE).success).toBe(true)
    expect(INITIAL_GAME_STATE).toEqual({ schemaVersion: 1, turn: 1, phase: 'planning' })
    const ok = { schemaVersion: 1, turn: 7, phase: 'adjudication' }
    expect(parseDocument('game-state', JSON.stringify(ok))).toEqual({ ok: true, value: ok })
  })

  it.each([
    ['turn 0', { schemaVersion: 1, turn: 0, phase: 'planning' }],
    ['a fractional turn', { schemaVersion: 1, turn: 1.5, phase: 'planning' }],
    ['a turn over the bound', { schemaVersion: 1, turn: LIMITS.turnMax + 1, phase: 'planning' }],
    ['an unknown phase', { schemaVersion: 1, turn: 1, phase: 'orders' }],
    ['no phase', { schemaVersion: 1, turn: 1 }],
    ['the reserved empty document of v1', { schemaVersion: 1 }],
  ])('refuses %s', (_, doc) => {
    expect(gameStateSchema.safeParse(doc).success).toBe(false)
  })
})

describe('symbol codes (sidc, §3 rule 17)', () => {
  it.each([
    'SFGPUCI----K---',
    'SHGPUCA----K---',
    'SUAPMF---------',
    'GFGPGLB----K---',
    'S*G*UCI--------',
    '10031000001211000000',
    '130310000012110000000000000000',
  ])('accepts %s', (code) => {
    expect(sidcSchema.safeParse(code).success).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['lower case', 'sfgpuci----k---'],
    ['14 characters', 'SFGPUCI----K--'],
    ['16 characters', 'SFGPUCI----K----'],
    ['an unknown coding scheme', 'XFGPUCI----K---'],
    ['an unknown status', 'SFGQUCI----K---'],
    ['21 digits', '100310000012110000000'],
    ['25 digits', '1003100000121100000000000'],
    ['markup', '<script>alert(1)'],
    ['spaces', 'SFG UCI----K---'],
  ])('refuses %s', (_, code) => {
    expect(sidcSchema.safeParse(code).success).toBe(false)
  })
})

describe('world-state asset (§3 rule 17)', () => {
  it('has exactly the fixed fields', () => {
    expect(Object.keys(worldAssetSchema.shape).sort()).toEqual(
      [
        'category',
        'forceId',
        'fuel',
        'health',
        'id',
        'lat',
        'lon',
        'sidc',
        'state',
        'title',
      ].sort(),
    )
    expect(worldAssetSchema.safeParse(asset()).success).toBe(true)
  })

  it.each([
    ['a latitude past 90', { lat: 90.01 }],
    ['a latitude past -90', { lat: -91 }],
    ['a longitude past 180', { lon: 180.5 }],
    ['a longitude past -180', { lon: -181 }],
    ['an infinite longitude', { lon: Number.POSITIVE_INFINITY }],
    ['health below 0', { health: -1 }],
    ['health over 100', { health: 101 }],
    ['fuel over 100', { fuel: 100.5 }],
    ['a NaN fuel', { fuel: Number.NaN }],
    ['an empty title', { title: '  ' }],
    ['a long title', { title: 'x'.repeat(LIMITS.nameChars + 1) }],
    ['a long category', { category: 'x'.repeat(LIMITS.worldLabelChars + 1) }],
    ['an empty state', { state: '' }],
    ['a slug id', { id: 'blue-1' }],
    ['a slug force', { forceId: 'blue' }],
    ['a bad sidc', { sidc: 'tank' }],
  ])('refuses %s', (_, patch) => {
    expect(worldAssetSchema.safeParse(asset(patch)).success).toBe(false)
  })

  it('accepts the bounds themselves', () => {
    const edges = asset({ lat: -90, lon: 180, health: 0, fuel: 100 })
    expect(worldAssetSchema.safeParse(edges).success).toBe(true)
  })
})

describe('world state (§3 rule 16)', () => {
  it('keys each asset by its own GUID', () => {
    const state = sampleWorldState()
    expect(worldStateSchema.safeParse(state).success).toBe(true)
    for (const [key, value] of Object.entries(state.assets)) expect(value.id).toBe(key)
  })

  it('refuses an asset under another key, a non-GUID key, an array and turn 0', () => {
    const state = sampleWorldState()
    const moved = { ...state, assets: { [NEW_ID]: asset() } }
    expect(worldStateSchema.safeParse(moved).success).toBe(false)
    const slug = { ...state, assets: { 'blue-1': asset() } }
    expect(worldStateSchema.safeParse(slug).success).toBe(false)
    const array = { ...state, assets: Object.values(state.assets) }
    expect(worldStateSchema.safeParse(array).success).toBe(false)
    expect(worldStateSchema.safeParse({ ...state, turn: 0 }).success).toBe(false)
  })

  it('accepts an empty state, and refuses more than the asset bound', () => {
    expect(worldStateSchema.safeParse({ turn: 1, assets: {} }).success).toBe(true)
    const many = Object.fromEntries(
      Array.from({ length: LIMITS.worldStateAssets + 1 }, (_, i) => {
        const id = `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
        return [id, asset({ id })]
      }),
    )
    expect(worldStateSchema.safeParse({ turn: 1, assets: many }).success).toBe(false)
  })

  it('is a message body of type world-state, which a chat room does not take', () => {
    const body = { type: 'world-state', schemaVersion: 1, content: sampleWorldState() }
    expect(worldStateMessageBodySchema.safeParse(body).success).toBe(true)
    const parsed = parseDocument('message', JSON.stringify(body))
    expect(parsed.ok && parsed.value.type).toBe('world-state')
    expect(messageBodySchema.safeParse({ ...body, schemaVersion: 2 }).success).toBe(false)
    expect(chatMessageBodySchema.safeParse(body).success).toBe(false)
  })

  it('fits the sample in a small message, and 1,500 assets under the map-room cap', () => {
    const body = (assets: Record<string, WorldAsset>) =>
      JSON.stringify({ type: 'world-state', schemaVersion: 1, content: { turn: 1, assets } })
    expect(body(sampleWorldState().assets).length).toBeLessThan(LIMITS.messageStanzaBytes)
    const many = Object.fromEntries(
      Array.from({ length: 1_500 }, (_, i) => {
        const id = `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
        return [id, asset({ id, title: `Unit ${i}` })]
      }),
    )
    expect(new TextEncoder().encode(body(many)).length).toBeLessThan(LIMITS.worldStateStanzaBytes)
  })
})

describe('map room config (ARC-5)', () => {
  it('reads {} as the defaults, and version 1 as it is', () => {
    expect(mapRoomConfigReader.parse({})).toEqual({ schemaVersion: 1 })
    const view = { schemaVersion: 1, centre: { lat: 52, lon: 5.9 }, zoom: 11 }
    expect(mapRoomConfigReader.parse(view)).toEqual(view)
  })

  it.each([
    ['a zoom past the bound', { zoom: LIMITS.mapZoomMax + 1 }],
    ['a fractional zoom', { zoom: 2.5 }],
    ['a centre off the globe', { centre: { lat: 95, lon: 0 } }],
    ['version 2', { schemaVersion: 2 }],
    ['an array', []],
  ])('refuses %s', (_, config) => {
    expect(mapRoomConfigReader.safeParse(config).success).toBe(false)
  })
})

describe('the map room (§3 rule 18)', () => {
  it('has every force as a read entry, in force order', () => {
    const design = sampleDesign()
    expect(mapParticipants(design.forces)).toEqual([
      { kind: 'force', id: FORCE.blue, access: 'read' },
      { kind: 'force', id: FORCE.red, access: 'read' },
      { kind: 'force', id: FORCE.white, access: 'read' },
    ])
    const reversed = { participants: [...mapParticipants(design.forces)].reverse() }
    expect(hasMapParticipants(reversed, design.forces)).toBe(true)
  })

  it('the demo design has one, and passes the checks', () => {
    const design = demoDesign()
    expect(design.rooms.filter((r) => r.roomType === MAP_ROOM_TYPE).map((r) => r.id)).toEqual([
      ROOM.map,
    ])
    expect(checkDesign(design)).toEqual([])
  })

  it('a design without one is still valid (designs from before Phase 5)', () => {
    expect(checkDesign(sampleDesign())).toEqual([])
  })

  it('refuses a second map room', () => {
    const design = demoDesign()
    const second = { ...mapRoom(design, NEW_ID), name: 'Second map' }
    const issues = checkDesign({ ...design, rooms: [...design.rooms, second] })
    expect(issues.map((i) => `${i.severity} ${i.path}`)).toEqual([
      `error rooms[${design.rooms.length}].roomType`,
    ])
  })

  it.each([
    ['a missing force', (p: ReturnType<typeof mapParticipants>) => p.slice(1)],
    [
      'a write entry',
      (p: ReturnType<typeof mapParticipants>) =>
        p.map((e, i) => (i === 0 ? { ...e, access: 'write' as const } : e)),
    ],
    [
      'a role entry',
      (p: ReturnType<typeof mapParticipants>) => [
        ...p,
        {
          kind: 'role' as const,
          id: '20000000-0000-4000-8000-000000000001',
          access: 'read' as const,
        },
      ],
    ],
    ['no entries', () => []],
  ])('refuses %s in its participants', (_, change) => {
    const design = demoDesign()
    const rooms = design.rooms.map((r) =>
      r.roomType === MAP_ROOM_TYPE ? { ...r, participants: change(r.participants as never) } : r,
    )
    const issues = checkDesign({ ...design, rooms })
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.path)).toEqual([
      `rooms[${design.rooms.findIndex((r) => r.id === ROOM.map)}].participants`,
    ])
  })

  it('refuses an invalid map room config', () => {
    const design = demoDesign()
    const rooms = design.rooms.map((r) =>
      r.roomType === MAP_ROOM_TYPE ? { ...r, config: { zoom: 99 } } : r,
    )
    expect(checkDesign({ ...design, rooms }).map((i) => i.path)).toEqual([
      `rooms[${design.rooms.length - 1}].config`,
    ])
  })

  it('withMapRoom adds one when there is none, and re-syncs the participants', () => {
    const design = sampleDesign()
    const added = withMapRoom(design, () => NEW_ID)
    const map = added.rooms.find((r) => r.roomType === MAP_ROOM_TYPE)
    expect(map).toMatchObject({
      id: NEW_ID,
      name: 'Map',
      config: {},
      order: design.rooms.length,
      participants: mapParticipants(design.forces),
    })
    expect(checkDesign(added)).toEqual([])
    // Nothing to do: the same design.
    expect(withMapRoom(added, () => 'unused')).toBe(added)
    // A force removed: the participants follow.
    const fewer = { ...added, forces: added.forces.filter((f) => f.id !== FORCE.red) }
    const synced = withMapRoom(fewer, () => 'unused')
    expect(synced.rooms.find((r) => r.id === NEW_ID)?.participants).toEqual(
      mapParticipants(fewer.forces),
    )
  })
})
