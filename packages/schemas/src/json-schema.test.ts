// The JSON Schema export (D26, P8) agrees with zod: a JSON Schema 2020-12 validator, the one the
// template validator uses, accepts and refuses the same samples, refinements aside.
import { Validator } from '@cfworker/json-schema'
import { describe, expect, it } from 'vitest'
import { INITIAL_GAME_STATE } from './documents.ts'
import { blueReportsConfig, demoDesign, sampleWorldState, WORLD_ASSET } from './fixtures.ts'
import {
  JSON_SCHEMA_EXPORTS,
  JSON_SCHEMA_ID_BASE,
  renderJsonSchemas,
  toJsonSchema,
} from './json-schema.ts'

function exported(file: string) {
  const entry = JSON_SCHEMA_EXPORTS.find((e) => e.file === file)
  if (entry === undefined) throw new Error(`not exported: ${file}`)
  return {
    entry,
    validator: new Validator(toJsonSchema(entry), '2020-12', false),
  }
}

/** Both validators give the same answer for `value`, and it is `expected`. */
function agree(file: string, value: unknown, expected: boolean): void {
  const { entry, validator } = exported(file)
  expect(entry.schema.safeParse(value).success, `zod: ${JSON.stringify(value).slice(0, 80)}`).toBe(
    expected,
  )
  expect(
    validator.validate(value).valid,
    `JSON Schema: ${JSON.stringify(value).slice(0, 80)}`,
  ).toBe(expected)
}

const asset = sampleWorldState().assets[WORLD_ASSET.redArmour]
const map = demoDesign().rooms.find((r) => r.roomType === 'map')

describe('JSON Schema export (D26, ARC-6, P8)', () => {
  it('covers the world-state, turn and room documents, each with its $id and title', () => {
    expect(JSON_SCHEMA_EXPORTS.map((e) => e.file)).toEqual([
      'chat-room-config.schema.json',
      'game-state.schema.json',
      'map-room-config.schema.json',
      'room.schema.json',
      'world-asset.schema.json',
      'world-state-message.schema.json',
    ])
    for (const entry of JSON_SCHEMA_EXPORTS) {
      const schema = toJsonSchema(entry)
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
      expect(schema.$id).toBe(`${JSON_SCHEMA_ID_BASE}${entry.file}`)
      expect(schema.title).toBe(entry.title)
      expect(schema.type).toBe('object')
    }
  })

  it('renders each file as stable, newline-terminated JSON', () => {
    const files = renderJsonSchemas()
    expect([...files.keys()]).toEqual(JSON_SCHEMA_EXPORTS.map((e) => e.file))
    for (const text of files.values()) {
      expect(text.endsWith('}\n')).toBe(true)
      expect(() => JSON.parse(text) as unknown).not.toThrow()
    }
    expect(renderJsonSchemas()).toEqual(files)
  })

  it('the turn state: agrees on valid and invalid documents', () => {
    agree('game-state.schema.json', INITIAL_GAME_STATE, true)
    agree('game-state.schema.json', { schemaVersion: 1, turn: 3, phase: 'adjudication' }, true)
    agree('game-state.schema.json', { schemaVersion: 1, turn: 0, phase: 'planning' }, false)
    agree('game-state.schema.json', { schemaVersion: 1, turn: 2, phase: 'orders' }, false)
    agree('game-state.schema.json', { schemaVersion: 2, turn: 2, phase: 'planning' }, false)
  })

  it('the world-state message and asset: agree on valid and invalid bodies', () => {
    const body = { type: 'world-state', schemaVersion: 1, content: sampleWorldState() }
    agree('world-state-message.schema.json', body, true)
    agree('world-state-message.schema.json', { ...body, type: 'chat' }, false)
    agree(
      'world-state-message.schema.json',
      { ...body, content: { turn: 1, assets: { 'not-a-guid': asset } } },
      false,
    )
    agree('world-asset.schema.json', asset, true)
    agree('world-asset.schema.json', { ...asset, sidc: 'SFGPUCI' }, false)
    agree('world-asset.schema.json', { ...asset, lat: 91 }, false)
    agree('world-asset.schema.json', { ...asset, health: 120 }, false)
    const { fuel: _fuel, ...noFuel } = asset ?? { fuel: 0 }
    agree('world-asset.schema.json', noFuel, false)
  })

  it('the room document and room configs: agree on valid and invalid documents', () => {
    agree('room.schema.json', map, true)
    agree('room.schema.json', { ...map, roomType: 'Map Room' }, false)
    agree('room.schema.json', { ...map, participants: [{ kind: 'team', id: 'x' }] }, false)
    agree('map-room-config.schema.json', { schemaVersion: 1, zoom: 9 }, true)
    agree('map-room-config.schema.json', { schemaVersion: 1, zoom: 30 }, false)
    agree('chat-room-config.schema.json', blueReportsConfig(), true)
    agree('chat-room-config.schema.json', { schemaVersion: 2, freeText: 'yes' }, false)
  })
})
