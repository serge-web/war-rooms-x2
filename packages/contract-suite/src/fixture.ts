// The test game the suite provisions for each run, after spike SPIKE-BRIEF §4: two forces and an
// umpire force, one observer, three rooms and the game's PubSub nodes. Every name carries a
// per-run tag, so runs never meet each other's state and a failed run leaves nothing that a later
// run reads. Provisioning itself goes through the admin API under test (spike S4).
import type { NodeConfig, RoomConfig, Session } from '@wrx/transport'
import { json, must } from './harness.ts'

/** NFR-3: members-only, moderated, non-anonymous, persistent, unlisted, archived (PLY-49). */
export const GAME_ROOM: RoomConfig = Object.freeze({
  name: 'Game room',
  membersOnly: true,
  moderated: true,
  persistent: true,
  public: false,
  whois: 'anyone',
  archive: true,
})

/** NFR-3 and §3 rule 15: whitelist access, publish by publishers. */
export const WHITELIST_NODE: NodeConfig = Object.freeze({
  accessModel: 'whitelist',
  publishModel: 'publishers',
  maxItems: 10,
  notifyRetract: true,
})

/** §3 rule 15: `game-setup` and the game theme's assets are readable by anyone (D20). */
export const OPEN_NODE: NodeConfig = Object.freeze({
  accessModel: 'open',
  publishModel: 'publishers',
  maxItems: 10,
  notifyRetract: true,
})

export interface Fixture {
  readonly tag: string
  readonly domain: string
  /** Shared password of the fixture accounts. Test-only. */
  readonly password: string
  readonly users: {
    readonly blueCo: string
    readonly blueObs: string
    readonly redCo: string
    readonly umpire: string
  }
  /** Room localparts; `Ctx.room()` gives the JID. */
  readonly rooms: {
    readonly blueHq: string
    readonly redHq: string
    readonly negotiation: string
  }
  readonly nodes: {
    readonly gameSetup: string
    readonly theme: string
    readonly announcements: string
    readonly gameState: string
    readonly forcesBlue: string
    readonly rolesBlueCo: string
    readonly objectivesBlue: string
    readonly objectivesRed: string
  }
}

export function makeFixture(domain: string): Fixture {
  const tag = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return {
    tag,
    domain,
    password: `pw-${tag}`,
    users: {
      blueCo: `${tag}-blue-co`,
      blueObs: `${tag}-blue-obs`,
      redCo: `${tag}-red-co`,
      umpire: `${tag}-umpire-1`,
    },
    rooms: {
      blueHq: `${tag}-blue-hq`,
      redHq: `${tag}-red-hq`,
      negotiation: `${tag}-negotiation`,
    },
    nodes: {
      gameSetup: `${tag}:game-setup`,
      theme: `${tag}:assets:theme`,
      announcements: `${tag}:announcements`,
      gameState: `${tag}:game-state`,
      forcesBlue: `${tag}:forces:blue`,
      rolesBlueCo: `${tag}:roles:blue-co`,
      objectivesBlue: `${tag}:objectives:blue`,
      objectivesRed: `${tag}:objectives:red`,
    },
  }
}

export const bare = (fx: Fixture, user: string): string => `${user}@${fx.domain}`

/** Who belongs where, from the fixture's point of view. */
export function plan(fx: Fixture) {
  const { blueCo, blueObs, redCo, umpire } = fx.users
  const everyRole = [blueCo, blueObs, redCo, umpire]
  return {
    rooms: [
      { room: fx.rooms.blueHq, members: [blueCo, blueObs, umpire] },
      { room: fx.rooms.redHq, members: [redCo, umpire] },
      { room: fx.rooms.negotiation, members: [blueCo, redCo, umpire] },
    ],
    nodes: [
      { node: fx.nodes.gameSetup, config: OPEN_NODE, readers: [], publishers: [] },
      { node: fx.nodes.theme, config: OPEN_NODE, readers: [], publishers: [] },
      { node: fx.nodes.announcements, config: WHITELIST_NODE, readers: everyRole, publishers: [] },
      { node: fx.nodes.gameState, config: WHITELIST_NODE, readers: everyRole, publishers: [] },
      { node: fx.nodes.forcesBlue, config: WHITELIST_NODE, readers: everyRole, publishers: [] },
      { node: fx.nodes.rolesBlueCo, config: WHITELIST_NODE, readers: everyRole, publishers: [] },
      {
        node: fx.nodes.objectivesBlue,
        config: WHITELIST_NODE,
        readers: [blueCo, blueObs],
        publishers: [umpire],
      },
      {
        node: fx.nodes.objectivesRed,
        config: WHITELIST_NODE,
        readers: [redCo],
        publishers: [umpire],
      },
    ],
  }
}

/**
 * The observer's voice, revoked by the password route (S13, ADM-37): the observer joins once,
 * the admin (owner, so moderator) sets it to `visitor` by nick, and both leave. The server stores
 * the role per bare JID for later joins (R13).
 */
export async function revokeVoice(
  admin: Session,
  observer: Session,
  room: string,
  nick: string,
): Promise<void> {
  must(await observer.muc.join(room, nick), 'observer joins')
  must(await admin.muc.join(room, 'admin'), 'admin joins')
  must(await admin.muc.setRole(room, nick, 'visitor', 'observer'), 'admin revokes voice')
  must(await admin.muc.leave(room), 'admin leaves')
  must(await observer.muc.leave(room), 'observer leaves')
}

/** Single-document nodes hold one item, id `current` (WP 1.6); the suite publishes them so. */
export const CURRENT = 'current'

/** Accounts, rooms with affiliations, nodes with affiliations, and one seed item per node. */
export async function provision(
  fx: Fixture,
  admin: Session,
  loginObserver: () => Promise<Session>,
): Promise<void> {
  for (const user of Object.values(fx.users)) {
    must(await admin.admin.addUser(bare(fx, user), fx.password), `add-user ${user}`)
  }
  const muc = admin.services.muc
  for (const { room, members } of plan(fx).rooms) {
    const jid = `${room}@${muc}`
    must(await admin.muc.createRoom(jid, { ...GAME_ROOM, name: room }), `create ${room}`)
    const entries = members.map((m) => ({ jid: bare(fx, m), affiliation: 'member' as const }))
    must(await admin.muc.setAffiliations(jid, entries), `affiliate ${room}`)
  }
  const observer = await loginObserver()
  try {
    await revokeVoice(admin, observer, `${fx.rooms.blueHq}@${muc}`, 'blue-obs')
  } finally {
    await observer.disconnect()
  }
  for (const { node, config, readers, publishers } of plan(fx).nodes) {
    must(await admin.pubsub.createNode(node, config), `create node ${node}`)
    const entries = [
      ...readers.map((r) => ({ jid: bare(fx, r), affiliation: 'member' as const })),
      ...publishers.map((p) => ({ jid: bare(fx, p), affiliation: 'publisher' as const })),
    ]
    must(await admin.pubsub.setAffiliations(node, entries), `affiliate ${node}`)
    must(await admin.pubsub.publish(node, CURRENT, json({ seed: node })), `seed ${node}`)
  }
}

/** Removes what provision() created. Best effort: a failure here must not hide test results. */
export async function teardown(fx: Fixture, admin: Session): Promise<void> {
  for (const { node } of plan(fx).nodes) await admin.pubsub.deleteNode(node)
  for (const { room } of plan(fx).rooms)
    await admin.muc.destroyRoom(`${room}@${admin.services.muc}`)
  for (const user of Object.values(fx.users)) await admin.admin.deleteUser(bare(fx, user))
}
