import type { DesignFile } from './design.ts'
import type { Asset } from './documents.ts'

/** A 1×1 transparent PNG, for tests and seeds. */
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export function pixelAsset(id: string): Asset {
  return {
    schemaVersion: 1,
    id,
    mimeType: 'image/png',
    size: 68,
    sha256: '0'.repeat(64),
    data: PIXEL_PNG_BASE64,
  }
}

/** A small valid design: Blue, Red and Umpire, three rooms, one observer. */
export function sampleDesign(): DesignFile {
  return {
    format: 'wrx1-design',
    schemaVersion: 1,
    exportedAt: '2026-10-24T12:00:00.000Z',
    game: {
      schemaVersion: 1,
      name: 'Exercise Northern Gate',
      description: 'A two-sided negotiation exercise.',
      briefing: '## Briefing\n\nThe exercise starts at 09:00.',
      designVersion: 1,
      theme: { tokens: { primary: '#1d4ed8', fontFamily: 'sans' }, logoAssetId: 'game-logo' },
      roomTypeDefaults: {},
    },
    forces: [
      { schemaVersion: 1, id: 'blue', name: 'Blue', colour: '#1d4ed8', isUmpire: false, order: 0 },
      { schemaVersion: 1, id: 'red', name: 'Red', colour: '#b91c1c', isUmpire: false, order: 1 },
      {
        schemaVersion: 1,
        id: 'umpire',
        name: 'Umpire',
        colour: '#4b5563',
        isUmpire: true,
        order: 2,
      },
    ],
    roles: [
      {
        schemaVersion: 1,
        id: 'blue-co',
        name: 'Blue CO',
        forceId: 'blue',
        isObserver: false,
        order: 0,
      },
      {
        schemaVersion: 1,
        id: 'blue-observer',
        name: 'Blue Observer',
        forceId: 'blue',
        isObserver: true,
        order: 1,
      },
      {
        schemaVersion: 1,
        id: 'red-co',
        name: 'Red CO',
        forceId: 'red',
        isObserver: false,
        order: 0,
      },
      {
        schemaVersion: 1,
        id: 'umpire-1',
        name: 'Lead Umpire',
        forceId: 'umpire',
        isObserver: false,
        order: 0,
      },
    ],
    rooms: [
      {
        schemaVersion: 1,
        id: 'blue-hq',
        name: 'Blue HQ',
        roomType: 'chat',
        participants: [{ kind: 'force', id: 'blue', access: 'write' }],
        config: {},
        order: 0,
      },
      {
        schemaVersion: 1,
        id: 'red-hq',
        name: 'Red HQ',
        roomType: 'chat',
        participants: [{ kind: 'force', id: 'red', access: 'write' }],
        config: {},
        order: 1,
      },
      {
        schemaVersion: 1,
        id: 'negotiation',
        name: 'Blue–Red negotiation',
        roomType: 'chat',
        participants: [
          { kind: 'role', id: 'blue-co', access: 'write' },
          { kind: 'role', id: 'red-co', access: 'write' },
        ],
        config: {},
        order: 2,
      },
    ],
    objectives: [
      {
        schemaVersion: 1,
        forceId: 'blue',
        markdown: '1. Secure the crossing.',
        updatedAt: '2026-10-24T12:00:00.000Z',
      },
      {
        schemaVersion: 1,
        forceId: 'red',
        markdown: '1. Delay Blue.',
        updatedAt: '2026-10-24T12:00:00.000Z',
      },
    ],
    assets: [pixelAsset('game-logo')],
  }
}
