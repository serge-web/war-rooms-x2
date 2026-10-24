// The MUC and PubSub modules without a server: stanzas captured from ejabberd are parsed with
// StanzaJS's registry and fed to the handlers; outgoing stanzas are captured, not sent.
import { err, ok } from '@wrx/transport'
import type { ItemsEvent, OccupantEvent, Outcome, RoomMessage } from '@wrx/transport'
import { JXT, createClient } from 'stanza'
import type * as XMPP from 'stanza'
import { describe, expect, it, vi } from 'vitest'
import type { Core } from './core.ts'
import { ejabberd } from './ejabberd.ts'
import { XmppMuc } from './muc.ts'
import { XmppPubsub } from './pubsub.ts'
import { Refusal } from './refusal.ts'

const ROOM = 'blue-hq@conference.localhost'
const ME = 'blue-co@localhost/pane'

function setup() {
  const client = createClient({ jid: ME, transports: { websocket: false, bosh: false } })
  client.jid = ME
  const sent: XMPP.Stanzas.Message[] = []
  const presences: XMPP.Stanzas.Presence[] = []
  vi.spyOn(client, 'sendMessage').mockImplementation((m) => {
    sent.push(m)
    return m.id ?? ''
  })
  vi.spyOn(client, 'sendPresence').mockImplementation((p) => {
    if (p !== undefined) presences.push(p)
    return p?.id ?? ''
  })
  const core: Core = {
    client,
    adapter: ejabberd,
    domain: 'localhost',
    timeoutMs: 2_000,
    services: () => ({ muc: 'conference.localhost', pubsub: 'pubsub.localhost' }),
    bareJid: () => 'blue-co@localhost',
    async run<T>(operation: () => Promise<T>): Outcome<T> {
      try {
        return ok(await operation())
      } catch (reason) {
        if (reason instanceof Refusal) return { ok: false, error: reason.error }
        const error = ejabberd.stanzaError(reason)
        if (error !== undefined) return { ok: false, error }
        throw reason
      }
    },
  }
  const parse = <K extends 'message' | 'presence'>(kind: K, xml: string) => {
    const element = JXT.parse(xml)
    const data: unknown = client.stanzas.import(element)
    return { kind, data }
  }
  return { client, core, sent, presences, parse }
}

function presence(xml: string): XMPP.Stanzas.ReceivedPresence {
  const client = createClient({ transports: { websocket: false, bosh: false } })
  const data = client.stanzas.import(JXT.parse(xml))
  if (data === undefined || !('from' in data) || typeof data.from !== 'string') throw new Error(xml)
  return { from: data.from, to: ME, ...data }
}

function message(xml: string): XMPP.Stanzas.ReceivedMessage {
  const client = createClient({ transports: { websocket: false, bosh: false } })
  const data = client.stanzas.import(JXT.parse(xml))
  if (data === undefined || !('from' in data) || typeof data.from !== 'string') throw new Error(xml)
  return { from: data.from, to: ME, ...data }
}

const selfPresence = presence(
  `<presence xmlns='jabber:client' from='${ROOM}/blue-co' to='${ME}'><x xmlns='http://jabber.org/protocol/muc#user'>` +
    `<item jid='${ME}' role='participant' affiliation='member'/><status code='110'/></x></presence>`,
)
const umpirePresence = presence(
  `<presence xmlns='jabber:client' from='${ROOM}/umpire-1' to='${ME}'><x xmlns='http://jabber.org/protocol/muc#user'>` +
    `<item jid='umpire-1@localhost/x' role='participant' affiliation='member'/></x></presence>`,
)

describe('XmppMuc (XEP-0045) offline', () => {
  it('resolves join on self-presence and tracks occupants in order', async () => {
    const { core, presences } = setup()
    const muc = new XmppMuc(core)
    const events: OccupantEvent[] = []
    muc.onOccupant(ROOM, (e) => events.push(e))
    const joining = muc.join(ROOM, 'blue-co')
    await Promise.resolve()
    expect(presences[0]).toMatchObject({ to: `${ROOM}/blue-co`, muc: { type: 'join' } })
    muc.handlePresence(umpirePresence)
    muc.handlePresence(selfPresence)
    expect(await joining).toEqual(
      ok({ room: ROOM, nick: 'blue-co', role: 'participant', affiliation: 'member' }),
    )
    expect(events.map((e) => [e.nick, e.self, e.jid])).toEqual([
      ['umpire-1', false, 'umpire-1@localhost'],
      ['blue-co', true, 'blue-co@localhost'],
    ])
    expect(muc.joinedRooms()).toEqual([ROOM])
  })

  it('reports a refused join with the server condition', async () => {
    const { core } = setup()
    const muc = new XmppMuc(core)
    const joining = muc.join(ROOM, 'blue-co')
    muc.handlePresence(
      presence(
        `<presence xmlns='jabber:client' from='${ROOM}/blue-co' type='error'><error type='auth'>` +
          `<text xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'>Membership is required to enter this room</text>` +
          `<registration-required xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></presence>`,
      ),
    )
    expect(await joining).toMatchObject({
      ok: false,
      error: { condition: 'registration-required' },
    })
    expect(muc.joinedRooms()).toEqual([])
  })

  it('turns history and live messages into RoomMessages with server time and sender', async () => {
    const { core } = setup()
    const muc = new XmppMuc(core)
    const joining = muc.join(ROOM, 'blue-co')
    muc.handlePresence(umpirePresence)
    muc.handlePresence(selfPresence)
    await joining
    const got: RoomMessage[] = []
    muc.onMessage(ROOM, (m) => got.push(m))
    muc.handleMessage(
      message(
        `<message xmlns='jabber:client' from='${ROOM}/umpire-1' type='groupchat' id='a'>` +
          `<stanza-id xmlns='urn:xmpp:sid:0' by='${ROOM}' id='1792875234244666'/>` +
          `<addresses xmlns='http://jabber.org/protocol/address'><address type='ofrom' jid='umpire-1@localhost/x'/></addresses>` +
          `<body>history</body><delay xmlns='urn:xmpp:delay' from='${ROOM}' stamp='2026-10-24T20:53:54.244666Z'/></message>`,
      ),
    )
    muc.handleMessage(
      message(
        `<message xmlns='jabber:client' from='${ROOM}/umpire-1' type='groupchat' id='b'>` +
          `<stanza-id xmlns='urn:xmpp:sid:0' by='${ROOM}' id='1792875235611764'/><body>live</body></message>`,
      ),
    )
    // A subject message and a message without a room stanza-id are not RoomMessages.
    muc.handleMessage(
      message(
        `<message xmlns='jabber:client' from='${ROOM}' type='groupchat'><subject/></message>`,
      ),
    )
    muc.handleMessage(
      message(
        `<message xmlns='jabber:client' from='${ROOM}/umpire-1' type='groupchat'><body>x</body></message>`,
      ),
    )
    expect(got).toEqual([
      {
        room: ROOM,
        stanzaId: '1792875234244666',
        nick: 'umpire-1',
        from: 'umpire-1@localhost',
        timestamp: '2026-10-24T20:53:54.244Z',
        body: 'history',
      },
      {
        room: ROOM,
        stanzaId: '1792875235611764',
        nick: 'umpire-1',
        from: 'umpire-1@localhost',
        timestamp: '2026-10-24T20:53:55.611Z',
        body: 'live',
      },
    ])
  })

  it('send resolves on the reflection with its stanza-id, or with the error', async () => {
    const { core, sent } = setup()
    const muc = new XmppMuc(core)
    const joining = muc.join(ROOM, 'blue-co')
    muc.handlePresence(selfPresence)
    await joining
    const sending = muc.send(ROOM, '{"text":"hi"}')
    await Promise.resolve()
    const id = sent[0]?.id ?? ''
    muc.handleMessage(
      message(
        `<message xmlns='jabber:client' from='${ROOM}/blue-co' type='groupchat' id='${id}'>` +
          `<stanza-id xmlns='urn:xmpp:sid:0' by='${ROOM}' id='1792875235611764'/><body>{"text":"hi"}</body></message>`,
      ),
    )
    expect(await sending).toEqual(ok({ stanzaId: '1792875235611764' }))
    const refused = muc.send(ROOM, 'no voice')
    await Promise.resolve()
    const id2 = sent[1]?.id ?? ''
    muc.handleMessage(
      message(
        `<message xmlns='jabber:client' from='${ROOM}' type='error' id='${id2}'><error type='auth'>` +
          `<text xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'>Visitors are not allowed to send messages to all occupants</text>` +
          `<forbidden xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></message>`,
      ),
    )
    expect(await refused).toMatchObject({
      ok: false,
      error: { condition: 'forbidden', type: 'auth' },
    })
  })

  it('refuses an over-cap message before sending it (PLY-53)', async () => {
    const { core, sent } = setup()
    const muc = new XmppMuc(core)
    expect(await muc.send(ROOM, '<'.repeat(17_000))).toMatchObject({
      ok: false,
      error: { condition: 'too-large' },
    })
    expect(sent).toEqual([])
  })
})

describe('XmppPubsub (XEP-0060, XEP-0335) offline', () => {
  it('refuses non-JSON and over-cap payloads before sending', async () => {
    const { core, client } = setup()
    const publish = vi.spyOn(client, 'publish')
    const pubsub = new XmppPubsub(core)
    expect(await pubsub.publish('n', 'current', '{oops')).toEqual(
      err('bad-request', 'the payload is not JSON (XEP-0335)'),
    )
    const big = JSON.stringify({ data: 'A'.repeat(248_000) })
    expect(await pubsub.publish('n', 'current', big)).toMatchObject({
      ok: false,
      error: { condition: 'too-large' },
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it('normalises item, retract and delete notifications', () => {
    const { core } = setup()
    const pubsub = new XmppPubsub(core)
    const events: ItemsEvent[] = []
    pubsub.onItems('objectives:blue', (e) => events.push(e))
    const event = (inner: string) =>
      message(
        `<message xmlns='jabber:client' from='pubsub.localhost' to='${ME}' type='headline'>` +
          `<event xmlns='http://jabber.org/protocol/pubsub#event'>${inner}</event></message>`,
      )
    pubsub.handleMessage(
      event(
        `<items node='objectives:blue'><item id='current' publisher='umpire-1@localhost'>` +
          `<json xmlns='urn:xmpp:json:0'>{&quot;q&quot;:&quot;say \\&quot;hi\\&quot; &lt;b&gt;&quot;}</json></item></items>`,
      ),
    )
    pubsub.handleMessage(event(`<items node='objectives:blue'><retract id='old'/></items>`))
    pubsub.handleMessage(event(`<delete node='objectives:blue'/>`))
    pubsub.handleMessage(event(`<items node='other'><retract id='x'/></items>`))
    expect(events).toEqual([
      {
        node: 'objectives:blue',
        items: [
          { id: 'current', payload: '{"q":"say \\"hi\\" <b>"}', publisher: 'umpire-1@localhost' },
        ],
        retracted: [],
        deleted: false,
      },
      { node: 'objectives:blue', items: [], retracted: ['old'], deleted: false },
      { node: 'objectives:blue', items: [], retracted: [], deleted: true },
    ])
  })
})
