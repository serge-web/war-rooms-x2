// The session store (@wrx/domain) on the demo mock, where the two meet over rooms created and
// deleted mid-session. A room created during the session appears when the admin publishes the
// new `directory`, which the store reads live (PLY-60); nodes are never listed. A room node
// removed mid-session leaves the player's rooms at once when the node was created as the admin
// tooling creates nodes (notify_delete on), with no later publish needed. A node auto-created by
// a bare publish keeps ejabberd's default (notify_delete off), so its deletion is silent and only
// the next directory reveals it: the admin tooling never relies on auto-create.
import { nodeName } from '@wrx/schemas'
import { nameOf, tid } from '@wrx/schemas/fixtures'
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
  id: tid('press'),
  name: 'Press room',
  roomType: 'chat',
  participants: [{ kind: 'force', id: tid('blue'), access: 'write' }],
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
  const directory = unwrap(await admin.pubsub.getItems('directory'))[0]
  if (directory === undefined) throw new Error('no directory')
  /** Publishes the directory with Press added or taken out, as a publish does (PLY-60). */
  const publishDirectory = async (withPress: boolean) => {
    const doc = JSON.parse(directory.payload) as { rooms: string[] }
    const rooms = doc.rooms.filter((id) => id !== tid('press'))
    if (withPress) rooms.push(tid('press'))
    rooms.sort()
    unwrap(await admin.pubsub.publish('directory', directory.id, JSON.stringify({ ...doc, rooms })))
  }
  return { state, admin, umpire, publishDirectory }
}

const silent = { debug: () => undefined, warn: () => undefined }

const roomIds = (store: SessionStore) => store.me().data.rooms.map((r) => nameOf(r.room.id))

describe('rooms created and deleted mid-session (PLY-60)', () => {
  it('a new room appears with the new directory; deleted, it leaves the White observer’s rooms at once when the node was created as a publish creates it', async () => {
    const { state, admin, umpire, publishDirectory } = await demo()
    expect(roomIds(umpire)).not.toContain('press')
    // As the publish does: create and configure the node, grant access, publish the room,
    // then the directory.
    unwrap(
      await admin.pubsub.createNode(nodeName.room(tid('press')), {
        accessModel: 'whitelist',
        publishModel: 'publishers',
        maxItems: 1,
        notifyRetract: true,
      }),
    )
    unwrap(
      await admin.pubsub.setAffiliations(nodeName.room(tid('press')), [
        { jid: `white-observer@${state.domain}`, affiliation: 'member' },
      ]),
    )
    unwrap(
      await admin.pubsub.publish(nodeName.room(tid('press')), 'current', JSON.stringify(PRESS)),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(roomIds(umpire)).not.toContain('press')
    await publishDirectory(true)
    await vi.waitFor(() => {
      expect(roomIds(umpire)).toContain('press')
    })

    unwrap(await admin.pubsub.deleteNode(nodeName.room(tid('press'))))
    await vi.waitFor(() => {
      expect(roomIds(umpire)).not.toContain('press')
    })
    expect(roomIds(umpire)).toEqual([
      'blue-hq',
      'red-hq',
      'negotiation',
      'blue-reports',
      'map',
      'umpire',
    ])
    await umpire.logout()
  })

  it('an auto-created node is deleted silently (ejabberd’s default), until the next directory', async () => {
    const { admin, umpire, publishDirectory } = await demo()
    unwrap(
      await admin.pubsub.publish(nodeName.room(tid('press')), 'current', JSON.stringify(PRESS)),
    )
    await publishDirectory(true)
    await vi.waitFor(() => {
      expect(roomIds(umpire)).toContain('press')
    })
    unwrap(await admin.pubsub.deleteNode(nodeName.room(tid('press'))))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(roomIds(umpire)).toContain('press')
    await publishDirectory(false)
    await vi.waitFor(() => {
      expect(roomIds(umpire)).not.toContain('press')
    })
    await umpire.logout()
  })
})
