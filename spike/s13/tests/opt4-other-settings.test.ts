// S13 option 4: the other documented ejabberd room settings that decide a default role
// (docs.ejabberd.im, mod_muc default_room_options: members_by_default, moderated, members_only,
// password_protected). In ejabberd only users with affiliation `none` can get `visitor` by default
// (get_default_role/2), so these variants drop members-only and give the observer no affiliation:
//   4a  open room, moderated, members_by_default=false
//   4b  as 4a, plus password_protected (room password)
// Both make the observer a visitor on its first join without its password. What they cost is
// confidentiality: a room that is not members-only admits other accounts and anonymous users (D8,
// NFR-21, xmpp-spike S10). The tests measure both sides, plus reconnect and restart for 4a.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { restartServer } from '../src/docker.js'
import {
  adminLogin,
  createAccount,
  loginsOf,
  makeRoom,
  READ_ONLY,
  verifyJoin,
  type Account,
} from '../src/fixture.js'
import {
  captureStanzas,
  collect,
  connect,
  disconnect,
  disconnectAll,
  observe,
  outcome,
  saveStanzas,
  uniq,
  waitFor,
  type Client,
} from '../src/harness.js'

const T = 'reference' as const
const tag = uniq('o4')
const ROOM_PASSWORD = 'o4-room-secret'
let a: Client
let observer: Account
let poster: Account
let otherForce: Account
let roomA: string
let roomB: string

const OPEN_VISITORS = { 'muc#roomconfig_membersonly': false, members_by_default: false }

beforeAll(async () => {
  a = await adminLogin(T, 'o4')
  observer = await createAccount(a, T, `${tag}-obs`)
  poster = await createAccount(a, T, `${tag}-poster`)
  otherForce = await createAccount(a, T, `${tag}-red`)
  // The observer gets NO affiliation: that is what makes it a default visitor.
  roomA = await makeRoom(a, T, `${tag}-a`, OPEN_VISITORS, { [poster.jid]: 'member' })
  roomB = await makeRoom(
    a,
    T,
    `${tag}-b`,
    {
      ...OPEN_VISITORS,
      'muc#roomconfig_passwordprotectedroom': true,
      'muc#roomconfig_roomsecret': ROOM_PASSWORD,
    },
    { [poster.jid]: 'member' },
  )
})

afterAll(disconnectAll)

/** A user that should not be in the room joins and waits for a poster message; returns what it got. */
async function intruderReads(
  intruder: Client,
  room: string,
  nick: string,
  name: string,
  lines: string[],
  password?: string,
) {
  const join = await outcome(
    intruder.joinRoom(room, nick, password ? { muc: { type: 'join', password } } : {}),
  )
  if (!join.ok) {
    await saveStanzas(name, lines)
    return { joined: false, condition: join.condition, text: join.text }
  }
  const p = await connect(T, poster.user, poster.password, { resource: uniq('poster') })
  await p.joinRoom(room, poster.user, { muc: { type: 'join', password: ROOM_PASSWORD } })
  const body = uniq('secret-plan')
  const got = waitFor(intruder, 'message', (m) => m.body === body, 3_000).then(
    () => true,
    () => false,
  )
  p.sendMessage({ to: room, type: 'groupchat', body })
  const read = await got
  await saveStanzas(name, lines)
  await disconnect(p)
  const role = (join.value as { muc?: { role?: string } }).muc?.role
  return { joined: true, role, readPosterMessage: read }
}

describe('S13 option 4a: open, moderated room with members_by_default=false; observer has no affiliation', () => {
  it("observer's first join is visitor, its post is rejected and not delivered; the poster can post", async () => {
    expect(loginsOf(T, observer.user)).toHaveLength(0)
    const r = await verifyJoin(T, roomA, observer, poster, 'opt4a-first-join')
    await observe('opt4a', 'first join', r)
    expect(r).toMatchObject({ ...READ_ONLY, observerAffiliation: 'none' })
  })

  it('holds after the observer reconnects', async () => {
    const r = await verifyJoin(T, roomA, observer, poster, 'opt4a-reconnect')
    expect(r).toMatchObject({ ...READ_ONLY, observerAffiliation: 'none' })
  })

  it('holds after a server restart', async () => {
    const ms = await restartServer(T)
    await observe('opt4a', 'restart took ms', ms)
    a = await adminLogin(T, 'o4-after-restart')
    const r = await verifyJoin(T, roomA, observer, poster, 'opt4a-after-restart')
    await observe('opt4a', 'after restart', r)
    expect(r).toMatchObject({ ...READ_ONLY, observerAffiliation: 'none' })
  })

  it('MAM: archive access for the observer (affiliation none) and for an anonymous user', async () => {
    const o = await connect(T, observer.user, observer.password, { resource: uniq('obs-mam') })
    const obsMam = await outcome(o.searchHistory(roomA, { paging: { max: 0 } }))
    const anon = await connect(T, '', undefined, { anonymous: true, resource: uniq('anon-mam') })
    const anonMam = await outcome(anon.searchHistory(roomA, { paging: { max: 0 } }))
    const summary = (r: typeof obsMam) =>
      r.ok
        ? { ok: true, count: (r.value as { paging?: { count?: number } }).paging?.count }
        : { ok: false, condition: r.condition, text: r.text }
    const r = { observer: summary(obsMam), anonymous: summary(anonMam) }
    await observe('opt4a', 'MAM access', r)
    // WRX1 clients load room history from MAM (xmpp-spike S5). In a room that is not members-only,
    // ejabberd serves the archive to any user, without joining: the observer can read history, and
    // so can an anonymous session (the earlier tests in this file posted messages).
    expect(r).toMatchObject({ observer: { ok: true }, anonymous: { ok: true } })
    expect(r.anonymous.count).toBeGreaterThan(0)
  })

  it('FAILS confidentiality: an account of another force and an anonymous user both join and read', async () => {
    let lines: string[] = []
    const red = await connect(T, otherForce.user, otherForce.password, {
      resource: uniq('red'),
      onCreate: (c) => (lines = captureStanzas(c, 'other-force').lines),
    })
    const redResult = await intruderReads(
      red,
      roomA,
      otherForce.user,
      'opt4a-other-force-reads',
      lines,
    )
    let anonLines: string[] = []
    const anon = await connect(T, '', undefined, {
      anonymous: true,
      resource: uniq('anon'),
      onCreate: (c) => (anonLines = captureStanzas(c, 'anonymous').lines),
    })
    const anonResult = await intruderReads(
      anon,
      roomA,
      uniq('anon'),
      'opt4a-anonymous-reads',
      anonLines,
    )
    await observe('opt4a', 'intruders', { otherForce: redResult, anonymous: anonResult })
    expect(redResult).toEqual({ joined: true, role: 'visitor', readPosterMessage: true })
    expect(anonResult).toEqual({ joined: true, role: 'visitor', readPosterMessage: true })
    // Only blocking each unwanted JID would close this: outcast every other account (anonymous JIDs
    // are random, so they cannot be outcast), or restrict the whole MUC service. Neither is per room.
  })
})

describe('S13 option 4b: as 4a plus a room password', () => {
  it('observer (given the room password) first joins as visitor and cannot post', async () => {
    const lines: string[] = []
    const o = await connect(T, observer.user, observer.password, {
      resource: uniq('obs'),
      onCreate: (c) => captureInto(c, lines, 'observer'),
    })
    const self = await o.joinRoom(roomB, observer.user, {
      muc: { type: 'join', password: ROOM_PASSWORD },
    })
    const p = await connect(T, poster.user, poster.password, {
      resource: uniq('poster'),
      onCreate: (c) => captureInto(c, lines, 'poster'),
    })
    await p.joinRoom(roomB, poster.user, { muc: { type: 'join', password: ROOM_PASSWORD } })
    const body = uniq('obs-post')
    const seen = collect(p, 'message', (m) => m.body === body, 2_000)
    const err = waitFor(o, 'message', (m) => m.type === 'error', 2_000)
    o.sendMessage({ to: roomB, type: 'groupchat', body })
    const [e, delivered] = await Promise.all([err, seen])
    await saveStanzas('opt4b-observer', lines)
    const r = { role: self.muc?.role, error: e.error?.condition, delivered: delivered.length }
    await observe('opt4b', 'observer with room password', r)
    expect(r).toEqual({ role: 'visitor', error: 'forbidden', delivered: 0 })
  })

  it('members need the password too, and anyone holding it (anonymous included) joins and reads', async () => {
    const lines: string[] = []
    const p = await connect(T, poster.user, poster.password, {
      resource: uniq('poster'),
      onCreate: (c) => captureInto(c, lines, 'poster-no-password'),
    })
    const memberNoPassword = await outcome(p.joinRoom(roomB, poster.user))
    await disconnect(p)
    const anonNoPw = await connect(T, '', undefined, { anonymous: true, resource: uniq('anon') })
    const anonWithout = await outcome(anonNoPw.joinRoom(roomB, uniq('anon')))
    let anonLines: string[] = []
    const anon = await connect(T, '', undefined, {
      anonymous: true,
      resource: uniq('anon'),
      onCreate: (c) => (anonLines = captureStanzas(c, 'anonymous').lines),
    })
    const anonWith = await intruderReads(
      anon,
      roomB,
      uniq('anon'),
      'opt4b-anonymous-with-password',
      anonLines,
      ROOM_PASSWORD,
    )
    await saveStanzas('opt4b-member-without-password', lines)
    const r = {
      memberWithoutPassword: memberNoPassword.ok ? 'joined' : memberNoPassword.condition,
      anonymousWithoutPassword: anonWithout.ok ? 'joined' : anonWithout.condition,
      anonymousWithPassword: anonWith,
    }
    await observe('opt4b', 'password room access', r)
    expect(r).toEqual({
      memberWithoutPassword: 'not-authorized',
      anonymousWithoutPassword: 'not-authorized',
      anonymousWithPassword: { joined: true, role: 'visitor', readPosterMessage: true },
    })
  })
})

function captureInto(c: Client, lines: string[], label: string): void {
  c.on('raw:incoming', (xml: string) => lines.push(`<!-- in ${label} -->\n${xml}`))
  c.on('raw:outgoing', (xml: string) => lines.push(`<!-- out ${label} -->\n${xml}`))
}
