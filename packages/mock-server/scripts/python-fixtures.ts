// Writes python/tests/fixtures/demo-game.json (WP 6.1): what the bridge would return to the
// admin on the mock's demo seed, each part checked against the bridge protocol's result schemas,
// so the Python SDK's tests read the same game the app's do. With --check, fails if the file is
// stale. Part of `pnpm check:python`.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { INITIAL_GAME_STATE, designFileSchema, messageBodySchema } from '@wrx/schemas'
import { BRIDGE_PROTOCOL_VERSION, BRIDGE_RESULTS, type BridgeResult } from '@wrx/schemas/bridge'
import { demoSeed } from '../src/demo.ts'

const file = fileURLToPath(
  new URL('../../../python/tests/fixtures/demo-game.json', import.meta.url),
)

type RoomMessage = BridgeResult<'readRoomMessages'>['messages'][number]

function build(): string {
  const seed = demoSeed()
  const design = designFileSchema.parse(seed.design)
  const roleByLogin = new Map(design.roles.map((role) => [role.loginName, role]))
  const sender = (login: string): RoomMessage['sender'] =>
    login === 'admin'
      ? { isAdmin: true, roleId: null, loginName: 'admin' }
      : { isAdmin: false, roleId: roleByLogin.get(login)?.id ?? null, loginName: login }

  const messages: Record<string, RoomMessage[]> = {}
  for (const room of design.rooms) messages[room.id] = []
  ;(seed.history ?? []).forEach((message, index) => {
    messages[message.room]?.push({
      id: `demo-${String(index + 1).padStart(3, '0')}`,
      roomId: message.room,
      sentAt: message.at,
      sender: sender(message.author),
      body: messageBodySchema.parse(JSON.parse(message.body)),
    })
  })
  const mapRoom = design.rooms.find((room) => room.roomType === 'map')
  if (mapRoom === undefined || seed.worldState === undefined || seed.worldStateAt === undefined) {
    throw new Error('the demo seed has no map room or world state')
  }
  const worldStateMessage: RoomMessage = {
    id: 'demo-world-1',
    roomId: mapRoom.id,
    sentAt: seed.worldStateAt,
    sender: sender('admin'),
    body: { type: 'world-state', schemaVersion: 1, content: seed.worldState },
  }
  messages[mapRoom.id]?.push(worldStateMessage)
  for (const list of Object.values(messages)) list.sort((a, b) => a.sentAt.localeCompare(b.sentAt))

  const fixture = {
    readContext: BRIDGE_RESULTS.readContext.parse({
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      isAdmin: true,
      roleId: null,
      forceId: null,
    }),
    readGameSetup: BRIDGE_RESULTS.readGameSetup.parse({ setup: design.game }),
    readTurn: BRIDGE_RESULTS.readTurn.parse({ state: INITIAL_GAME_STATE }),
    readForces: BRIDGE_RESULTS.readForces.parse({ forces: design.forces }),
    readRoles: BRIDGE_RESULTS.readRoles.parse({ roles: design.roles }),
    readRooms: BRIDGE_RESULTS.readRooms.parse({ rooms: design.rooms }),
    readWorldState: BRIDGE_RESULTS.readWorldState.parse({
      state: seed.worldState,
      messageId: worldStateMessage.id,
      sentAt: worldStateMessage.sentAt,
    }),
    objectives: Object.fromEntries(
      design.objectives.map((o) => [
        o.forceId,
        BRIDGE_RESULTS.readObjectives.parse({ objectives: o }),
      ]),
    ),
    messages: Object.fromEntries(
      Object.entries(messages).map(([roomId, list]) => [
        roomId,
        BRIDGE_RESULTS.readRoomMessages.parse({ messages: list, cursor: null }).messages,
      ]),
    ),
  }
  return `${JSON.stringify(fixture, null, 2)}\n`
}

const text = build()
if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    // missing: stale
  }
  if (current !== text) {
    console.error(
      'python/tests/fixtures/demo-game.json is out of date. Run `pnpm python:fixtures` and commit it.',
    )
    process.exit(1)
  }
  console.log('python/tests/fixtures/demo-game.json is up to date.')
} else {
  writeFileSync(file, text)
  console.log(`Wrote ${file}`)
}
