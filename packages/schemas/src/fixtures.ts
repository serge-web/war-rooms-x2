import { isId } from './common.ts'
import { DESIGN_FILE_VERSION } from './design.ts'
import type { DesignFile } from './design.ts'
import type { Asset } from './documents.ts'
import type { DesignFileV1 } from './legacy.ts'

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

/** A fixed GUID: `kind` names the collection (1 forces, 2 roles, 3 rooms, 4 assets), `n` the item. */
function fixed(kind: number, n: number): string {
  return `${kind}0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

/**
 * The sample design's ids: fixed GUIDs (§3 rule 1), so tests, the demo seed and screenshots
 * repeat. Login names keep the ids the design had before GUIDs (`blue-co`), so typed logins in
 * tests and demos are unchanged.
 */
export const FORCE = Object.freeze({ blue: fixed(1, 1), red: fixed(1, 2), white: fixed(1, 3) })
export const ROLE = Object.freeze({
  blueCo: fixed(2, 1),
  blueObserver: fixed(2, 2),
  redCo: fixed(2, 3),
  whiteObserver: fixed(2, 4),
  whiteCell: fixed(2, 5),
})
export const ROOM = Object.freeze({
  blueHq: fixed(3, 1),
  redHq: fixed(3, 2),
  negotiation: fixed(3, 3),
})
export const ASSET = Object.freeze({ gameLogo: fixed(4, 1) })

/** Login names of the sample design's roles. */
export const LOGIN = Object.freeze({
  blueCo: 'blue-co',
  blueObserver: 'blue-observer',
  redCo: 'red-co',
  whiteObserver: 'white-observer',
  whiteCell: 'white-cell',
})

// Short test names for GUIDs, shared by every package's tests.
const KNOWN: Readonly<Record<string, string>> = Object.freeze({
  blue: FORCE.blue,
  red: FORCE.red,
  white: FORCE.white,
  'blue-co': ROLE.blueCo,
  'blue-observer': ROLE.blueObserver,
  'red-co': ROLE.redCo,
  'white-observer': ROLE.whiteObserver,
  'white-cell': ROLE.whiteCell,
  'blue-hq': ROOM.blueHq,
  'red-hq': ROOM.redHq,
  negotiation: ROOM.negotiation,
  'game-logo': ASSET.gameLogo,
})
const NAMES = new Map(Object.entries(KNOWN).map(([name, id]) => [id, name]))

/**
 * The fixed GUID of a test entity named `name`: the sample design's for its names, otherwise
 * one made from the name (hex of its bytes, or a hash past 16 bytes), so it is the same in
 * every test. A GUID is returned as it is.
 */
export function tid(name: string): string {
  if (isId(name)) return name
  const known = KNOWN[name]
  if (known !== undefined) return known
  const bytes = [...new TextEncoder().encode(name)]
  let hex: string
  if (bytes.length <= 15) {
    hex = `f${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`.padEnd(32, '0')
  } else {
    let h = 0x811c9dc5
    const words: string[] = []
    for (let round = 0; round < 4; round++) {
      for (const b of bytes) h = Math.imul(h ^ b ^ round, 0x01000193) >>> 0
      words.push(h.toString(16).padStart(8, '0'))
    }
    hex = `e${words.join('').slice(1)}`
  }
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  NAMES.set(id, name)
  return id
}

/** The short name a test GUID was made from, if `tid` made it or knows it. */
export function nameOf(id: string): string | undefined {
  return NAMES.get(id)
}

/**
 * A small valid design: Blue, Red and White (the umpire flag: the admin is its umpire), three
 * rooms, a Blue observer and a White observer with no assigned rooms, so it reads every room.
 */
export function sampleDesign(): DesignFile {
  return {
    format: 'wrx1-design',
    schemaVersion: DESIGN_FILE_VERSION,
    exportedAt: '2026-10-24T12:00:00.000Z',
    game: {
      schemaVersion: 1,
      name: 'Exercise Northern Gate',
      description: 'A two-sided negotiation exercise.',
      briefing: '## Briefing\n\nThe exercise starts at 09:00.',
      designVersion: 1,
      theme: { tokens: { primary: '#1d4ed8', fontFamily: 'sans' }, logoAssetId: ASSET.gameLogo },
      roomTypeDefaults: {},
    },
    forces: [
      {
        schemaVersion: 1,
        id: FORCE.blue,
        name: 'Blue',
        colour: '#1d4ed8',
        isUmpire: false,
        order: 0,
      },
      {
        schemaVersion: 1,
        id: FORCE.red,
        name: 'Red',
        colour: '#b91c1c',
        isUmpire: false,
        order: 1,
      },
      {
        schemaVersion: 1,
        id: FORCE.white,
        name: 'White',
        colour: '#4b5563',
        isUmpire: true,
        order: 2,
      },
    ],
    roles: [
      {
        schemaVersion: 1,
        id: ROLE.blueCo,
        loginName: LOGIN.blueCo,
        name: 'Blue CO',
        forceId: FORCE.blue,
        isObserver: false,
        order: 0,
      },
      {
        schemaVersion: 1,
        id: ROLE.blueObserver,
        loginName: LOGIN.blueObserver,
        name: 'Blue Observer',
        forceId: FORCE.blue,
        isObserver: true,
        order: 1,
      },
      {
        schemaVersion: 1,
        id: ROLE.redCo,
        loginName: LOGIN.redCo,
        name: 'Red CO',
        forceId: FORCE.red,
        isObserver: false,
        order: 0,
      },
      {
        schemaVersion: 1,
        id: ROLE.whiteObserver,
        loginName: LOGIN.whiteObserver,
        name: 'White Observer',
        forceId: FORCE.white,
        isObserver: true,
        order: 0,
      },
    ],
    rooms: [
      {
        schemaVersion: 1,
        id: ROOM.blueHq,
        name: 'Blue HQ',
        roomType: 'chat',
        participants: [{ kind: 'force', id: FORCE.blue, access: 'write' }],
        config: {},
        order: 0,
      },
      {
        schemaVersion: 1,
        id: ROOM.redHq,
        name: 'Red HQ',
        roomType: 'chat',
        participants: [{ kind: 'force', id: FORCE.red, access: 'write' }],
        config: {},
        order: 1,
      },
      {
        schemaVersion: 1,
        id: ROOM.negotiation,
        name: 'Blue–Red negotiation',
        roomType: 'chat',
        participants: [
          { kind: 'role', id: ROLE.blueCo, access: 'write' },
          { kind: 'role', id: ROLE.redCo, access: 'write' },
        ],
        config: {},
        order: 2,
      },
    ],
    objectives: [
      {
        schemaVersion: 1,
        forceId: FORCE.blue,
        markdown: '1. Secure the crossing.',
        updatedAt: '2026-10-24T12:00:00.000Z',
      },
      {
        schemaVersion: 1,
        forceId: FORCE.red,
        markdown: '1. Delay Blue.',
        updatedAt: '2026-10-24T12:00:00.000Z',
      },
    ],
    assets: [pixelAsset(ASSET.gameLogo)],
    retired: [],
  }
}

/**
 * The sample design plus a White Force role that is not an observer ("White Cell"), which
 * writes in every room and reads every force's objectives, but does not edit them (§3 rules 4
 * and 14, D21).
 */
export function sampleDesignWithWhiteCell(): DesignFile {
  const design = sampleDesign()
  return {
    ...design,
    roles: [
      ...design.roles,
      {
        schemaVersion: 1,
        id: ROLE.whiteCell,
        loginName: LOGIN.whiteCell,
        name: 'White Cell',
        forceId: FORCE.white,
        isObserver: false,
        order: 1,
      },
    ],
  }
}

/**
 * The sample design as a version 1 file, from before GUID ids: slug ids, each role's id its
 * login name, no `retired` records. For the import conversion's tests (ADM-16).
 */
export function sampleDesignV1(): DesignFileV1 {
  const logins: Readonly<Record<string, string>> = LOGIN
  const slug: Readonly<Record<string, string>> = Object.fromEntries([
    ...Object.entries(FORCE).map(([k, v]): [string, string] => [v, k]),
    ...Object.entries(ROLE).map(([k, v]): [string, string] => [v, logins[k] ?? k]),
    [ROOM.blueHq, 'blue-hq'],
    [ROOM.redHq, 'red-hq'],
    [ROOM.negotiation, 'negotiation'],
    [ASSET.gameLogo, 'game-logo'],
  ])
  const old = (id: string) => slug[id] ?? id
  const design = sampleDesign()
  return {
    format: 'wrx1-design',
    schemaVersion: 1,
    exportedAt: design.exportedAt,
    game: { ...design.game, theme: { ...design.game.theme, logoAssetId: 'game-logo' } },
    forces: design.forces.map((f) => ({ ...f, id: old(f.id) })),
    roles: design.roles.map(({ loginName: _login, ...r }) => ({
      ...r,
      id: old(r.id),
      forceId: old(r.forceId),
    })),
    rooms: design.rooms.map((r) => ({
      ...r,
      id: old(r.id),
      participants: r.participants.map((p) => ({ ...p, id: old(p.id) })),
    })),
    objectives: design.objectives.map((o) => ({ ...o, forceId: old(o.forceId) })),
    assets: design.assets.map((a) => ({ ...a, id: old(a.id) })),
  }
}
