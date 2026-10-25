// Seeds (PLY-21, PLY-34): a design provisioned as the admin tooling would, checked through the
// transport as players see it, and the demo scenario.
import { nodeName } from '@wrx/schemas'
import type { RoomMessage, Session } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { sampleDesign } from '../../schemas/src/fixtures.ts'
import { demoSeed, demoState } from './demo.ts'
import { demoPassword, stateFromDesign } from './seed.ts'
import { MockServer } from './server.ts'
import { MockTransport } from './transport.ts'

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

function demo() {
  const state = demoState()
  const server = new MockServer({ seed: state })
  const transport = new MockTransport(server)
  const endpoint = { websocketUrl: '', domain: state.domain }
  const login = async (id: string): Promise<Session> =>
    unwrap(
      await transport.connect({
        endpoint,
        credentials: { kind: 'password', username: id, password: demoPassword(id) },
      }),
    )
  const room = (id: string) => `${id}@conference.${state.domain}`
  return { state, server, transport, endpoint, login, room }
}

describe('stateFromDesign', () => {
  it('provisions accounts with labelled demo passwords, and nothing for unknown roles', () => {
    const state = unwrap(stateFromDesign({ design: sampleDesign(), domain: 'd.mock' }))
    expect(state.accounts.map((a) => [a.jid, a.password, a.admin, a.demo])).toEqual([
      ['admin@d.mock', 'demo-admin', true, true],
      ['blue-co@d.mock', 'demo-blue-co', false, true],
      ['blue-observer@d.mock', 'demo-blue-observer', false, true],
      ['red-co@d.mock', 'demo-red-co', false, true],
      ['umpire-1@d.mock', 'demo-umpire-1', false, true],
    ])
  })

  it('makes every room NFR-3, with umpires everywhere and observers stored as visitors', () => {
    const state = unwrap(stateFromDesign({ design: sampleDesign(), domain: 'd.mock' }))
    const blueHq = state.rooms.find((r) => r.jid === 'blue-hq@conference.d.mock')
    expect(blueHq?.config).toMatchObject({
      membersOnly: true,
      moderated: true,
      whois: 'anyone',
      public: false,
      archive: true,
    })
    expect(blueHq?.affiliations.map((a) => a.jid).sort()).toEqual([
      'admin@d.mock',
      'blue-co@d.mock',
      'blue-observer@d.mock',
      'umpire-1@d.mock',
    ])
    expect(blueHq?.storedRoles).toEqual([{ jid: 'blue-observer@d.mock', role: 'visitor' }])
    const negotiation = state.rooms.find((r) => r.jid.startsWith('negotiation@'))
    expect(negotiation?.affiliations.map((a) => a.jid).sort()).toEqual([
      'admin@d.mock',
      'blue-co@d.mock',
      'red-co@d.mock',
      'umpire-1@d.mock',
    ])
  })

  it('creates the §3 nodes: open game-setup and theme asset, whitelist for the rest', () => {
    const state = unwrap(stateFromDesign({ design: sampleDesign(), domain: 'd.mock' }))
    const access = Object.fromEntries(state.nodes.map((n) => [n.name, n.config.accessModel]))
    expect(access).toMatchObject({
      'game-setup': 'open',
      'assets:game-logo': 'open',
      announcements: 'whitelist',
      'game-state': 'whitelist',
      'forces:blue': 'whitelist',
      'roles:blue-co': 'whitelist',
      'rooms:negotiation': 'whitelist',
      'objectives:blue': 'whitelist',
    })
    const objectives = state.nodes.find((n) => n.name === nodeName.objectives('blue'))
    expect(objectives?.affiliations).toEqual([
      { jid: 'admin@d.mock', affiliation: 'owner' },
      { jid: 'umpire-1@d.mock', affiliation: 'publisher' },
      { jid: 'blue-co@d.mock', affiliation: 'member' },
      { jid: 'blue-observer@d.mock', affiliation: 'member' },
    ])
    // §3 rule 14: one item per author; the design's text is the admin's.
    expect(objectives?.items.map((i) => i.id)).toEqual(['admin'])
    expect(state.nodes.find((n) => n.name === 'game-state')?.items).toEqual([])
    const role = state.nodes.find((n) => n.name === 'roles:blue-co')?.items[0]?.payload ?? ''
    expect(JSON.parse(role)).not.toHaveProperty('password')
  })

  it('archives history in time order with increasing stanza-ids', () => {
    const state = unwrap(
      stateFromDesign({
        design: sampleDesign(),
        history: [
          { room: 'blue-hq', author: 'blue-co', body: '{"n":2}', at: '2026-10-24T08:00:01.000Z' },
          { room: 'blue-hq', author: 'umpire-1', body: '{"n":1}', at: '2026-10-24T08:00:00.000Z' },
          { room: 'blue-hq', author: 'admin', body: '{"n":3}', at: '2026-10-24T08:00:01.000Z' },
        ],
      }),
    )
    const archive = state.rooms.find((r) => r.jid.startsWith('blue-hq@'))?.archive ?? []
    expect(archive.map((m) => m.body)).toEqual(['{"n":1}', '{"n":2}', '{"n":3}'])
    expect(archive.map((m) => m.stanzaId)).toEqual([
      '1792828800000000',
      '1792828801000000',
      '1792828801000001',
    ])
    expect(state.lastStanzaId).toBe('1792828801000001')
  })

  it('refuses invalid designs and history nobody could have posted', () => {
    expect(stateFromDesign({ design: { format: 'nope' } }).ok).toBe(false)
    const unknownRoom = stateFromDesign({
      design: sampleDesign(),
      history: [{ room: 'nowhere', author: 'blue-co', body: '{}', at: '2026-10-24T08:00:00Z' }],
    })
    expect(unknownRoom).toMatchObject({ ok: false })
    // The observer is read-only in blue-hq; red-co is not in it at all.
    for (const author of ['blue-observer', 'red-co']) {
      const r = stateFromDesign({
        design: sampleDesign(),
        history: [{ room: 'blue-hq', author, body: '{}', at: '2026-10-24T08:00:00Z' }],
      })
      expect(r.ok ? undefined : r.error).toMatch(/cannot post/)
    }
    const passwords = sampleDesign()
    const design = { ...passwords, roles: passwords.roles.map((r) => ({ ...r, password: 'x' })) }
    expect(stateFromDesign({ design }).ok).toBe(false)
  })
})

describe('the demo seed', () => {
  it('logs in with demo passwords; the observer reads history but cannot post', async () => {
    const { login, room } = demo()
    const observer = await login('blue-observer')
    const seen: RoomMessage[] = []
    observer.muc.onMessage(room('blue-hq'), (m) => seen.push(m))
    const joined = unwrap(await observer.muc.join(room('blue-hq'), 'blue-observer'))
    expect(joined.role).toBe('visitor')
    const page = unwrap(await observer.mam.queryRoom(room('blue-hq'), { max: 10 }))
    expect(page.messages.map((m) => m.nick)).toEqual(['blue-co', 'umpire-1', 'blue-co'])
    expect(page.complete).toBe(true)
    const post = await observer.muc.send(room('blue-hq'), '{"text":"hi"}')
    expect(post.ok ? undefined : post.error.condition).toBe('forbidden')
  })

  it('serves game-setup and the logo to anonymous sessions, and nothing else', async () => {
    const { transport, endpoint } = demo()
    const anon = unwrap(await transport.connect({ endpoint, credentials: { kind: 'anonymous' } }))
    const setup = unwrap(await anon.pubsub.getItems('game-setup'))
    expect(JSON.parse(setup[0]?.payload ?? '{}')).toMatchObject({ name: 'Exercise Northern Gate' })
    unwrap(await anon.pubsub.getItems('assets:game-logo'))
    const forces = await anon.pubsub.getItems('forces:blue')
    expect(forces.ok ? undefined : forces.error.condition).toBe('not-allowed')
  })

  it('lets umpires publish objectives under their own item, beside the admin’s', async () => {
    const { login } = demo()
    const umpire = await login('umpire-1')
    const node = nodeName.objectives('red')
    unwrap(await umpire.pubsub.publish(node, 'umpire-1', '{"markdown":"new"}'))
    const ids = unwrap(await umpire.pubsub.getItems(node)).map((i) => i.id)
    expect(ids.sort()).toEqual(['admin', 'umpire-1'])
    const overwrite = await umpire.pubsub.publish(node, 'admin', '{}')
    expect(overwrite.ok ? undefined : overwrite.error.condition).toBe('forbidden')
  })

  it('exports a state that seeds a new server (PLY-34), and resets to its seed', async () => {
    const { server, login, room } = demo()
    const blue = await login('blue-co')
    unwrap(await blue.muc.join(room('negotiation'), 'blue-co'))
    unwrap(await blue.muc.send(room('negotiation'), '{"text":"rehearsal"}'))
    const rehearsed = server.exportState()
    const replay = new MockServer({ seed: rehearsed })
    expect(replay.exportState()).toEqual(rehearsed)
    server.reset()
    expect(server.exportState()).toEqual(demoState())
    expect(demoSeed().history?.length).toBeGreaterThan(0)
  })
})
