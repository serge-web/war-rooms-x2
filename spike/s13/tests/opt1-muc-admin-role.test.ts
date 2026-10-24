// S13 option 1: XEP-0045 §8.4 (revoking voice) / §8.5 (voice list) sent by the admin, as room owner
// and moderator, while the observer account is not in the room. The admin names the observer by bare
// JID, by full JID, or by nick, with role='visitor'. ejabberd's answer is recorded, and the observer's
// first join shows whether anything was stored.
//
// The last test is a labelled BASELINE: today's route (the admin logs in as the observer, using its
// password). It is here only to show that verifyJoin() detects a stored visitor role on this stack.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminLogin,
  CAN_POST,
  createAccount,
  loginsOf,
  makeRoom,
  READ_ONLY,
  verifyJoin,
  type Account,
} from '../src/fixture.js'
import {
  captureStanzas,
  connect,
  disconnect,
  disconnectAll,
  observe,
  rawOutcome,
  rawRequest,
  saveStanzas,
  uniq,
  type Client,
} from '../src/harness.js'

const T = 'reference' as const
const tag = uniq('o1')
let a: Client
let observer: Account
let poster: Account
let room: string

const NS_ADMIN = 'http://jabber.org/protocol/muc#admin'

/** Admin (in the room as owner/moderator) sends one muc#admin item; returns ejabberd's raw reply. */
async function roleChange(admin: Client, roomJid: string, itemAttrs: string): Promise<string> {
  const id = uniq('role')
  return rawRequest(
    admin,
    `<iq xmlns="jabber:client" type="set" to="${roomJid}" id="${id}"><query xmlns="${NS_ADMIN}"><item ${itemAttrs}/></query></iq>`,
    id,
  )
}

beforeAll(async () => {
  a = await adminLogin(T, 'o1')
  observer = await createAccount(a, T, `${tag}-obs`)
  poster = await createAccount(a, T, `${tag}-poster`)
  room = await makeRoom(a, T, tag, {}, { [observer.jid]: 'member', [poster.jid]: 'member' })
})

afterAll(disconnectAll)

describe('S13 option 1: muc#admin role=visitor for an observer that is not in the room', () => {
  it('ejabberd refuses the role change by JID, full JID, nick, or JID with affiliation', async () => {
    const cap = captureStanzas(a, 'admin')
    await a.joinRoom(room, 'admin')
    const tries = {
      bareJid: `jid="${observer.jid}" role="visitor"`,
      fullJid: `jid="${observer.jid}/browser" role="visitor"`,
      nick: `nick="${observer.user}" role="visitor"`,
      jidWithAffiliation: `jid="${observer.jid}" affiliation="member" role="visitor"`,
    }
    const replies: Record<string, ReturnType<typeof rawOutcome>> = {}
    for (const [k, attrs] of Object.entries(tries))
      replies[k] = rawOutcome(await roleChange(a, room, attrs))
    await a.leaveRoom(room, 'admin')
    cap.stop()
    await saveStanzas('opt1-admin-role-change-offline', cap.lines)
    await observe('opt1', 'muc#admin role=visitor, observer never joined', replies)
    const notAllowed = {
      type: 'error',
      condition: 'not-allowed',
      text: 'Changing role/affiliation is not allowed',
    }
    expect(replies).toEqual({
      bareJid: notAllowed,
      fullJid: notAllowed,
      nick: {
        type: 'error',
        condition: 'not-acceptable',
        text: `Nickname ${observer.user} does not exist in the room`,
      },
      jidWithAffiliation: notAllowed,
    })
  })

  it("the observer's first join is as participant, and its post is delivered (option 1 fails)", async () => {
    expect(loginsOf(T, observer.user), 'observer logged in before its first join').toHaveLength(0)
    const r = await verifyJoin(T, room, observer, poster, 'opt1-first-join')
    await observe('opt1', 'first join after refused role change', r)
    expect(r).toMatchObject(CAN_POST)
  })

  it('R-B situation (observer joined before, now offline): still refused, still participant', async () => {
    // The observer has now been in the room once (previous test) and is offline again: the state
    // after an affiliation change has cleared its stored role (R-B).
    await a.setRoomAffiliation(room, observer.jid, 'none')
    await a.setRoomAffiliation(room, observer.jid, 'member')
    const cap = captureStanzas(a, 'admin')
    await a.joinRoom(room, 'admin')
    const reply = rawOutcome(await roleChange(a, room, `jid="${observer.jid}" role="visitor"`))
    await a.leaveRoom(room, 'admin')
    cap.stop()
    await saveStanzas('opt1-admin-role-change-after-rejoin', cap.lines)
    await observe('opt1', 'muc#admin role=visitor, observer joined before, now offline', reply)
    expect(reply).toEqual({
      type: 'error',
      condition: 'not-allowed',
      text: 'Changing role/affiliation is not allowed',
    })
    const r = await verifyJoin(T, room, observer, poster, 'opt1-rejoin')
    expect(r).toMatchObject(CAN_POST)
  })

  it('BASELINE, uses the observer password: present observer + role change by nick gives a stored visitor', async () => {
    // Today's AdminOps.revokeObserverVoice (xmpp-spike), shown only to prove the harness can tell.
    const o = await connect(T, observer.user, observer.password, { resource: uniq('baseline') })
    await o.joinRoom(room, observer.user)
    await a.joinRoom(room, 'admin')
    const reply = rawOutcome(await roleChange(a, room, `nick="${observer.user}" role="visitor"`))
    await a.leaveRoom(room, 'admin')
    await disconnect(o)
    expect(reply).toEqual({ type: 'result' })
    const r = await verifyJoin(T, room, observer, poster, 'opt1-baseline-password-route')
    await observe('opt1', 'baseline (password route)', r)
    expect(r).toMatchObject(READ_ONLY)
  })
})
