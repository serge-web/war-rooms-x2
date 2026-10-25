// Seeds (PLY-21, PLY-34): a design file (ADM-16) turned into mock server state, provisioned as
// the admin tooling provisions a real server (§3, NFR-3, S13.md):
// - one account per role, plus the admin;
// - one members-only, moderated, non-anonymous, persistent, unlisted, archived room per room,
//   with every role that has access as a member, and read-only roles (observers, `read`
//   entries) stored as visitors, the state the vault route leaves behind (ADM-37);
// - the §3 nodes: `game-setup` and the game theme's assets open, everything else whitelist with
//   the admin as owner and publisher; objectives readable by their force and the White Force's
//   observers, and published by the White Force's other roles, with the design's text as the
//   admin's own item (§3 rule 14);
// - optional message history, archived for MAM;
// - optional private storage of the admin account (the demo seed's observer vault).
// White Force roles reach rooms through effective access (D8, §3 rule 4).
import { effectiveAccess } from '@wrx/domain'
import {
  SINGLETON_NODES,
  checkDesign,
  designFileSchema,
  isoDateTimeSchema,
  nodeName,
  publicAssetIds,
} from '@wrx/schemas'
import type { DesignFile, Result } from '@wrx/schemas'
import type { RoomConfig } from '@wrx/transport'
import { z } from 'zod'
import type { ServerNodeConfig } from './protocol.ts'
import { messageStanza, messageWithinCap, payloadWithinCap } from './size.ts'
import { MOCK_STATE_FORMAT } from './state.ts'
import type { ArchivedMessage, MockState, NodeState, RoomState } from './state.ts'

/** One message of seed history (PLY-34). */
export interface SeedMessage {
  /** The room's id in the design. */
  readonly room: string
  /** A role id with write access to the room, or `admin`. The nick is the same id. */
  readonly author: string
  /** The body as clients send it: JSON `{type, schemaVersion, content}` (§3). */
  readonly body: string
  /** When the server received it, ISO 8601; it becomes the stanza-id and the MAM stamp. */
  readonly at: string
}

export interface DesignSeed {
  /** A design export (`designFileSchema`); validated here. */
  readonly design: unknown
  /** The XMPP domain. Default `wrx.mock`. */
  readonly domain?: string
  /**
   * DEMO PASSWORDS (NFR-6): known, not secret, and marked `demo` in the state so the UI can say
   * so. Unlisted roles get `demo-<roleId>`; the admin gets `demo-admin`.
   */
  readonly demoPasswords?: {
    readonly admin?: string
    readonly roles?: Readonly<Record<string, string>>
  }
  readonly history?: readonly SeedMessage[]
  /**
   * XEP-0049 private storage of the admin account, by key: e.g. the demo observer vault's
   * ciphertext (ADM-37), as the admin tooling stores it.
   */
  readonly adminPrivate?: Readonly<Record<string, string>>
}

export const DEFAULT_SEED_DOMAIN = 'wrx.mock'

/** The demo password of a role or of the admin, unless the seed names another (NFR-6). */
export function demoPassword(id: string): string {
  return `demo-${id}`
}

/** NFR-3 room settings; the name comes from the design. */
function gameRoom(name: string): RoomConfig {
  return {
    name,
    membersOnly: true,
    moderated: true,
    persistent: true,
    public: false,
    whois: 'anyone',
    archive: true,
  }
}

/** The options the admin tooling sets on every node it creates (through the real transport). */
function gameNode(
  accessModel: 'open' | 'whitelist',
  maxItems: number,
  title?: string,
): ServerNodeConfig {
  return {
    accessModel,
    publishModel: 'publishers',
    maxItems,
    notifyRetract: true,
    notifyDelete: true,
    itemReply: 'publisher',
    ...(title === undefined ? {} : { title }),
  }
}

/** Items kept on the announcements node; the admin tooling has not fixed one (WP 2.1). */
const ANNOUNCEMENTS_MAX_ITEMS = 100

/** One `current` item for single-document nodes (WP 1.6). */
const CURRENT = 'current'

const seedMessageSchema = z.object({
  room: z.string(),
  author: z.string(),
  body: z.string(),
  at: isoDateTimeSchema,
})

/** Builds the state a server should start from; refuses a design with errors. */
export function stateFromDesign(seed: DesignSeed): Result<MockState, string> {
  const parsed = designFileSchema.safeParse(seed.design)
  if (!parsed.success)
    return { ok: false, error: `invalid design: ${z.prettifyError(parsed.error)}` }
  const design: DesignFile = parsed.data
  const errors = checkDesign(design).filter((i) => i.severity === 'error')
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => `${e.path}: ${e.message}`).join('; ') }
  }
  const domain = seed.domain ?? DEFAULT_SEED_DOMAIN
  const admin = `admin@${domain}`
  const muc = `conference.${domain}`
  const jidOf = (roleId: string) => `${roleId}@${domain}`
  const everyRole = design.roles.map((r) => jidOf(r.id))

  const accounts: MockState['accounts'] = [
    {
      jid: admin,
      password: seed.demoPasswords?.admin ?? demoPassword('admin'),
      admin: true,
      demo: true,
    },
    ...design.roles.map((role) => ({
      jid: jidOf(role.id),
      password: seed.demoPasswords?.roles?.[role.id] ?? demoPassword(role.id),
      admin: false,
      demo: true,
    })),
  ]

  const matrix = effectiveAccess(design)
  const rooms: RoomState[] = design.rooms.map((room) => {
    const row = matrix.cells.get(room.id)
    const members = design.roles.filter((r) => (row?.get(r.id)?.access ?? 'none') !== 'none')
    const readOnly = members.filter((r) => row?.get(r.id)?.access === 'read')
    return {
      jid: `${room.id}@${muc}`,
      config: gameRoom(room.name),
      affiliations: [
        { jid: admin, affiliation: 'owner' },
        ...members.map((r) => ({ jid: jidOf(r.id), affiliation: 'member' as const })),
      ],
      storedRoles: readOnly.map((r) => ({ jid: jidOf(r.id), role: 'visitor' as const })),
      archive: [],
    }
  })

  const nodes: NodeState[] = []
  const issues: string[] = []
  const addNode = (
    name: string,
    config: ServerNodeConfig,
    readers: readonly string[],
    publishers: readonly string[],
    items: readonly { readonly id: string; readonly doc: unknown }[],
  ) => {
    const stored = items.map(({ id, doc }) => {
      const payload = JSON.stringify(doc)
      if (!payloadWithinCap(payload)) issues.push(`${name}: item ${id} is over the item cap`)
      return { id, payload, publisher: admin }
    })
    nodes.push({
      name,
      config,
      affiliations: [
        { jid: admin, affiliation: 'owner' },
        ...publishers.map((jid) => ({ jid, affiliation: 'publisher' as const })),
        ...readers
          .filter((jid) => !publishers.includes(jid))
          .map((jid) => ({ jid, affiliation: 'member' as const })),
      ],
      subscriptions: [],
      items: stored.slice(-config.maxItems),
    })
  }

  // The White Force (umpire flag): its roles read every force's objectives, and those that are
  // not observers publish them (§3 rule 14). Observers never publish (review F5).
  const whiteForces = new Set(design.forces.filter((f) => f.isUmpire).map((f) => f.id))
  const white = design.roles.filter((r) => whiteForces.has(r.forceId))
  const editors = white.filter((r) => !r.isObserver).map((r) => jidOf(r.id))
  const whiteObservers = white.filter((r) => r.isObserver).map((r) => jidOf(r.id))
  const publicAssets = new Set(publicAssetIds(design.game))

  addNode(
    SINGLETON_NODES.gameSetup,
    gameNode('open', 1),
    [],
    [],
    [{ id: CURRENT, doc: design.game }],
  )
  addNode(
    SINGLETON_NODES.announcements,
    gameNode('whitelist', ANNOUNCEMENTS_MAX_ITEMS),
    everyRole,
    [],
    [],
  )
  addNode(SINGLETON_NODES.gameState, gameNode('whitelist', 1), everyRole, [], [])
  for (const force of design.forces) {
    addNode(
      nodeName.force(force.id),
      gameNode('whitelist', 1),
      everyRole,
      [],
      [{ id: CURRENT, doc: force }],
    )
  }
  for (const role of design.roles) {
    addNode(
      nodeName.role(role.id),
      gameNode('whitelist', 1),
      everyRole,
      [],
      [{ id: CURRENT, doc: role }],
    )
  }
  for (const room of design.rooms) {
    // §3: room participants SHOULD read their room's document and all users MAY; the store
    // reads every room document, so every role does.
    addNode(
      nodeName.room(room.id),
      gameNode('whitelist', 1),
      everyRole,
      [],
      [{ id: CURRENT, doc: room }],
    )
  }
  for (const force of design.forces) {
    // §3 rule 14: one item per author, so room for the admin and every White Force editor.
    const readers = [
      ...design.roles.filter((r) => r.forceId === force.id).map((r) => jidOf(r.id)),
      ...whiteObservers,
    ]
    const objectives = design.objectives.find((o) => o.forceId === force.id)
    addNode(
      nodeName.objectives(force.id),
      gameNode('whitelist', Math.max(10, editors.length + 1)),
      [...new Set(readers)],
      editors,
      objectives === undefined ? [] : [{ id: 'admin', doc: objectives }],
    )
  }
  for (const asset of design.assets) {
    const open = publicAssets.has(asset.id)
    addNode(
      nodeName.asset(asset.id),
      gameNode(open ? 'open' : 'whitelist', 1),
      open ? [] : everyRole,
      [],
      [{ id: CURRENT, doc: asset }],
    )
  }

  const history = seedHistory(seed.history ?? [], design, matrix, domain, issues)
  for (const room of rooms) {
    const id = room.jid.slice(0, room.jid.indexOf('@'))
    room.archive = history.filter((h) => h.room === id).map((h) => h.message)
  }
  if (issues.length > 0) return { ok: false, error: issues.join('; ') }

  return {
    ok: true,
    value: {
      format: MOCK_STATE_FORMAT,
      version: 1,
      domain,
      accounts,
      rooms,
      nodes,
      privateStorage: Object.entries(seed.adminPrivate ?? {}).map(([key, value]) => ({
        jid: admin,
        key,
        value,
      })),
      lastStanzaId: history.at(-1)?.message.stanzaId ?? '0',
    },
  }
}

function seedHistory(
  messages: readonly SeedMessage[],
  design: DesignFile,
  matrix: ReturnType<typeof effectiveAccess>,
  domain: string,
  issues: string[],
): { readonly room: string; readonly message: ArchivedMessage }[] {
  const valid: { index: number; at: number; message: SeedMessage }[] = []
  messages.forEach((message, index) => {
    const parsed = seedMessageSchema.safeParse(message)
    if (!parsed.success) {
      issues.push(`history[${index}]: ${z.prettifyError(parsed.error)}`)
      return
    }
    if (!design.rooms.some((r) => r.id === message.room)) {
      issues.push(`history[${index}]: unknown room "${message.room}"`)
      return
    }
    const access = matrix.cells.get(message.room)?.get(message.author)?.access
    if (message.author !== 'admin' && access !== 'write') {
      issues.push(`history[${index}]: "${message.author}" cannot post in "${message.room}"`)
      return
    }
    if (
      !messageWithinCap(messageStanza('seed', `${message.room}@conference.${domain}`, message.body))
    ) {
      issues.push(`history[${index}]: the message is over the stanza cap`)
      return
    }
    valid.push({ index, at: Date.parse(message.at), message })
  })
  valid.sort((a, b) => a.at - b.at || a.index - b.index)
  let last = 0n
  return valid.map(({ at, message }) => {
    const micros = BigInt(at) * 1000n
    last = micros > last ? micros : last + 1n
    return {
      room: message.room,
      message: {
        stanzaId: last.toString(),
        nick: message.author,
        from: `${message.author}@${domain}`,
        body: message.body,
      },
    }
  })
}
