import { err, ok } from '@wrx/transport'
import type { Item } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { accessOf } from './access.ts'
import {
  force,
  game,
  harness,
  objectives,
  role,
  room,
  flush,
  nameOf,
  sampleDocuments,
  tid,
} from './fixtures.ts'
import { nodeName } from '@wrx/schemas'
import type { Directory } from '@wrx/schemas'
import { directoryOf } from './documents.ts'

const getItemsCalls = (h: ReturnType<typeof harness>, node: string) =>
  h.session.calls.filter((c) => c.op === 'getItems' && c.args[0] === node).length

describe('session store: ready state and documents (ARC-2, NFR-5)', () => {
  it('starts, loads the documents, then is ready', async () => {
    const h = harness()
    expect(h.store.status()).toEqual({ state: 'starting' })
    expect(h.store.forces().status).toBe('loading')
    expect(await h.store.ready()).toEqual({ state: 'ready' })
    expect(h.store.gameSetup().data?.name).toBe('Exercise Northern Gate')
    expect(h.store.forces().data.map((f) => nameOf(f.id))).toEqual(['blue', 'red', 'white'])
    expect(h.store.roles().data.map((r) => nameOf(r.id))).toEqual([
      'blue-co',
      'red-co',
      'white-1',
      'blue-observer',
      'white-observer',
    ])
    expect(h.store.rooms().data.map((r) => nameOf(r.id))).toEqual([
      'blue-hq',
      'red-hq',
      'negotiation',
    ])
    expect(h.store.forces().status).toBe('ready')
    expect(await h.store.ready()).toEqual({ state: 'ready' })
  })

  it("reads only its own force's objectives (§3 rule 14)", async () => {
    const h = harness()
    await h.store.ready()
    expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Secure the crossing.')
    expect(getItemsCalls(h, nodeName.objectives(tid('red')))).toBe(0)
    expect(h.store.objectives(tid('red')).status).toBe('loading')
  })

  it("reads every force's objectives in the White Force, observers too, and as the admin (PLY-35)", async () => {
    for (const roleId of ['white-1', 'white-observer', 'admin']) {
      const h = harness({ roleId })
      await h.store.ready()
      expect(h.store.objectives(tid('red')).data?.markdown).toBe('Delay Blue.')
      expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Secure the crossing.')
    }
  })

  it('reads only game-setup when anonymous (D20, NFR-21)', async () => {
    const h = harness({ fake: { anonymous: true, jid: 'anon-1@wrx.test/x' } })
    await h.store.ready()
    expect(h.store.identity).toMatchObject({
      anonymous: true,
      loginName: undefined,
      isAdmin: false,
    })
    expect(h.store.gameSetup().data?.designVersion).toBe(1)
    expect(h.session.calls.some((c) => c.op === 'listNodes')).toBe(false)
    expect(h.session.calls.filter((c) => c.op === 'getItems').map((c) => c.args[0])).toEqual([
      'game-setup',
    ])
  })

  it('logs and ignores invalid items, never throwing (NFR-5)', async () => {
    const docs = sampleDocuments()
    docs.set(nodeName.force(tid('red')), ['{not json'])
    docs.set(nodeName.force(tid('green')), [{ ...force(tid('green')), colour: 'green' }])
    docs.set(nodeName.role(tid('mallory')), [role('eve', 'blue')])
    docs.set(nodeName.room(tid('odd')), [{ schemaVersion: 2, id: tid('odd') }])
    const h = harness({ docs })
    await h.store.ready()
    expect(h.store.forces().data.map((f) => nameOf(f.id))).toEqual(['blue', 'white'])
    expect(h.store.roles().data.map((r) => nameOf(r.id))).not.toContain('eve')
    expect(h.store.rooms().data.map((r) => nameOf(r.id))).not.toContain('odd')
    expect(h.warnings.filter((w) => w === 'Ignoring an invalid item')).toHaveLength(4)
    h.session.emitItems({
      node: nodeName.force(tid('blue')),
      items: [{ id: 'current', payload: '[]', publisher: undefined }],
      retracted: [],
      deleted: false,
    })
    expect(h.store.force(tid('blue')).data?.id).toBe(tid('blue'))
  })

  it('applies changes live, keeping unrelated snapshots identical (PLY-28)', async () => {
    const h = harness()
    await h.store.ready()
    const forces = h.store.forces()
    const rooms = h.store.rooms()
    h.publish(nodeName.role(tid('red-co')), role('red-co', 'red', { name: 'Red Commander' }))
    expect(h.store.role(tid('red-co')).data?.name).toBe('Red Commander')
    expect(h.store.authors().data.get('red-co')).toEqual({
      roleId: tid('red-co'),
      loginName: 'red-co',
      name: 'Red Commander',
      forceId: tid('red'),
      forceName: 'RED',
      colour: '#b91c1c',
      deleted: false,
    })
    expect(h.store.forces()).toBe(forces)
    expect(h.store.rooms().data).toBe(rooms.data)
    expect(h.store.forces()).toBe(h.store.forces())
  })

  it('drops retracted items and deleted nodes', async () => {
    const h = harness()
    await h.store.ready()
    h.session.emitItems({
      node: nodeName.room(tid('red-hq')),
      items: [],
      retracted: ['current'],
      deleted: false,
    })
    expect(h.store.rooms().data.map((r) => nameOf(r.id))).toEqual(['blue-hq', 'negotiation'])
    h.session.emitItems({
      node: nodeName.room(tid('negotiation')),
      items: [],
      retracted: [],
      deleted: true,
    })
    expect(h.store.rooms().data.map((r) => nameOf(r.id))).toEqual(['blue-hq'])
    expect(h.store.room(tid('negotiation'))).toMatchObject({
      data: undefined,
      status: 'error',
      error: { code: 'not-found' },
    })
    h.publish(nodeName.room(tid('negotiation')), room('negotiation', []))
    expect(h.store.room(tid('negotiation')).status).toBe('ready')
  })

  it("ends the session as deleted when the role's own document is (PLY-29)", async () => {
    const h = harness()
    await h.store.ready()
    h.session.emitItems({
      node: nodeName.role(tid('blue-co')),
      items: [],
      retracted: [],
      deleted: true,
    })
    await flush()
    expect(h.store.status()).toEqual({ state: 'ended', reason: 'deleted' })
    expect(h.session.calls.some((c) => c.op === 'disconnect')).toBe(true)
    expect(h.session.listenerCount()).toBe(0)
  })

  it('follows a role that moves force (PLY-30)', async () => {
    const h = harness()
    await h.store.ready()
    expect(h.store.me().data.force?.id).toBe(tid('blue'))
    h.publish(nodeName.role(tid('blue-co')), role('blue-co', 'red'))
    await flush()
    expect(h.store.me().data.force?.id).toBe(tid('red'))
    expect(h.store.objectives(tid('red')).data?.markdown).toBe('Delay Blue.')
    expect(h.store.objectives(tid('blue')).status).toBe('loading')
    expect(
      h.session.calls.some(
        (c) => c.op === 'unsubscribe' && c.args[0] === nodeName.objectives(tid('blue')),
      ),
    ).toBe(true)
    expect(h.store.me().data.rooms.map((r) => nameOf(r.room.id))).toEqual(['red-hq', 'negotiation'])
  })

  it('marks a refused node as withdrawn and does not retry (PLY-52)', async () => {
    const h = harness()
    h.refused.set(nodeName.room(tid('red-hq')), 'forbidden')
    await h.store.ready()
    expect(h.store.room(tid('red-hq'))).toMatchObject({
      status: 'error',
      error: { code: 'access-withdrawn' },
    })
    await flush(20)
    expect(getItemsCalls(h, nodeName.room(tid('red-hq')))).toBe(1)
  })

  it('looks for new nodes when the design version changes, and retries failed ones', async () => {
    const h = harness()
    h.refused.set(nodeName.room(tid('red-hq')), 'forbidden')
    await h.store.ready()
    h.docs.set(nodeName.room(tid('new-room')), [
      room('new-room', [{ kind: 'force', id: 'blue', access: 'read' }]),
    ])
    h.refused.delete(nodeName.room(tid('red-hq')))
    h.publish('game-setup', game(2))
    await flush()
    expect(h.store.rooms().data.map((r) => nameOf(r.id))).toContain('new-room')
    expect(h.store.room(tid('red-hq')).status).toBe('ready')
    expect(h.store.me().data.rooms.find((r) => r.room.id === tid('new-room'))?.access).toBe('read')
  })

  it('does not let a stale fetch overwrite a newer notification', async () => {
    const h = harness()
    await h.store.ready()
    let resolve: (items: Item[]) => void = () => undefined
    h.session.stub(
      'pubsub',
      'getItems',
      () =>
        new Promise((r) => {
          resolve = (items) => {
            r(ok(items))
          }
        }),
    )
    const release = h.store.acquire(nodeName.asset(tid('logo')))
    h.publish(nodeName.asset(tid('logo')), {
      schemaVersion: 1,
      id: tid('logo'),
      mimeType: 'image/png',
      size: 3,
      sha256: '1'.repeat(64),
      data: 'AAAA',
    })
    resolve([
      {
        id: 'current',
        payload: JSON.stringify({
          schemaVersion: 1,
          id: 'logo',
          mimeType: 'image/png',
          size: 3,
          sha256: '0'.repeat(64),
          data: 'AAAA',
        }),
        publisher: undefined,
      },
    ])
    await flush()
    expect(h.store.asset(tid('logo')).data?.sha256).toBe('1'.repeat(64))
    release()
  })

  it('reports transport read failures as errors', async () => {
    const h = harness()
    h.refused.set(nodeName.room(tid('red-hq')), 'timeout')
    await h.store.ready()
    expect(h.store.room(tid('red-hq')).error?.code).toBe('transport')
    expect(h.store.room('Not An Id')).toMatchObject({ status: 'error', error: { code: 'invalid' } })
    expect(h.store.document('nothing-here')).toMatchObject({ status: 'loading' })
    const release = h.store.acquire('not-a-wrx-node')
    expect(h.store.document('not-a-wrx-node').error?.code).toBe('invalid')
    release()
  })

  /** A store for `login` over `docs`, with node listing refused (WP 3.4, fix 1). */
  async function unlisted(docs: Map<string, unknown[]>, login = 'blue-co') {
    const h = harness({ docs, roleId: login })
    h.session.stub('pubsub', 'listNodes', () => Promise.resolve(err('forbidden')))
    // harness() already made a store; make a fresh one with the stub in place.
    const { createSessionStore } = await import('./store.ts')
    const store = createSessionStore({ session: h.session, logger: h.logger })
    await store.ready()
    return { h, store }
  }

  function withDirectory(docs: Map<string, unknown[]>, edit = (d: Directory) => d) {
    const of = (prefix: string) =>
      [...docs.entries()].filter(([n]) => n.startsWith(prefix)).map(([, v]) => v[0])
    const directory = directoryOf({
      forces: of('forces:') as { id: string }[],
      roles: of('roles:') as { id: string; loginName: string }[],
      rooms: of('rooms:') as { id: string }[],
    })
    docs.set('directory', [edit(directory)])
    return docs
  }

  it('starts when nodes cannot be listed and no directory exists, with nothing to show', async () => {
    // A server published before the directory: the role is found among listed role documents
    // only, so with listing refused there is none to find. It starts, failing closed.
    const { h, store } = await unlisted(sampleDocuments())
    expect(store.me().data.role).toBeUndefined()
    expect(store.rooms().data).toEqual([])
    expect(store.gameSetup().data?.designVersion).toBe(1)
    expect(h.warnings).toContain('Could not list nodes')
  })

  it('finds its own role, force, objectives and rooms from the directory, without listing (§3 rule 1)', async () => {
    const { h, store } = await unlisted(withDirectory(sampleDocuments()))
    const me = store.me().data
    expect(me.role?.id).toBe(tid('blue-co'))
    expect(me.force?.id).toBe(tid('blue'))
    expect(me.rooms.map((r) => nameOf(r.room.id))).toEqual(['blue-hq', 'negotiation'])
    expect(store.objectives(tid('blue')).data?.markdown).toBe('Secure the crossing.')
    // Its own force's objectives only: another force's node is never asked for.
    expect(getItemsCalls(h, nodeName.objectives(tid('red')))).toBe(0)
    expect(h.warnings).toContain('Could not list nodes')
  })

  it('an umpire finds every force’s objectives from the directory, without listing', async () => {
    const { store } = await unlisted(withDirectory(sampleDocuments()), 'white-1')
    expect(store.me().data.isUmpire).toBe(true)
    expect(store.objectives(tid('red')).data?.markdown).toBe('Delay Blue.')
    expect(store.objectives(tid('blue')).data?.markdown).toBe('Secure the crossing.')
  })

  it('fails closed when the directory points at a role document with another login name', async () => {
    // The directory is a pointer: the role document decides. Blue CO's login is pointed at Red
    // CO's document, and Blue CO's own document is not in the directory.
    const docs = withDirectory(sampleDocuments(), (d) => ({
      ...d,
      roles: d.roles
        .filter((r) => r.loginName !== 'blue-co')
        .concat({ id: tid('red-co'), loginName: 'blue-co' }),
    }))
    const { store } = await unlisted(docs)
    expect(store.me().data.role).toBeUndefined()
    expect(store.me().data.rooms).toEqual([])
  })

  it('takes the role the directory names when two documents claim the login name', async () => {
    const docs = sampleDocuments()
    const impostor = role('blue-co', 'red', { id: '00000000-0000-4000-8000-000000000001' })
    docs.set(nodeName.role(impostor.id), [impostor])
    // Listed, and first in display order: without the directory the impostor would be taken.
    const before = harness({ docs: new Map(docs) })
    await before.store.ready()
    expect(before.store.me().data.role?.id).toBe(impostor.id)
    withDirectory(docs, (d) => ({ ...d, roles: d.roles.filter((r) => r.id !== impostor.id) }))
    const h = harness({ docs })
    await h.store.ready()
    expect(h.store.me().data.role?.id).toBe(tid('blue-co'))
    expect(h.store.me().data.force?.id).toBe(tid('blue'))
  })

  it('ignores an invalid directory and still uses the listing', async () => {
    const docs = sampleDocuments()
    docs.set('directory', [{ schemaVersion: 1, roles: 'not a list' }])
    const h = harness({ docs })
    await h.store.ready()
    expect(h.store.me().data.role?.id).toBe(tid('blue-co'))
    expect(h.warnings).toContain('Ignoring an invalid item')
  })

  it('orders announcements oldest first and marks live arrivals (PLY-38)', async () => {
    const docs = sampleDocuments()
    docs.set('announcements', [
      { schemaVersion: 1, text: 'Second', postedAt: '2026-10-24T11:00:00Z' },
      { schemaVersion: 1, text: 'First', postedAt: '2026-10-24T10:00:00Z' },
    ])
    const h = harness({ docs })
    await h.store.ready()
    expect(h.store.announcements().data.map((a) => a.announcement.text)).toEqual([
      'First',
      'Second',
    ])
    h.session.emitItems({
      node: 'announcements',
      items: [
        {
          id: 'n3',
          payload: JSON.stringify({
            schemaVersion: 1,
            text: 'Third',
            postedAt: '2026-10-24T12:00:00Z',
          }),
          publisher: 'admin@wrx.test',
        },
      ],
      retracted: [],
      deleted: false,
    })
    const list = h.store.announcements().data
    expect(list.map((a) => [a.announcement.text, a.live])).toEqual([
      ['First', false],
      ['Second', false],
      ['Third', true],
    ])
  })

  it('derives effective access and the role view (§3 rule 4, PLY-4)', async () => {
    const h = harness({ roleId: 'blue-observer' })
    await h.store.ready()
    const matrix = h.store.access().data
    expect(accessOf(matrix, tid('blue-hq'), tid('blue-observer'))).toBe('read')
    expect(accessOf(matrix, tid('red-hq'), tid('white-1'))).toBe('write')
    const me = h.store.me().data
    expect(me).toMatchObject({ isObserver: true, isUmpire: false })
    expect(me.rooms.map((r) => [nameOf(r.room.id), r.access])).toEqual([['blue-hq', 'read']])
    expect(h.store.me()).toBe(h.store.me())
    const admin = harness({ roleId: 'admin' })
    await admin.store.ready()
    expect(admin.store.me().data.rooms.map((r) => [nameOf(r.room.id), r.access])).toEqual([
      ['blue-hq', 'write'],
      ['red-hq', 'write'],
      ['negotiation', 'write'],
    ])
  })

  it('makes the admin the umpire, in the White Force (glossary, D8, SC-5)', async () => {
    const admin = harness({ roleId: 'admin' })
    await admin.store.ready()
    const me = admin.store.me().data
    expect(me).toMatchObject({ role: undefined, isUmpire: true, canEditObjectives: true })
    expect(me.force?.id).toBe(tid('white'))
    expect(me.identity.isAdmin).toBe(true)
  })

  it('reads every room as a White Force observer with no assigned rooms (§3 rule 4)', async () => {
    const h = harness({ roleId: 'white-observer' })
    await h.store.ready()
    const me = h.store.me().data
    expect(me).toMatchObject({ isObserver: true, isUmpire: true, canEditObjectives: false })
    expect(me.rooms.map((r) => [nameOf(r.room.id), r.access])).toEqual([
      ['blue-hq', 'read'],
      ['red-hq', 'read'],
      ['negotiation', 'read'],
    ])
    // A White Force role that is not an observer edits every force's objectives (PLY-35, D21).
    const white = harness({ roleId: 'white-1' })
    await white.store.ready()
    expect(white.store.me().data.canEditObjectives).toBe(true)
    expect(white.store.objectives(tid('red')).data?.markdown).toBe('Delay Blue.')
    // Other roles do not.
    const blue = harness()
    await blue.store.ready()
    expect(blue.store.me().data.canEditObjectives).toBe(false)
  })
})

describe('session store: reference counting (ARC-2)', () => {
  it('subscribes once, and releases after the last holder', async () => {
    const h = harness()
    await h.store.ready()
    const baseline = h.session.listenerCount()
    const a = h.store.acquire(nodeName.asset(tid('logo')))
    const b = h.store.acquire(nodeName.asset(tid('logo')))
    expect(h.session.listenerCount()).toBe(baseline + 1)
    a()
    a()
    await flush()
    expect(h.session.listenerCount()).toBe(baseline + 1)
    b()
    await flush()
    expect(h.session.listenerCount()).toBe(baseline)
    expect(getItemsCalls(h, nodeName.asset(tid('logo')))).toBe(1)
  })

  it('absorbs a release followed at once by an acquire (StrictMode)', async () => {
    const h = harness()
    await h.store.ready()
    h.store.acquire(nodeName.asset(tid('logo')))()
    const again = h.store.acquire(nodeName.asset(tid('logo')))
    await flush()
    expect(getItemsCalls(h, nodeName.asset(tid('logo')))).toBe(1)
    expect(
      h.session.calls.some(
        (c) => c.op === 'unsubscribe' && c.args[0] === nodeName.asset(tid('logo')),
      ),
    ).toBe(false)
    again()
    await flush()
    expect(
      h.session.calls.some(
        (c) => c.op === 'unsubscribe' && c.args[0] === nodeName.asset(tid('logo')),
      ),
    ).toBe(true)
  })

  it('notifies subscribers and stops after unsubscribe', async () => {
    const h = harness()
    await h.store.ready()
    let calls = 0
    const off = h.store.subscribe(() => calls++)
    h.publish(nodeName.force(tid('red')), force('red', { name: 'Reds' }))
    off()
    h.publish(nodeName.force(tid('red')), force('red', { name: 'Redder' }))
    expect(calls).toBe(1)
  })
})

describe('session store: connection (PLY-2, PLY-50)', () => {
  it('reports reconnecting and comes back ready', async () => {
    const h = harness()
    await h.store.ready()
    h.session.emitStatus({ state: 'reconnecting', attempt: 2 })
    expect(h.store.status()).toEqual({ state: 'reconnecting', attempt: 2 })
    expect(h.store.forces().status).toBe('ready')
    h.session.emitRecovered('resumed')
    expect(h.store.status()).toEqual({ state: 'ready' })
  })

  it('refetches documents after a reconnection', async () => {
    const h = harness()
    await h.store.ready()
    h.docs.set(nodeName.force(tid('red')), [force('red', { name: 'Missed while offline' })])
    h.session.emitRecovered('reconnected')
    await flush()
    expect(h.store.force(tid('red')).data?.name).toBe('Missed while offline')
  })

  it('ends with the transport reason and drops everything (PLY-50)', async () => {
    const h = harness()
    await h.store.ready()
    h.session.emitStatus({ state: 'ended', reason: 'session-ended', text: 'bye' })
    expect(h.store.status()).toEqual({ state: 'ended', reason: 'session-ended', text: 'bye' })
    expect(h.store.forces()).toMatchObject({ data: [], status: 'error' })
    expect(h.session.listenerCount()).toBe(0)
    expect(h.store.acquire(nodeName.force(tid('red')))).toBeTypeOf('function')
    expect(h.session.listenerCount()).toBe(0)
    expect(await h.store.ready()).toMatchObject({ state: 'ended' })
  })

  it('is ended at once over a session that has already ended', async () => {
    const h = harness()
    h.session.emitStatus({ state: 'ended', reason: 'account-removed' })
    const { createSessionStore } = await import('./store.ts')
    const store = createSessionStore({ session: h.session, logger: h.logger })
    expect(store.status()).toEqual({ state: 'ended', reason: 'account-removed' })
  })

  it('becomes ready only after the first load, even if it reconnects meanwhile', async () => {
    const h = harness()
    h.session.emitStatus({ state: 'reconnecting', attempt: 1 })
    h.session.emitStatus({ state: 'online' })
    expect(h.store.status().state).toBe('starting')
    expect(await h.store.ready()).toEqual({ state: 'ready' })
  })
})

describe('session store: operations', () => {
  it('publishes each save of objectives as a new item, the admin’s and a White Force editor’s (PLY-35, §3 rule 14)', async () => {
    let n = 0
    const h = harness({ roleId: 'admin', newId: () => `n${++n}` })
    await h.store.ready()
    expect(await h.store.publishObjectives(tid('red'), '1. Hold the line.')).toEqual(ok(undefined))
    expect(await h.store.publishObjectives(tid('red'), '1. Hold the line.\n2. Wait.')).toEqual(
      ok(undefined),
    )
    const calls = h.session.calls.filter((c) => c.op === 'publish')
    // Never a re-published id: the server orders items by first publish (spike check S15).
    expect(calls.map((c) => c.args.slice(0, 2))).toEqual([
      [nodeName.objectives(tid('red')), 'admin-n1'],
      [nodeName.objectives(tid('red')), 'admin-n2'],
    ])
    expect(JSON.parse(String(calls[0]?.args[2]))).toMatchObject({
      schemaVersion: 1,
      forceId: tid('red'),
      markdown: '1. Hold the line.',
    })
    const white = harness({ roleId: 'white-1', newId: () => 'w1' })
    await white.store.ready()
    expect(await white.store.publishObjectives(tid('blue'), 'Umpire edit')).toEqual(ok(undefined))
    expect(white.session.calls.find((c) => c.op === 'publish')?.args.slice(0, 2)).toEqual([
      nodeName.objectives(tid('blue')),
      'white-1-w1',
    ])
  })

  describe('§3 rule 14, F11: the newest objectives by server order, never by the author’s clock', () => {
    const NOW = '2026-10-25T09:00:00.000Z'
    const item = (id: string, markdown: string, updatedAt: string) => ({
      id,
      payload: JSON.stringify(objectives('blue', markdown, updatedAt)),
      publisher: undefined,
    })
    const live = (
      h: ReturnType<typeof harness>,
      id: string,
      markdown: string,
      updatedAt: string,
      retracted: readonly string[] = [],
    ) => {
      h.session.emitItems({
        node: nodeName.objectives(tid('blue')),
        items: [item(id, markdown, updatedAt)],
        retracted,
        deleted: false,
      })
    }

    it('shows the last item of a fetch, whatever the stamps say', async () => {
      // Two authors' items, in the server's order (first publish, oldest first): the umpire's
      // edit is newer though its author's clock was behind.
      const docs = sampleDocuments()
      docs.set(nodeName.objectives(tid('blue')), [
        objectives('blue', 'Admin original', '2026-10-24T10:00:00.000Z'),
        objectives('blue', 'Umpire edit', '2026-10-20T11:00:00.000Z'),
      ])
      const h = harness({ docs, now: () => NOW })
      await h.store.ready()
      expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Umpire edit')
    })

    it('a live item replaces the fetched one, and a retract shows the one before', async () => {
      const docs = sampleDocuments()
      docs.set(nodeName.objectives(tid('blue')), [
        objectives('blue', 'Admin original', '2026-10-24T10:00:00.000Z'),
        objectives('blue', 'Umpire edit', '2026-10-24T11:00:00.000Z'),
      ])
      const h = harness({ docs, now: () => NOW })
      await h.store.ready()
      // The admin's next save; the server trims its earlier item and says so.
      live(h, 'admin-2', 'Admin revision', '2026-10-24T09:00:00.000Z', ['admin-seed'])
      expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Admin revision')
      // The owner retracts the admin's item (or a role leaving the White Force has its own
      // retracted): the umpire's edit shows again.
      h.session.emitItems({
        node: nodeName.objectives(tid('blue')),
        items: [],
        retracted: ['admin-2'],
        deleted: false,
      })
      expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Umpire edit')
    })

    it('a fetched copy stamped in the future does not pin itself above a live edit', async () => {
      const docs = sampleDocuments()
      docs.set(nodeName.objectives(tid('blue')), [
        objectives('blue', 'Read at login', '2030-01-01T00:00:00.000Z'),
      ])
      const h = harness({ docs, now: () => NOW })
      await h.store.ready()
      expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Read at login')
      // The admin's clock was a day slow when it published this edit.
      live(h, 'admin-live', 'Live edit', '2026-10-24T09:00:00.000Z')
      expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Live edit')
    })

    it('a fetch that answers after a live edit does not overwrite it', async () => {
      const h = harness({ now: () => NOW })
      await h.store.ready()
      let answer: (items: readonly Item[]) => void = () => undefined
      h.session.stub(
        'pubsub',
        'getItems',
        () =>
          new Promise((resolve) => {
            answer = (items) => {
              resolve(ok(items))
            }
          }),
      )
      const refreshing = h.store.refresh()
      await flush()
      live(h, 'white-1-x', 'Live edit', '2026-10-24T09:00:00.000Z')
      answer([item('admin-old', 'Stale copy', '2030-01-01T00:00:00.000Z')])
      await refreshing
      await flush()
      expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Live edit')
    })

    it('between live edits, arrival order decides, not stamps', async () => {
      const h = harness({ now: () => NOW })
      await h.store.ready()
      live(h, 'admin-a', 'First', '2026-10-25T08:59:00.000Z')
      live(h, 'white-1-b', 'Second, clock behind', '2026-10-20T00:00:00.000Z')
      expect(h.store.objectives(tid('blue')).data?.markdown).toBe('Second, clock behind')
    })
  })

  it('refuses objectives from a player and a White Force observer, and invalid ones', async () => {
    const h = harness()
    await h.store.ready()
    expect(await h.store.publishObjectives(tid('blue'), 'x')).toMatchObject({
      ok: false,
      error: { code: 'not-permitted' },
    })
    expect(h.session.calls.some((c) => c.op === 'publish')).toBe(false)
    const observer = harness({ roleId: 'white-observer' })
    await observer.store.ready()
    expect(await observer.store.publishObjectives(tid('blue'), 'x')).toMatchObject({
      ok: false,
      error: { code: 'not-permitted' },
    })
    expect(observer.session.calls.some((c) => c.op === 'publish')).toBe(false)
    const admin = harness({ roleId: 'admin' })
    await admin.store.ready()
    expect((await admin.store.publishObjectives('Bad Id', 'x')).ok).toBe(false)
    expect(await admin.store.publishObjectives(tid('blue'), 'x'.repeat(50_001))).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
    admin.session.stub('pubsub', 'publish', () => Promise.resolve(err('forbidden')))
    expect(await admin.store.publishObjectives(tid('blue'), 'x')).toMatchObject({
      ok: false,
      error: { code: 'not-permitted', cause: { condition: 'forbidden' } },
    })
  })

  it('posts announcements as the admin only (PLY-37)', async () => {
    const h = harness({ roleId: 'admin', now: () => '2026-10-24T12:00:00.000Z', newId: () => 'a1' })
    await h.store.ready()
    expect(h.store.identity.isAdmin).toBe(true)
    expect(await h.store.postAnnouncement('Lunch at 12:30')).toEqual(ok(undefined))
    const call = h.session.calls.find((c) => c.op === 'publish')
    expect(call?.args.slice(0, 2)).toEqual(['announcements', 'a1'])
    expect(JSON.parse(String(call?.args[2]))).toEqual({
      schemaVersion: 1,
      text: 'Lunch at 12:30',
      postedAt: '2026-10-24T12:00:00.000Z',
    })
    expect((await h.store.postAnnouncement('   ')).ok).toBe(false)
    h.session.stub('pubsub', 'publish', () => Promise.resolve(err('too-large')))
    expect(await h.store.postAnnouncement('x')).toMatchObject({ error: { code: 'too-large' } })
    const player = harness()
    await player.store.ready()
    expect(await player.store.postAnnouncement('hi')).toMatchObject({
      error: { code: 'not-permitted' },
    })
  })

  it('logs out: leaves rooms, releases subscriptions, clears data, disconnects (PLY-3)', async () => {
    const h = harness()
    await h.store.ready()
    const watch = await h.store.watchRoom(tid('blue-hq'))
    expect(watch.ok).toBe(true)
    expect(await h.store.logout()).toEqual(ok(undefined))
    const ops = h.session.calls.map((c) => c.op)
    expect(ops).toContain('leave')
    expect(ops.filter((op) => op === 'unsubscribe').length).toBeGreaterThan(5)
    expect(ops[ops.length - 1]).toBe('disconnect')
    expect(h.store.status()).toEqual({ state: 'ended', reason: 'logout' })
    expect(h.session.listenerCount()).toBe(0)
    expect(h.store.forces().data).toEqual([])
    expect(h.store.roomView(tid('blue-hq')).data).toBeUndefined()
    expect(await h.store.logout()).toEqual(ok(undefined))
    expect(await h.store.publishObjectives(tid('blue'), 'x')).toMatchObject({
      error: { code: 'session-ended' },
    })
    expect(await h.store.postAnnouncement('x')).toMatchObject({ error: { code: 'session-ended' } })
    expect(await h.store.watchRoom(tid('blue-hq'))).toMatchObject({
      error: { code: 'session-ended' },
    })
    expect(await h.store.loadOlder(tid('blue-hq'))).toMatchObject({
      error: { code: 'session-ended' },
    })
    expect(await h.store.rejoinRoom(tid('blue-hq'))).toMatchObject({
      error: { code: 'session-ended' },
    })
    expect(await h.store.sendMessage(tid('blue-hq'), 'hi')).toMatchObject({
      error: { code: 'session-ended', unsentText: 'hi' },
    })
    await h.store.refresh()
    if (watch.ok) watch.value.release()
    await flush()
  })

  it('gives each pane its own store with nothing shared (D15)', async () => {
    const a = harness()
    const b = harness({ roleId: 'red-co' })
    await Promise.all([a.store.ready(), b.store.ready()])
    a.publish(nodeName.force(tid('blue')), force('blue', { name: 'Only in A' }))
    expect(a.store.force(tid('blue')).data?.name).toBe('Only in A')
    expect(b.store.force(tid('blue')).data?.name).toBe('BLUE')
    await a.store.logout()
    expect(b.store.status()).toEqual({ state: 'ready' })
  })
})

describe('session store: login names and deleted roles (§3 rules 1 and 6)', () => {
  const retired = {
    schemaVersion: 1,
    id: tid('old-co'),
    kind: 'role',
    name: 'Old CO',
    loginName: 'old-co',
    colour: '#b91c1c',
    deletedAt: '2026-11-01T10:00:00.000Z',
  }

  it('finds its own role by login name, not by id', async () => {
    const docs = sampleDocuments()
    // A role whose login name is not its id's short name.
    docs.set(nodeName.role(tid('blue-co')), [role('blue-co', 'blue', { loginName: 'bluecmd' })])
    const h = harness({ docs, roleId: 'bluecmd' })
    await h.store.ready()
    expect(h.store.identity.loginName).toBe('bluecmd')
    expect(h.store.me().data.role?.id).toBe(tid('blue-co'))
    expect(h.store.me().data.rooms.map((r) => nameOf(r.room.id))).toEqual([
      'blue-hq',
      'negotiation',
    ])
  })

  it('resolves authors by login name, and a deleted role from its `retired` record', async () => {
    const docs = sampleDocuments()
    docs.set('retired', [retired])
    const h = harness({ docs })
    await h.store.ready()
    expect(h.store.retired().data).toEqual([retired])
    expect(h.store.authors().data.get('old-co')).toEqual({
      roleId: tid('old-co'),
      loginName: 'old-co',
      name: 'Old CO',
      forceId: '',
      forceName: undefined,
      colour: '#b91c1c',
      deleted: true,
    })
    expect(h.store.authors().data.get('red-co')).toMatchObject({ deleted: false, name: 'red-co' })
  })

  it('never reads `retired` for access: a record with a room’s participant id grants nothing', async () => {
    const docs = sampleDocuments()
    docs.set('retired', [{ ...retired, id: tid('blue-co'), loginName: 'blue-co' }])
    const h = harness({ docs, roleId: 'old-co' })
    await h.store.ready()
    expect(h.store.me().data.role).toBeUndefined()
    expect(h.store.me().data.rooms).toEqual([])
  })
})
