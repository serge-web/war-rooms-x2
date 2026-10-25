import { err, ok } from '@wrx/transport'
import type { Item } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import { accessOf } from './access.ts'
import { force, game, harness, objectives, role, room, flush, sampleDocuments } from './fixtures.ts'

const getItemsCalls = (h: ReturnType<typeof harness>, node: string) =>
  h.session.calls.filter((c) => c.op === 'getItems' && c.args[0] === node).length

describe('session store: ready state and documents (ARC-2, NFR-5)', () => {
  it('starts, loads the documents, then is ready', async () => {
    const h = harness()
    expect(h.store.status()).toEqual({ state: 'starting' })
    expect(h.store.forces().status).toBe('loading')
    expect(await h.store.ready()).toEqual({ state: 'ready' })
    expect(h.store.gameSetup().data?.name).toBe('Exercise Northern Gate')
    expect(h.store.forces().data.map((f) => f.id)).toEqual(['blue', 'red', 'white'])
    expect(h.store.roles().data.map((r) => r.id)).toEqual([
      'blue-co',
      'red-co',
      'white-1',
      'blue-observer',
      'white-observer',
    ])
    expect(h.store.rooms().data.map((r) => r.id)).toEqual(['blue-hq', 'red-hq', 'negotiation'])
    expect(h.store.forces().status).toBe('ready')
    expect(await h.store.ready()).toEqual({ state: 'ready' })
  })

  it("reads only its own force's objectives (§3 rule 14)", async () => {
    const h = harness()
    await h.store.ready()
    expect(h.store.objectives('blue').data?.markdown).toBe('Secure the crossing.')
    expect(getItemsCalls(h, 'objectives:red')).toBe(0)
    expect(h.store.objectives('red').status).toBe('loading')
  })

  it("reads every force's objectives in the White Force, observers too, and as the admin (PLY-35)", async () => {
    for (const roleId of ['white-1', 'white-observer', 'admin']) {
      const h = harness({ roleId })
      await h.store.ready()
      expect(h.store.objectives('red').data?.markdown).toBe('Delay Blue.')
      expect(h.store.objectives('blue').data?.markdown).toBe('Secure the crossing.')
    }
  })

  it('reads only game-setup when anonymous (D20, NFR-21)', async () => {
    const h = harness({ fake: { anonymous: true, jid: 'anon-1@wrx.test/x' } })
    await h.store.ready()
    expect(h.store.identity).toMatchObject({ anonymous: true, roleId: undefined, isAdmin: false })
    expect(h.store.gameSetup().data?.designVersion).toBe(1)
    expect(h.session.calls.some((c) => c.op === 'listNodes')).toBe(false)
    expect(h.session.calls.filter((c) => c.op === 'getItems').map((c) => c.args[0])).toEqual([
      'game-setup',
    ])
  })

  it('logs and ignores invalid items, never throwing (NFR-5)', async () => {
    const docs = sampleDocuments()
    docs.set('forces:red', ['{not json'])
    docs.set('forces:green', [{ ...force('green'), colour: 'green' }])
    docs.set('roles:mallory', [role('eve', 'blue')])
    docs.set('rooms:odd', [{ schemaVersion: 2, id: 'odd' }])
    const h = harness({ docs })
    await h.store.ready()
    expect(h.store.forces().data.map((f) => f.id)).toEqual(['blue', 'white'])
    expect(h.store.roles().data.map((r) => r.id)).not.toContain('eve')
    expect(h.store.rooms().data.map((r) => r.id)).not.toContain('odd')
    expect(h.warnings.filter((w) => w === 'Ignoring an invalid item')).toHaveLength(4)
    h.session.emitItems({
      node: 'forces:blue',
      items: [{ id: 'current', payload: '[]', publisher: undefined }],
      retracted: [],
      deleted: false,
    })
    expect(h.store.force('blue').data?.id).toBe('blue')
  })

  it('applies changes live, keeping unrelated snapshots identical (PLY-28)', async () => {
    const h = harness()
    await h.store.ready()
    const forces = h.store.forces()
    const rooms = h.store.rooms()
    h.publish('roles:red-co', role('red-co', 'red', { name: 'Red Commander' }))
    expect(h.store.role('red-co').data?.name).toBe('Red Commander')
    expect(h.store.authors().data.get('red-co')).toEqual({
      roleId: 'red-co',
      name: 'Red Commander',
      forceId: 'red',
      forceName: 'RED',
      colour: '#b91c1c',
    })
    expect(h.store.forces()).toBe(forces)
    expect(h.store.rooms().data).toBe(rooms.data)
    expect(h.store.forces()).toBe(h.store.forces())
  })

  it('drops retracted items and deleted nodes', async () => {
    const h = harness()
    await h.store.ready()
    h.session.emitItems({ node: 'rooms:red-hq', items: [], retracted: ['current'], deleted: false })
    expect(h.store.rooms().data.map((r) => r.id)).toEqual(['blue-hq', 'negotiation'])
    h.session.emitItems({ node: 'rooms:negotiation', items: [], retracted: [], deleted: true })
    expect(h.store.rooms().data.map((r) => r.id)).toEqual(['blue-hq'])
    expect(h.store.room('negotiation')).toMatchObject({
      data: undefined,
      status: 'error',
      error: { code: 'not-found' },
    })
    h.publish('rooms:negotiation', room('negotiation', []))
    expect(h.store.room('negotiation').status).toBe('ready')
  })

  it("ends the session as deleted when the role's own document is (PLY-29)", async () => {
    const h = harness()
    await h.store.ready()
    h.session.emitItems({ node: 'roles:blue-co', items: [], retracted: [], deleted: true })
    await flush()
    expect(h.store.status()).toEqual({ state: 'ended', reason: 'deleted' })
    expect(h.session.calls.some((c) => c.op === 'disconnect')).toBe(true)
    expect(h.session.listenerCount()).toBe(0)
  })

  it('follows a role that moves force (PLY-30)', async () => {
    const h = harness()
    await h.store.ready()
    expect(h.store.me().data.force?.id).toBe('blue')
    h.publish('roles:blue-co', role('blue-co', 'red'))
    await flush()
    expect(h.store.me().data.force?.id).toBe('red')
    expect(h.store.objectives('red').data?.markdown).toBe('Delay Blue.')
    expect(h.store.objectives('blue').status).toBe('loading')
    expect(
      h.session.calls.some((c) => c.op === 'unsubscribe' && c.args[0] === 'objectives:blue'),
    ).toBe(true)
    expect(h.store.me().data.rooms.map((r) => r.room.id)).toEqual(['red-hq', 'negotiation'])
  })

  it('marks a refused node as withdrawn and does not retry (PLY-52)', async () => {
    const h = harness()
    h.refused.set('rooms:red-hq', 'forbidden')
    await h.store.ready()
    expect(h.store.room('red-hq')).toMatchObject({
      status: 'error',
      error: { code: 'access-withdrawn' },
    })
    await flush(20)
    expect(getItemsCalls(h, 'rooms:red-hq')).toBe(1)
  })

  it('looks for new nodes when the design version changes, and retries failed ones', async () => {
    const h = harness()
    h.refused.set('rooms:red-hq', 'forbidden')
    await h.store.ready()
    h.docs.set('rooms:new-room', [
      room('new-room', [{ kind: 'force', id: 'blue', access: 'read' }]),
    ])
    h.refused.delete('rooms:red-hq')
    h.publish('game-setup', game(2))
    await flush()
    expect(h.store.rooms().data.map((r) => r.id)).toContain('new-room')
    expect(h.store.room('red-hq').status).toBe('ready')
    expect(h.store.me().data.rooms.find((r) => r.room.id === 'new-room')?.access).toBe('read')
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
    const release = h.store.acquire('assets:logo')
    h.publish('assets:logo', {
      schemaVersion: 1,
      id: 'logo',
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
    expect(h.store.asset('logo').data?.sha256).toBe('1'.repeat(64))
    release()
  })

  it('reports transport read failures as errors', async () => {
    const h = harness()
    h.refused.set('rooms:red-hq', 'timeout')
    await h.store.ready()
    expect(h.store.room('red-hq').error?.code).toBe('transport')
    expect(h.store.room('Not An Id')).toMatchObject({ status: 'error', error: { code: 'invalid' } })
    expect(h.store.document('nothing-here')).toMatchObject({ status: 'loading' })
    const release = h.store.acquire('not-a-wrx-node')
    expect(h.store.document('not-a-wrx-node').error?.code).toBe('invalid')
    release()
  })

  it('starts even when nodes cannot be listed', async () => {
    const h = harness()
    h.session.stub('pubsub', 'listNodes', () => Promise.resolve(err('forbidden')))
    // The store was already created by harness(); make a fresh one with the stub in place.
    const { createSessionStore } = await import('./store.ts')
    const store = createSessionStore({ session: h.session, logger: h.logger })
    await store.ready()
    expect(store.me().data.role?.id).toBe('blue-co')
    expect(store.me().data.force?.id).toBe('blue')
    expect(store.rooms().data).toEqual([])
    expect(h.warnings).toContain('Could not list nodes')
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
    expect(accessOf(matrix, 'blue-hq', 'blue-observer')).toBe('read')
    expect(accessOf(matrix, 'red-hq', 'white-1')).toBe('write')
    const me = h.store.me().data
    expect(me).toMatchObject({ isObserver: true, isUmpire: false })
    expect(me.rooms.map((r) => [r.room.id, r.access])).toEqual([['blue-hq', 'read']])
    expect(h.store.me()).toBe(h.store.me())
    const admin = harness({ roleId: 'admin' })
    await admin.store.ready()
    expect(admin.store.me().data.rooms.map((r) => [r.room.id, r.access])).toEqual([
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
    expect(me.force?.id).toBe('white')
    expect(me.identity.isAdmin).toBe(true)
  })

  it('reads every room as a White Force observer with no assigned rooms (§3 rule 4)', async () => {
    const h = harness({ roleId: 'white-observer' })
    await h.store.ready()
    const me = h.store.me().data
    expect(me).toMatchObject({ isObserver: true, isUmpire: true, canEditObjectives: false })
    expect(me.rooms.map((r) => [r.room.id, r.access])).toEqual([
      ['blue-hq', 'read'],
      ['red-hq', 'read'],
      ['negotiation', 'read'],
    ])
    const white = harness({ roleId: 'white-1' })
    await white.store.ready()
    expect(white.store.me().data.canEditObjectives).toBe(true)
  })
})

describe('session store: reference counting (ARC-2)', () => {
  it('subscribes once, and releases after the last holder', async () => {
    const h = harness()
    await h.store.ready()
    const baseline = h.session.listenerCount()
    const a = h.store.acquire('assets:logo')
    const b = h.store.acquire('assets:logo')
    expect(h.session.listenerCount()).toBe(baseline + 1)
    a()
    a()
    await flush()
    expect(h.session.listenerCount()).toBe(baseline + 1)
    b()
    await flush()
    expect(h.session.listenerCount()).toBe(baseline)
    expect(getItemsCalls(h, 'assets:logo')).toBe(1)
  })

  it('absorbs a release followed at once by an acquire (StrictMode)', async () => {
    const h = harness()
    await h.store.ready()
    h.store.acquire('assets:logo')()
    const again = h.store.acquire('assets:logo')
    await flush()
    expect(getItemsCalls(h, 'assets:logo')).toBe(1)
    expect(h.session.calls.some((c) => c.op === 'unsubscribe' && c.args[0] === 'assets:logo')).toBe(
      false,
    )
    again()
    await flush()
    expect(h.session.calls.some((c) => c.op === 'unsubscribe' && c.args[0] === 'assets:logo')).toBe(
      true,
    )
  })

  it('notifies subscribers and stops after unsubscribe', async () => {
    const h = harness()
    await h.store.ready()
    let calls = 0
    const off = h.store.subscribe(() => calls++)
    h.publish('forces:red', force('red', { name: 'Reds' }))
    off()
    h.publish('forces:red', force('red', { name: 'Redder' }))
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
    h.docs.set('forces:red', [force('red', { name: 'Missed while offline' })])
    h.session.emitRecovered('reconnected')
    await flush()
    expect(h.store.force('red').data?.name).toBe('Missed while offline')
  })

  it('ends with the transport reason and drops everything (PLY-50)', async () => {
    const h = harness()
    await h.store.ready()
    h.session.emitStatus({ state: 'ended', reason: 'session-ended', text: 'bye' })
    expect(h.store.status()).toEqual({ state: 'ended', reason: 'session-ended', text: 'bye' })
    expect(h.store.forces()).toMatchObject({ data: [], status: 'error' })
    expect(h.session.listenerCount()).toBe(0)
    expect(h.store.acquire('forces:red')).toBeTypeOf('function')
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
  it('publishes objectives as an umpire (PLY-35)', async () => {
    const h = harness({ roleId: 'white-1' })
    await h.store.ready()
    expect(await h.store.publishObjectives('red', '1. Hold the line.')).toEqual(ok(undefined))
    const call = h.session.calls.find((c) => c.op === 'publish')
    // Each author has its own item: a publisher cannot overwrite another's (§3 rule 14).
    expect(call?.args.slice(0, 2)).toEqual(['objectives:red', 'white-1'])
    expect(JSON.parse(String(call?.args[2]))).toMatchObject({
      schemaVersion: 1,
      forceId: 'red',
      markdown: '1. Hold the line.',
    })
  })

  it("shows the newest author's objectives, whatever order items arrive in", async () => {
    const h = harness()
    await h.store.ready()
    const item = (id: string, markdown: string, updatedAt: string) => ({
      id,
      payload: JSON.stringify(objectives('blue', markdown, updatedAt)),
      publisher: undefined,
    })
    h.session.emitItems({
      node: 'objectives:blue',
      items: [
        item('white-1', 'Umpire edit', '2026-10-24T11:00:00.000Z'),
        item('admin', 'Admin original', '2026-10-24T10:00:00+00:00'),
      ],
      retracted: [],
      deleted: false,
    })
    expect(h.store.objectives('blue').data?.markdown).toBe('Umpire edit')
    h.session.emitItems({
      node: 'objectives:blue',
      items: [item('admin', 'Admin revision', '2026-10-24T13:00:00+01:00')],
      retracted: [],
      deleted: false,
    })
    // 13:00+01:00 is 12:00Z, after the umpire's 11:00Z.
    expect(h.store.objectives('blue').data?.markdown).toBe('Admin revision')
  })

  it('refuses objectives from a player, a White Force observer, and invalid ones', async () => {
    const h = harness()
    await h.store.ready()
    expect(await h.store.publishObjectives('blue', 'x')).toMatchObject({
      ok: false,
      error: { code: 'not-permitted' },
    })
    const observer = harness({ roleId: 'white-observer' })
    await observer.store.ready()
    expect(await observer.store.publishObjectives('blue', 'x')).toMatchObject({
      ok: false,
      error: { code: 'not-permitted' },
    })
    expect(observer.session.calls.some((c) => c.op === 'publish')).toBe(false)
    const admin = harness({ roleId: 'admin' })
    await admin.store.ready()
    expect((await admin.store.publishObjectives('Bad Id', 'x')).ok).toBe(false)
    expect(await admin.store.publishObjectives('blue', 'x'.repeat(50_001))).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
    admin.session.stub('pubsub', 'publish', () => Promise.resolve(err('forbidden')))
    expect(await admin.store.publishObjectives('blue', 'x')).toMatchObject({
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
    const watch = await h.store.watchRoom('blue-hq')
    expect(watch.ok).toBe(true)
    expect(await h.store.logout()).toEqual(ok(undefined))
    const ops = h.session.calls.map((c) => c.op)
    expect(ops).toContain('leave')
    expect(ops.filter((op) => op === 'unsubscribe').length).toBeGreaterThan(5)
    expect(ops[ops.length - 1]).toBe('disconnect')
    expect(h.store.status()).toEqual({ state: 'ended', reason: 'logout' })
    expect(h.session.listenerCount()).toBe(0)
    expect(h.store.forces().data).toEqual([])
    expect(h.store.roomView('blue-hq').data).toBeUndefined()
    expect(await h.store.logout()).toEqual(ok(undefined))
    expect(await h.store.publishObjectives('blue', 'x')).toMatchObject({
      error: { code: 'session-ended' },
    })
    expect(await h.store.postAnnouncement('x')).toMatchObject({ error: { code: 'session-ended' } })
    expect(await h.store.watchRoom('blue-hq')).toMatchObject({ error: { code: 'session-ended' } })
    expect(await h.store.loadOlder('blue-hq')).toMatchObject({ error: { code: 'session-ended' } })
    expect(await h.store.rejoinRoom('blue-hq')).toMatchObject({ error: { code: 'session-ended' } })
    expect(await h.store.sendMessage('blue-hq', 'hi')).toMatchObject({
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
    a.publish('forces:blue', force('blue', { name: 'Only in A' }))
    expect(a.store.force('blue').data?.name).toBe('Only in A')
    expect(b.store.force('blue').data?.name).toBe('BLUE')
    await a.store.logout()
    expect(b.store.status()).toEqual({ state: 'ready' })
  })
})
