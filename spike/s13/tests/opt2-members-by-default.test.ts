// S13 option 2: room configuration `members_by_default=false` ("Default users as participants" off)
// in a moderated, members-only game room. The hope: members join as visitors by default, and posters
// are given voice. The admin sets it with the muc#owner config form (XEP-0045 §10.2), no observer login.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminLogin,
  CAN_POST,
  createAccount,
  loginsOf,
  makeRoom,
  type Account,
} from '../src/fixture.js'
import { verifyJoin } from '../src/fixture.js'
import {
  captureStanzas,
  connect,
  disconnectAll,
  observe,
  outcome,
  saveStanzas,
  uniq,
  type Client,
} from '../src/harness.js'
import { roomConfigValue } from '../src/xmpp-admin.js'

const T = 'reference' as const
const tag = uniq('o2')
let a: Client
let observer: Account
let poster: Account
let outsider: Account
let room: string

beforeAll(async () => {
  a = await adminLogin(T, 'o2')
  observer = await createAccount(a, T, `${tag}-obs`)
  poster = await createAccount(a, T, `${tag}-poster`)
  outsider = await createAccount(a, T, `${tag}-noaff`)
  room = await makeRoom(
    a,
    T,
    tag,
    { members_by_default: false },
    { [observer.jid]: 'member', [poster.jid]: 'member' },
  )
})

afterAll(disconnectAll)

describe('S13 option 2: members_by_default=false in a moderated members-only room', () => {
  it('the setting is stored', async () => {
    await a.joinRoom(room, 'admin')
    const cfg = {
      membersonly: await roomConfigValue(a, room, 'muc#roomconfig_membersonly'),
      moderated: await roomConfigValue(a, room, 'muc#roomconfig_moderatedroom'),
      members_by_default: await roomConfigValue(a, room, 'members_by_default'),
    }
    await a.leaveRoom(room, 'admin')
    expect(cfg).toEqual({ membersonly: true, moderated: true, members_by_default: false })
  })

  it('a member observer still joins as participant and its post is delivered (option 2 fails)', async () => {
    expect(loginsOf(T, observer.user)).toHaveLength(0)
    const r = await verifyJoin(T, room, observer, poster, 'opt2-member-observer')
    await observe('opt2', 'member observer, members_by_default=false', r)
    // ejabberd: get_default_role(member) is always participant; members_by_default only decides the
    // default role of users with affiliation none, and a members-only room refuses those.
    expect(r).toMatchObject(CAN_POST)
  })

  it('a user with affiliation none (who would default to visitor) cannot enter a members-only room', async () => {
    let lines: string[] = []
    const n = await connect(T, outsider.user, outsider.password, {
      resource: uniq('noaff'),
      onCreate: (c) => (lines = captureStanzas(c, 'no-affiliation').lines),
    })
    const r = await outcome(n.joinRoom(room, outsider.user))
    await saveStanzas('opt2-no-affiliation-join', lines)
    await observe('opt2', 'affiliation none join', r)
    expect(r).toMatchObject({
      ok: false,
      condition: 'registration-required',
      text: 'Membership is required to enter this room',
    })
  })
})
