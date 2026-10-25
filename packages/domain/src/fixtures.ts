// Test fixtures: a small game served by the 1.1 FakeSession (NFR-15).
import { nodeName } from '@wrx/schemas'
import type { Force, GameSetup, Objectives, Role, Room } from '@wrx/schemas'
import { FakeSession, err, ok } from '@wrx/transport'
import type { FakeOptions, Item, MamQuery, OccupantEvent, RoomMessage } from '@wrx/transport'
import type { Logger } from './logger.ts'
import { createSessionStore } from './store.ts'
import type { SessionStore, SessionStoreOptions } from './store.ts'

export const DOMAIN = 'wrx.test'
export const MUC = 'conference.wrx.test'

export function game(designVersion = 1): GameSetup {
  return {
    schemaVersion: 1,
    name: 'Exercise Northern Gate',
    description: 'A two-sided exercise.',
    briefing: '## Briefing',
    designVersion,
    theme: { tokens: {} },
    roomTypeDefaults: {},
  }
}

export function force(id: string, extra: Partial<Force> = {}): Force {
  return {
    schemaVersion: 1,
    id,
    name: id.toUpperCase(),
    colour: '#1d4ed8',
    isUmpire: false,
    order: 0,
    ...extra,
  }
}

export function role(id: string, forceId: string, extra: Partial<Role> = {}): Role {
  return { schemaVersion: 1, id, name: id, forceId, isObserver: false, order: 0, ...extra }
}

export function room(id: string, participants: Room['participants'], extra: Partial<Room> = {}) {
  const doc: Room = {
    schemaVersion: 1,
    id,
    name: id,
    roomType: 'chat',
    participants,
    config: {},
    order: 0,
    ...extra,
  }
  return doc
}

export function objectives(
  forceId: string,
  markdown: string,
  updatedAt = '2026-10-24T09:00:00.000Z',
): Objectives {
  return { schemaVersion: 1, forceId, markdown, updatedAt }
}

export function chatBody(text: string): string {
  return JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text } })
}

/** Blue (CO and observer), Red (CO), White (a non-observer and an observer); three rooms. */
export function sampleDocuments(): Map<string, unknown[]> {
  const docs = new Map<string, unknown[]>()
  docs.set('game-setup', [game()])
  docs.set('announcements', [])
  const forces = [
    force('blue', { order: 0 }),
    force('red', { order: 1, colour: '#b91c1c' }),
    force('white', { order: 2, isUmpire: true, colour: '#4b5563' }),
  ]
  const roles = [
    role('blue-co', 'blue'),
    role('blue-observer', 'blue', { isObserver: true, order: 1 }),
    role('red-co', 'red'),
    role('white-1', 'white'),
    role('white-observer', 'white', { isObserver: true, order: 1 }),
  ]
  const rooms = [
    room('blue-hq', [{ kind: 'force', id: 'blue', access: 'write' }]),
    room('red-hq', [{ kind: 'force', id: 'red', access: 'write' }], { order: 1 }),
    room(
      'negotiation',
      [
        { kind: 'role', id: 'blue-co', access: 'write' },
        { kind: 'role', id: 'red-co', access: 'write' },
      ],
      { order: 2 },
    ),
  ]
  for (const f of forces) docs.set(nodeName.force(f.id), [f])
  for (const r of roles) docs.set(nodeName.role(r.id), [r])
  for (const r of rooms) docs.set(nodeName.room(r.id), [r])
  docs.set(nodeName.objectives('blue'), [objectives('blue', 'Secure the crossing.')])
  docs.set(nodeName.objectives('red'), [objectives('red', 'Delay Blue.')])
  return docs
}

export interface Harness {
  readonly session: FakeSession
  readonly store: SessionStore
  /** Node → payloads served by `getItems`. Strings are served as-is, values as JSON. */
  readonly docs: Map<string, unknown[]>
  /** Room JID → archive, oldest first, served by MAM with RSM paging. */
  readonly archive: Map<string, RoomMessage[]>
  /** Nodes whose reads fail with this condition. */
  readonly refused: Map<string, 'forbidden' | 'item-not-found' | 'timeout'>
  readonly warnings: string[]
  readonly logger: Logger
  /** Publishes an item and notifies, as the server would. */
  publish(node: string, doc: unknown, itemId?: string): void
}

export interface HarnessOptions extends Partial<Omit<SessionStoreOptions, 'session'>> {
  readonly roleId?: string
  readonly fake?: FakeOptions
  readonly docs?: Map<string, unknown[]>
}

export function harness(options: HarnessOptions = {}): Harness {
  const roleId = options.roleId ?? 'blue-co'
  const session = new FakeSession({
    jid: `${roleId}@${DOMAIN}/pane-1`,
    services: { muc: MUC, pubsub: `pubsub.${DOMAIN}` },
    ...options.fake,
  })
  const docs = options.docs ?? sampleDocuments()
  const archive = new Map<string, RoomMessage[]>()
  const refused = new Map<string, 'forbidden' | 'item-not-found' | 'timeout'>()
  const warnings: string[] = []
  const logger: Logger = {
    debug: () => undefined,
    warn: (message) => warnings.push(message),
  }
  const items = (node: string): Item[] =>
    (docs.get(node) ?? []).map((doc, i) => ({
      id: i === 0 ? 'current' : `item-${i}`,
      payload: typeof doc === 'string' ? doc : JSON.stringify(doc),
      publisher: undefined,
    }))

  session.stub('pubsub', 'listNodes', () => Promise.resolve(ok([...docs.keys()])))
  session.stub('pubsub', 'getItems', (node) => {
    const name = String(node)
    const refusal = refused.get(name)
    if (refusal !== undefined) return Promise.resolve(err(refusal))
    if (!docs.has(name)) return Promise.resolve(err('item-not-found'))
    return Promise.resolve(ok(items(name)))
  })
  session.stub('mam', 'queryRoom', (roomArg, queryArg) => {
    const messages = archive.get(String(roomArg)) ?? []
    const query = queryArg as MamQuery
    const end =
      query.before === undefined
        ? messages.length
        : messages.findIndex((m) => m.stanzaId === query.before)
    const stop = end < 0 ? messages.length : end
    const start = Math.max(0, stop - query.max)
    const page = messages.slice(start, stop)
    return Promise.resolve(
      ok({
        messages: page,
        first: page[0]?.stanzaId,
        last: page[page.length - 1]?.stanzaId,
        complete: start === 0,
      }),
    )
  })

  const store = createSessionStore({ session, logger, ...options })
  return {
    session,
    store,
    docs,
    archive,
    refused,
    warnings,
    logger,
    publish(node, doc, itemId = 'current') {
      docs.set(node, [doc])
      session.emitItems({
        node,
        items: [
          {
            id: itemId,
            payload: typeof doc === 'string' ? doc : JSON.stringify(doc),
            publisher: undefined,
          },
        ],
        retracted: [],
        deleted: false,
      })
    },
  }
}

let counter = 0

/** A groupchat message; ids and times increase with each call unless given. */
export function message(roomId: string, extra: Partial<RoomMessage> = {}): RoomMessage {
  counter++
  const seconds = String(counter % 60).padStart(2, '0')
  const minutes = String(Math.floor(counter / 60) % 60).padStart(2, '0')
  return {
    room: `${roomId}@${MUC}`,
    stanzaId: `s-${String(counter).padStart(6, '0')}`,
    nick: 'red-co',
    from: `red-co@${DOMAIN}`,
    timestamp: `2026-10-24T10:${minutes}:${seconds}.000Z`,
    body: chatBody(`message ${counter}`),
    ...extra,
  }
}

export function selfPresence(
  roomId: string,
  nick: string,
  extra: Partial<OccupantEvent> = {},
): OccupantEvent {
  return {
    room: `${roomId}@${MUC}`,
    nick,
    jid: `${nick}@${DOMAIN}/pane-1`,
    role: 'participant',
    affiliation: 'member',
    available: true,
    self: true,
    statusCodes: [110],
    ...extra,
  }
}

/** Lets pending promises and microtasks run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
