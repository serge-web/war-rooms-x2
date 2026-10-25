// The session store (@wrx/domain) on the demo mock, where the two meet over node deletion: a
// room node removed mid-session leaves the player's rooms at once when the node was created as
// the admin tooling creates nodes (notify_delete on), with no later game-setup publish needed.
// A node auto-created by a bare publish keeps ejabberd's default (notify_delete off), so its
// deletion is silent and only the next design version reveals it: the admin tooling never
// relies on auto-create.
import { createSessionStore } from '@wrx/domain'
import type { SessionStore } from '@wrx/domain'
import type { Session } from '@wrx/transport'
import { describe, expect, it, vi } from 'vitest'
import { demoState } from './demo.ts'
import { demoPassword } from './seed.ts'
import { MockServer } from './server.ts'
import { MockTransport } from './transport.ts'

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

const PRESS = {
  schemaVersion: 1,
  id: 'press',
  name: 'Press room',
  roomType: 'chat',
  participants: [{ kind: 'force', id: 'blue', access: 'write' }],
  config: {},
  order: 3,
}

async function demo() {
  const state = demoState()
  const transport = new MockTransport(new MockServer({ seed: state }))
  const endpoint = { websocketUrl: '', domain: state.domain }
  const login = async (id: string): Promise<Session> =>
    unwrap(
      await transport.connect({
        endpoint,
        credentials: { kind: 'password', username: id, password: demoPassword(id) },
      }),
    )
  const admin = await login('admin')
  const umpire = createSessionStore({ session: await login('white-observer'), logger: silent })
  await umpire.ready()
  const game = unwrap(await admin.pubsub.getItems('game-setup'))[0]
  if (game === undefined) throw new Error('no game-setup')
  const bumpDesign = async (designVersion: number) => {
    const setup = { ...(JSON.parse(game.payload) as object), designVersion }
    unwrap(await admin.pubsub.publish('game-setup', game.id, JSON.stringify(setup)))
  }
  return { state, admin, umpire, bumpDesign }
}

const silent = { debug: () => undefined, warn: () => undefined }

const roomIds = (store: SessionStore) => store.me().data.rooms.map((r) => r.room.id)

describe('a room node deleted mid-session (PLY-6)', () => {
  it('leaves the White observer’s rooms at once when the node was created as a publish creates it', async () => {
    const { state, admin, umpire, bumpDesign } = await demo()
    expect(roomIds(umpire)).not.toContain('press')
    // As the publish does: create and configure the node, grant access, publish, bump.
    unwrap(
      await admin.pubsub.createNode('rooms:press', {
        accessModel: 'whitelist',
        publishModel: 'publishers',
        maxItems: 1,
        notifyRetract: true,
      }),
    )
    unwrap(
      await admin.pubsub.setAffiliations('rooms:press', [
        { jid: `white-observer@${state.domain}`, affiliation: 'member' },
      ]),
    )
    unwrap(await admin.pubsub.publish('rooms:press', 'current', JSON.stringify(PRESS)))
    await bumpDesign(2)
    await vi.waitFor(() => {
      expect(roomIds(umpire)).toContain('press')
    })

    unwrap(await admin.pubsub.deleteNode('rooms:press'))
    await vi.waitFor(() => {
      expect(roomIds(umpire)).not.toContain('press')
    })
    expect(roomIds(umpire)).toEqual(['blue-hq', 'red-hq', 'negotiation'])
    await umpire.logout()
  })

  it('an auto-created node is deleted silently (ejabberd’s default), until the next design version', async () => {
    const { admin, umpire, bumpDesign } = await demo()
    unwrap(await admin.pubsub.publish('rooms:press', 'current', JSON.stringify(PRESS)))
    await bumpDesign(2)
    await vi.waitFor(() => {
      expect(roomIds(umpire)).toContain('press')
    })
    unwrap(await admin.pubsub.deleteNode('rooms:press'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(roomIds(umpire)).toContain('press')
    await bumpDesign(3)
    await vi.waitFor(() => {
      expect(roomIds(umpire)).not.toContain('press')
    })
    await umpire.logout()
  })
})
