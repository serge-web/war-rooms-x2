// S13 option 3: ejabberd's documented API commands over XMPP ad-hoc (XEP-0050), via mod_adhoc_api,
// on the `ejabberd-adhocapi` variant. api_permissions there grants the admin JID only the room-settings
// and affiliation commands (docker/ejabberd-adhocapi.yml). No REST, no HTTP: every call below is an
// ad-hoc command on the admin's own XMPP session.
//
// ejabberd 26.09 documents no command that sets an occupant role or voice (`ejabberdctl help tags`,
// tags muc_room / muc / muc_sub). So the test asks: can the documented room and affiliation commands
// make a never-joined observer a visitor?

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminLogin,
  bare,
  CAN_POST,
  createAccount,
  loginsOf,
  makeRoom,
  verifyJoin,
  type Account,
} from '../src/fixture.js'
import { servers } from '../src/config.js'
import {
  captureStanzas,
  disconnectAll,
  observe,
  saveStanzas,
  uniq,
  type Client,
} from '../src/harness.js'
import { API_NODE, apiCommand } from '../src/xmpp-admin.js'

const T = 'adhocapi' as const
const tag = uniq('o3')
const domain = servers[T].domain
const service = servers[T].mucDomain
let a: Client
let observer: Account
let poster: Account
let room: string

const ALLOWED = [
  'change_room_option',
  'get_room_affiliation',
  'get_room_affiliations',
  'get_room_options',
  'set_room_affiliation',
]

beforeAll(async () => {
  a = await adminLogin(T, 'o3')
  observer = await createAccount(a, T, `${tag}-obs`)
  poster = await createAccount(a, T, `${tag}-poster`)
  // Room created as owner (as on the reference); affiliations come from the API below.
  room = await makeRoom(a, T, tag, {}, {})
})

afterAll(disconnectAll)

describe('S13 option 3: documented ejabberd room/affiliation commands over XMPP ad-hoc (mod_adhoc_api)', () => {
  it('the admin sees only the permitted room commands', async () => {
    const items = await a.getDiscoItems(domain, API_NODE)
    const names = (items.items ?? []).map((i) => i.node?.replace(`${API_NODE}/`, '')).sort()
    await observe('opt3', 'advertised API commands', names)
    expect(names).toEqual(ALLOWED)
  })

  it('set_room_affiliation accepts affiliations only: "visitor" is refused', async () => {
    const cap = captureStanzas(a, 'admin')
    const r = await apiCommand(a, domain, 'set_room_affiliation', {
      room: tag,
      service,
      user: observer.user,
      host: domain,
      affiliation: 'visitor',
    })
    cap.stop()
    await saveStanzas('opt3-set-room-affiliation-visitor', cap.lines)
    await observe('opt3', 'set_room_affiliation affiliation=visitor', r)
    expect(r).toMatchObject({ ok: false, text: 'Invalid affiliation' })
  })

  it('room set up with set_room_affiliation + change_room_option: observer first join is participant (option 3 fails)', async () => {
    const cap = captureStanzas(a, 'admin')
    const steps = {
      observerMember: await apiCommand(a, domain, 'set_room_affiliation', {
        room: tag,
        service,
        user: observer.user,
        host: domain,
        affiliation: 'member',
      }),
      posterMember: await apiCommand(a, domain, 'set_room_affiliation', {
        room: tag,
        service,
        user: poster.user,
        host: domain,
        affiliation: 'member',
      }),
      moderated: await apiCommand(a, domain, 'change_room_option', {
        room: tag,
        service,
        option: 'moderated',
        value: 'true',
      }),
      membersByDefault: await apiCommand(a, domain, 'change_room_option', {
        room: tag,
        service,
        option: 'members_by_default',
        value: 'false',
      }),
      options: await apiCommand(a, domain, 'get_room_options', { room: tag, service }),
      affiliations: await apiCommand(a, domain, 'get_room_affiliations', { room: tag, service }),
    }
    cap.stop()
    await saveStanzas('opt3-adhoc-room-setup', cap.lines)
    await observe('opt3', 'ad-hoc room setup', steps)
    for (const k of [
      'observerMember',
      'posterMember',
      'moderated',
      'membersByDefault',
      'options',
      'affiliations',
    ] as const)
      expect(steps[k].ok, k).toBe(true)

    // The room options have no per-user role entry (ejabberd keeps stored roles outside them), so no
    // change_room_option call can store a visitor role.
    const optionNames = (steps.options.fields?.['options'] as string[]).map((o) => o.split(':')[0])
    expect(optionNames).toContain('members_by_default')
    expect(optionNames.filter((n) => /role|voice(?!_request)/.test(n ?? ''))).toEqual([])
    expect(steps.affiliations.fields?.['affiliations']).toContain(
      `${bare(T, observer.user)} : member : `,
    )

    expect(loginsOf(T, observer.user)).toHaveLength(0)
    const r = await verifyJoin(T, room, observer, poster, 'opt3-first-join')
    await observe('opt3', 'first join after ad-hoc setup', r)
    expect(r).toMatchObject(CAN_POST)
  })
})
