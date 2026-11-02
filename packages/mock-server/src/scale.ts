// The scale fixture (WP 3.2, NFR-11): a generated game at the v1 sizes, 50 roles, 30 rooms and
// 10,000 messages in one room, for the performance tests. It is never the app's seed: the demo
// stays the default (PLY-21). Tests load it into the running mock with `importDatabase`, and the
// admin's draft is the same design (`scaleDesign`). Deterministic: the same options give the same
// state, so measurements are comparable between runs. Every password is a DEMO PASSWORD (NFR-6).
import { DESIGN_FILE_VERSION } from '@wrx/schemas'
import type { ChatRoomConfig, DesignFile, Template } from '@wrx/schemas'
import { sampleTemplates } from '../../schemas/src/fixtures.ts'
import { stateFromDesign } from './seed.ts'
import type { SeedMessage } from './seed.ts'
import type { MockState } from './state.ts'

export interface ScaleOptions {
  /** Roles, spread over the player forces and the White Force. Default 50. */
  readonly roles?: number
  /** Rooms. Default 30. */
  readonly rooms?: number
  /** Messages in the busy room, `SCALE_BUSY_ROOM`. Default 10,000. */
  readonly messages?: number
  /** Messages in each other room. Default 5. */
  readonly messagesPerOtherRoom?: number
  /**
   * Annex A (WP 4.4): when true, the design has the demo's three templates (every field type),
   * the busy room offers all three to every player force beside free text, and every message in
   * the busy room is a templated one, valid for its template. Default false.
   */
  readonly templated?: boolean
}

/**
 * A fixed GUID for one of the fixture's entities (§3 rule 1), from its short name, so the
 * fixture is the same every run: `5`, then the name's bytes in hex, padded.
 */
export function scaleId(name: string): string {
  const hex =
    `5${[...new TextEncoder().encode(name)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
      .padEnd(32, '0')
      .slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The room that holds the bulk of the history: every role reads and writes it. */
export const SCALE_BUSY_ROOM = scaleId('plenary')
/** The busy room's display name. */
export const SCALE_BUSY_ROOM_NAME = 'Plenary'
/** The login name of a player role that is in the busy room and several others. */
export const SCALE_PLAYER = 'f1-r01'

const PLAYER_FORCES = 4
const WHITE = scaleId('white')
const COLOURS = ['#1d4ed8', '#b91c1c', '#047857', '#7c3aed'] as const

const two = (n: number) => String(n).padStart(2, '0')

/** A small, fast, seeded generator, so the fixture is the same every run. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS =
  'advance bridge crossing ceasefire convoy east west north south hold report confirm request supplies ridge village patrol orders noon dawn position recce umpire forces delay secure route'.split(
    ' ',
  )

/** Message text of mixed length: most one line, some wrapping over several. */
function text(random: () => number, n: number): string {
  const length = random() < 0.15 ? 40 + Math.floor(random() * 60) : 3 + Math.floor(random() * 14)
  const words: string[] = []
  for (let i = 0; i < length; i++) words.push(WORDS[Math.floor(random() * WORDS.length)] ?? 'ok')
  return `#${n + 1} ${words.join(' ')}.`
}

function chat(body: string): string {
  return JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text: body } })
}

/**
 * The design: four player forces and the White Force; `roles` roles, about a fifth of them White
 * (two of those observers); `rooms` rooms: the busy plenary room (everyone writes), a HQ room per
 * player force, and the rest between pairs of forces or a few named roles.
 */
export function scaleDesign(options: ScaleOptions = {}): DesignFile {
  const roleCount = options.roles ?? 50
  const roomCount = options.rooms ?? 30
  const forces: DesignFile['forces'] = [
    ...Array.from({ length: PLAYER_FORCES }, (_, i) => ({
      schemaVersion: 1 as const,
      id: scaleId(`f${i + 1}`),
      name: `Force ${i + 1}`,
      colour: COLOURS[i] ?? '#1d4ed8',
      isUmpire: false,
      order: i,
    })),
    {
      schemaVersion: 1,
      id: WHITE,
      name: 'White',
      colour: '#4b5563',
      isUmpire: true,
      order: PLAYER_FORCES,
    },
  ]
  const whiteCount = Math.max(2, Math.round(roleCount / 5))
  const playerCount = roleCount - whiteCount
  const roles: DesignFile['roles'] = []
  for (let i = 0; i < playerCount; i++) {
    const force = (i % PLAYER_FORCES) + 1
    const n = Math.floor(i / PLAYER_FORCES) + 1
    roles.push({
      schemaVersion: 1,
      id: scaleId(`f${force}-r${two(n)}`),
      loginName: `f${force}-r${two(n)}`,
      name: `Force ${force} role ${n}`,
      forceId: scaleId(`f${force}`),
      isObserver: false,
      order: n,
    })
  }
  for (let i = 0; i < whiteCount; i++) {
    roles.push({
      schemaVersion: 1,
      id: scaleId(`white-${two(i + 1)}`),
      loginName: `white-${two(i + 1)}`,
      name: `White ${i + 1}`,
      forceId: WHITE,
      // Two observers; the rest are White Cell, writing everywhere (§3 rule 4).
      isObserver: i < 2,
      order: i,
    })
  }

  const rooms: DesignFile['rooms'] = [
    {
      schemaVersion: 1,
      id: SCALE_BUSY_ROOM,
      name: SCALE_BUSY_ROOM_NAME,
      roomType: 'chat',
      participants: forces
        .filter((f) => !f.isUmpire)
        .map((f) => ({ kind: 'force' as const, id: f.id, access: 'write' as const })),
      config: {},
      order: 0,
    },
  ]
  for (let f = 1; f <= PLAYER_FORCES && rooms.length < roomCount; f++) {
    rooms.push({
      schemaVersion: 1,
      id: scaleId(`f${f}-hq`),
      name: `Force ${f} HQ`,
      roomType: 'chat',
      participants: [{ kind: 'force', id: scaleId(`f${f}`), access: 'write' }],
      config: {},
      order: rooms.length,
    })
  }
  const players = roles.filter((r) => r.forceId !== WHITE)
  for (let n = 1; rooms.length < roomCount; n++) {
    const a = ((n - 1) % PLAYER_FORCES) + 1
    const b = (a % PLAYER_FORCES) + 1
    // Alternate: a force-to-force room, then a cell of three named roles with one reading.
    const participants: DesignFile['rooms'][number]['participants'] =
      n % 2 === 1
        ? [
            { kind: 'force', id: scaleId(`f${a}`), access: 'write' },
            { kind: 'force', id: scaleId(`f${b}`), access: 'read' },
          ]
        : [0, 1, 2].map((k) => ({
            kind: 'role' as const,
            id: players[(n * 3 + k) % players.length]?.id ?? scaleId(SCALE_PLAYER),
            access: k === 2 ? ('read' as const) : ('write' as const),
          }))
    rooms.push({
      schemaVersion: 1,
      id: scaleId(`room-${two(n)}`),
      name: `Room ${n}`,
      roomType: 'chat',
      participants,
      config: {},
      order: rooms.length,
    })
  }

  const templates = options.templated === true ? scaleTemplates() : []
  if (templates.length > 0) {
    const busy = rooms[0]
    const config: ChatRoomConfig = {
      schemaVersion: 2,
      freeText: true,
      templates: forces
        .filter((f) => !f.isUmpire)
        .map((f) => ({
          kind: 'force' as const,
          id: f.id,
          templateIds: templates.map((t) => t.id),
        })),
    }
    if (busy !== undefined) rooms[0] = { ...busy, config }
  }

  return {
    format: 'wrx1-design',
    schemaVersion: DESIGN_FILE_VERSION,
    exportedAt: '2026-10-24T12:00:00.000Z',
    game: {
      schemaVersion: 1,
      name: 'Scale exercise',
      description: 'The NFR-11 scale fixture: 50 roles, 30 rooms, 10,000 messages in one room.',
      briefing: '## Briefing\n\nA generated game for measuring the client at scale.',
      designVersion: 1,
      theme: { tokens: { primary: '#1d4ed8', fontFamily: 'sans' } },
      roomTypeDefaults: {},
    },
    forces,
    roles,
    rooms,
    objectives: forces
      .filter((f) => !f.isUmpire)
      .map((f) => ({
        schemaVersion: 1 as const,
        forceId: f.id,
        markdown: `1. ${f.name}: hold the line.`,
        updatedAt: '2026-10-24T12:00:00.000Z',
      })),
    assets: [],
    retired: [],
    templates,
  }
}

/**
 * The demo's three templates (`sampleTemplates`): a situation report (force picker, text,
 * slider, date, drop-down), a contact report (date and time, patterned text, integer, yes/no)
 * and a support request (linked drop-downs, a role picker), its role picker filtered to Force 1.
 */
export function scaleTemplates(): Template[] {
  return sampleTemplates().map((t, i) => {
    const properties = t.schema.properties as Record<string, Record<string, unknown>>
    const fixed = Object.fromEntries(
      Object.entries(properties).map(([name, field]) => [
        name,
        field['x-wrx-force'] === undefined ? field : { ...field, 'x-wrx-force': scaleId('f1') },
      ]),
    )
    return {
      ...t,
      id: scaleId(`template-${String(i + 1)}`),
      schema: { ...t.schema, properties: fixed },
    }
  })
}

/**
 * A templated message body for message `n` of the busy room, valid for its template: template
 * `kind` (mod 3), so the caller can make the newest a situation report, whose summary holds the
 * message number as chat messages' text does.
 */
function templatedBody(
  templates: readonly Template[],
  design: DesignFile,
  random: () => number,
  n: number,
  kind: number,
): string {
  const template = templates[kind % templates.length]
  if (template === undefined) return chat(`#${n + 1}`)
  const forces = design.forces.filter((f) => !f.isUmpire)
  const forceOne = design.roles.filter((r) => r.forceId === scaleId('f1'))
  const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(random() * list.length)]
  const day = String(1 + Math.floor(random() * 28)).padStart(2, '0')
  const hour = String(Math.floor(random() * 24)).padStart(2, '0')
  let values: Record<string, string | number | boolean>
  switch (kind % templates.length) {
    case 0:
      values = {
        force: pick(forces)?.id ?? '',
        summary: text(random, n).slice(0, 500),
        readiness: 5 * Math.floor(random() * 21),
        asOf: `2026-10-${day}`,
        ...(random() < 0.7 ? { threat: pick(['low', 'medium', 'high'] as const) ?? 'low' } : {}),
      }
      break
    case 1:
      values = {
        seenAt: `2026-10-${day}T${hour}:30:00.000Z`,
        grid: `NV${String(1000 + Math.floor(random() * 9000))}`,
        strength: 1 + Math.floor(random() * 999),
        hostile: random() < 0.5,
      }
      break
    default: {
      const air = random() < 0.5
      values = {
        kind: air ? 'air' : 'logistics',
        detail: air
          ? random() < 0.5
            ? 'strike'
            : 'recce'
          : random() < 0.5
            ? 'fuel'
            : 'ammunition',
        to: pick(forceOne)?.id ?? '',
        urgent: random() < 0.3,
      }
    }
  }
  return JSON.stringify({
    type: 'template',
    schemaVersion: 1,
    content: { templateId: template.id, values },
  })
}

/** The history: `messages` in the busy room from its writers, a few in each other room. */
export function scaleHistory(design: DesignFile, options: ScaleOptions = {}): SeedMessage[] {
  const total = options.messages ?? 10_000
  const perRoom = options.messagesPerOtherRoom ?? 5
  const random = generator(11)
  const players = design.roles.filter((r) => r.forceId !== WHITE).map((r) => r.loginName)
  const writers = [...players, 'admin']
  // Ten seconds apart, ending at 09:00 on the demo's day, so the busy room spans a few days.
  const end = Date.parse('2026-10-24T09:00:00.000Z')
  const history: SeedMessage[] = []
  for (let i = 0; i < total; i++) {
    // Runs of messages from one author, as in a real conversation, so rows group (PLY-45).
    const author = writers[Math.floor(i / 3 + random() * 1.5) % writers.length] ?? 'admin'
    history.push({
      room: SCALE_BUSY_ROOM,
      author,
      body:
        design.templates.length > 0
          ? templatedBody(design.templates, design, random, i, total - 1 - i)
          : chat(text(random, i)),
      at: new Date(end - (total - i) * 10_000).toISOString(),
    })
  }
  for (const room of design.rooms) {
    if (room.id === SCALE_BUSY_ROOM) continue
    for (let i = 0; i < perRoom; i++) {
      history.push({
        room: room.id,
        author: 'admin',
        body: chat(text(random, i)),
        at: new Date(end - (perRoom - i) * 60_000).toISOString(),
      })
    }
  }
  return history
}

/** The scale fixture as mock state, for `importDatabase` or `new MockServer({ seed })`. */
export function scaleState(options: ScaleOptions = {}): MockState {
  const design = scaleDesign(options)
  const state = stateFromDesign({ design, history: scaleHistory(design, options) })
  if (!state.ok) throw new Error(`the scale fixture is invalid: ${state.error}`)
  return state.value
}
