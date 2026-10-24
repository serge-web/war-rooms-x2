// S13 fixture: per-test accounts and rooms, and the verification join that every option is judged by.
//
// Credentials. The admin creates each account with XEP-0133 add-user, so the test process knows every
// password. Those passwords are used ONLY by verifyJoin() (the player's own login, standing in for the
// player at the browser) and, in the labelled baseline, by the current password route. Every admin
// operation under test is given the account's bare JID only. The login ledger proves it: the tests
// assert that the observer account has never logged in before its first verification join.

import { randomBytes } from 'node:crypto'
import { ADMIN_PASSWORD, GAME_ROOM_CONFIG, servers, type Target } from './config.js'
import {
  collect,
  connect,
  disconnect,
  loginLedger,
  saveStanzas,
  sendRaw,
  uniq,
  waitFor,
  type AnyStanza,
  type Client,
} from './harness.js'
import { admin as adhoc, createRoom, leaveRoom } from './xmpp-admin.js'

export interface Account {
  user: string
  jid: string
  /** Test-only credential: for the account's own login in verifyJoin(), never for admin operations. */
  password: string
}

export const bare = (target: Target, user: string) => `${user}@${servers[target].domain}`
export const roomJidOf = (target: Target, room: string) => `${room}@${servers[target].mucDomain}`

export function adminLogin(target: Target, label: string): Promise<Client> {
  return connect(target, 'admin', ADMIN_PASSWORD, { resource: uniq(label) })
}

export async function createAccount(a: Client, target: Target, user: string): Promise<Account> {
  const password = randomBytes(12).toString('base64url')
  const jid = bare(target, user)
  await adhoc.addUser(a, servers[target].domain, jid, password)
  return { user, jid, password }
}

/** Logins made by `user` on `target` so far (from the harness ledger). */
export const loginsOf = (target: Target, user: string) =>
  loginLedger.filter((l) => l.target === target && l.user === user)

/**
 * Create a game room as admin (game-room config plus overrides), set affiliations, and leave it, so
 * no moderator is present afterwards. Returns the room JID.
 */
export async function makeRoom(
  a: Client,
  target: Target,
  room: string,
  overrides: Record<string, string | boolean | string[]>,
  affiliations: Record<string, 'member' | 'none' | 'outcast' | 'admin' | 'owner'>,
): Promise<string> {
  const jid = roomJidOf(target, room)
  await createRoom(
    a,
    jid,
    { ...GAME_ROOM_CONFIG, ...overrides },
    affiliations as Record<string, 'member'>,
  )
  await leaveRoom(a, jid, 'admin')
  return jid
}

export interface PostResult {
  /** Error stanza returned to the sender, if any. */
  error?: { type?: string | undefined; condition?: string | undefined; text?: string | undefined }
  /** How many copies the other occupant received. */
  deliveredToOther: number
}

export interface VerifyResult {
  observerRole?: string
  observerAffiliation?: string
  /** Occupant presences with role moderator seen by the observer on join (should be 0: no admin online). */
  moderatorsPresent: number
  observerPost: PostResult
  posterRole?: string
  posterPost: PostResult
}

async function post(
  sender: Client,
  other: Client,
  roomJid: string,
  tag: string,
): Promise<PostResult> {
  const body = uniq(tag)
  const seen = collect(other, 'message', (m) => m.body === body, 2_000)
  const err = waitFor(
    sender,
    'message',
    (m) => m.type === 'error' && m.from === roomJid,
    2_000,
  ).catch(() => undefined)
  // Raw stanza, so no client-side check can hide what the server does.
  sendRaw(
    sender,
    `<message xmlns="jabber:client" to="${roomJid}" type="groupchat" id="${uniq('m')}"><body>${body}</body></message>`,
  )
  const [e, got] = await Promise.all([err, seen])
  const error = (e as AnyStanza | undefined)?.error as PostResult['error'] | undefined
  return {
    ...(error ? { error: { type: error.type, condition: error.condition, text: error.text } } : {}),
    deliveredToOther: got.length,
  }
}

/**
 * The verification join. The poster joins, then the observer joins (its own login), then each posts
 * once. Saves both sides' stanzas to stanzas/<name>.xml. No admin is in the room.
 */
export async function verifyJoin(
  target: Target,
  roomJid: string,
  observer: Account,
  poster: Account,
  name: string,
): Promise<VerifyResult> {
  const lines: string[] = []
  const p = await connect(target, poster.user, poster.password, {
    resource: uniq('poster'),
    onCreate: (c) => captureInto(c, 'poster', lines),
  })
  const posterSelf = await p.joinRoom(roomJid, poster.user)
  const o = await connect(target, observer.user, observer.password, {
    resource: uniq('obs'),
    onCreate: (c) => captureInto(c, 'observer', lines),
  })
  const occupants = collect(o, 'presence', (s) => !!s.from?.startsWith(`${roomJid}/`), 1_000)
  const obsSelf = await o.joinRoom(roomJid, observer.user)
  const moderatorsPresent = (await occupants).filter((s) => s.muc?.role === 'moderator').length
  const observerPost = await post(o, p, roomJid, 'observer-post')
  const posterPost = await post(p, o, roomJid, 'poster-post')
  await saveStanzas(name, lines)
  await disconnect(o)
  await disconnect(p)
  return {
    observerRole: obsSelf.muc?.role,
    observerAffiliation: obsSelf.muc?.affiliation,
    moderatorsPresent,
    observerPost,
    posterRole: posterSelf.muc?.role,
    posterPost,
  } as VerifyResult
}

function captureInto(c: Client, label: string, lines: string[]): void {
  c.on('raw:incoming', (xml: string) => lines.push(`<!-- in ${label} -->\n${xml}`))
  c.on('raw:outgoing', (xml: string) => lines.push(`<!-- out ${label} -->\n${xml}`))
}

/** The read-only outcome every passing option must show. */
export const READ_ONLY = {
  observerRole: 'visitor',
  moderatorsPresent: 0,
  observerPost: {
    error: {
      type: 'auth',
      condition: 'forbidden',
      text: 'Visitors are not allowed to send messages to all occupants',
    },
    deliveredToOther: 0,
  },
  posterRole: 'participant',
  posterPost: { deliveredToOther: 1 },
}

/** The outcome when the observer is NOT read-only: it joins with voice and its post reaches the poster. */
export const CAN_POST = {
  observerRole: 'participant',
  moderatorsPresent: 0,
  observerPost: { deliveredToOther: 1 },
  posterRole: 'participant',
  posterPost: { deliveredToOther: 1 },
}
