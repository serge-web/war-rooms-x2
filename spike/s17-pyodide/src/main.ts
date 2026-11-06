// The S17 page: the demo game on the in-tab mock server, an admin and a White Force session on
// it, the script runner and its bridge, and the admin's world-state draft with its change
// summary (ADM-45, ADM-46), from the domain's world-draft model. Playwright drives it through
// `window.s17`; nothing here is part of the app.
import {
  createSessionStore,
  diffWorldStates,
  worldDraftKey,
} from '../../../packages/domain/src/index.ts'
import type { SessionStore, WorldStateDiff } from '../../../packages/domain/src/index.ts'
import {
  MockServer,
  MockTransport,
  demoPassword,
  demoSeed,
  stateFromDesign,
} from '../../../packages/mock-server/src/index.ts'
import { worldStateSchema } from '../../../packages/schemas/src/index.ts'
import type { DesignFile, Room, WorldState } from '../../../packages/schemas/src/index.ts'
import { FORCE, ROOM } from '../../../packages/schemas/src/fixtures.ts'
import { PROPOSAL_PREFIX, ScriptBridge } from './bridge.ts'
import type { ScriptRole } from './bridge.ts'
import { ScriptRunner } from './runner.ts'
import type { RunOutcome, StartOptions, StartResult } from './runner.ts'

/** The game's umpire room (PD8): not in v1, so the spike adds it, for the White Force. */
const UMPIRE_ROOM = '30000000-0000-4000-8000-000000000a17'

function designWithUmpireRoom(design: DesignFile): DesignFile {
  const umpire: Room = {
    schemaVersion: 1,
    id: UMPIRE_ROOM,
    name: 'Umpire',
    roomType: 'chat',
    participants: [{ kind: 'force', id: FORCE.white, access: 'write' }],
    config: {},
    order: design.rooms.length,
  }
  return { ...design, rooms: [...design.rooms, umpire] }
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

const silent = { debug: () => undefined, warn: () => undefined }

async function setUp() {
  const seed = demoSeed()
  const state = unwrap(stateFromDesign({ ...seed, design: designWithUmpireRoom(seed.design as DesignFile) }))
  const transport = new MockTransport(new MockServer({ seed: state }))
  const endpoint = { websocketUrl: '', domain: state.domain }
  const login = async (loginName: string): Promise<SessionStore> => {
    const session = unwrap(
      await transport.connect({
        endpoint,
        credentials: { kind: 'password', username: loginName, password: demoPassword(loginName) },
      }),
    )
    const store = createSessionStore({ session, logger: silent })
    await store.ready()
    return store
  }
  const admin = await login('admin')
  const white = await login('white-cell')
  for (const store of [admin, white]) store.acquireWorldState(ROOM.map)
  await new Promise<void>((resolve) => {
    const check = () => {
      if (admin.worldState(ROOM.map).data?.state !== undefined && white.worldState(ROOM.map).data?.state !== undefined) {
        resolve()
      }
    }
    admin.subscribe(check)
    white.subscribe(check)
    check()
  })
  // The admin watches the umpire room for proposals (PD6).
  admin.acquireRoom(UMPIRE_ROOM)
  return { admin, white, domain: state.domain }
}

const game = setUp()

/** The admin's draft: the published state until a script or a proposal changes it. */
let draft: WorldState | undefined
const runner = new ScriptRunner((state) => {
  draft = state
  render()
})

async function published(): Promise<WorldState> {
  const { admin } = await game
  const state = admin.worldState(ROOM.map).data?.state
  if (state === undefined) throw new Error('no published world state')
  return state
}

/** The change summary (ADM-46) from the published state to the draft. */
async function summary(): Promise<{ added: string[]; removed: string[]; changed: { title: string; fields: string[] }[] }> {
  const base = await published()
  const diff: WorldStateDiff = diffWorldStates(base, draft ?? base)
  return {
    added: diff.added.map((a) => a.title),
    removed: diff.removed.map((a) => a.title),
    changed: diff.changed.map((c) => ({ title: c.after.title, fields: [...c.fields] })),
  }
}

function render(): void {
  void summary().then((s) => {
    const list = document.getElementById('summary')
    if (list === null) return
    list.replaceChildren(
      ...[
        ...s.added.map((t) => `Added: ${t}`),
        ...s.removed.map((t) => `Removed: ${t}`),
        ...s.changed.map((c) => `Changed: ${c.title} (${c.fields.join(', ')})`),
      ].map((text) => {
        const item = document.createElement('li')
        item.textContent = text
        return item
      }),
    )
    const status = document.getElementById('draft-status')
    if (status !== null) status.textContent = draft === undefined ? 'No draft' : 'Unpublished draft'
  })
}

async function bridgeFor(role: ScriptRole): Promise<ScriptBridge> {
  const { admin, white } = await game
  return new ScriptBridge({ role, store: role === 'admin' ? admin : white, mapRoomId: ROOM.map, umpireRoomId: UMPIRE_ROOM })
}

let lastBridge: ScriptBridge | undefined

/** What `window.s17` offers the Playwright spec. */
const api = {
  ready: async () => {
    await game
    render()
    return true
  },
  ids: { map: ROOM.map, umpire: UMPIRE_ROOM, blueHq: ROOM.blueHq },
  start: (options: StartOptions): Promise<StartResult> => runner.start(options),
  run: async (role: ScriptRole, code: string, timeoutMs?: number): Promise<RunOutcome & { calls: unknown[] }> => {
    const bridge = await bridgeFor(role)
    lastBridge = bridge
    const { admin, white } = await game
    const store = role === 'admin' ? admin : white
    const context = {
      role,
      mapRoomId: ROOM.map,
      umpireRoomId: UMPIRE_ROOM,
      rooms: store.me().data.rooms.map((r) => ({ id: r.room.id, name: r.room.name })),
    }
    const outcome = await runner.run(bridge, code, context, timeoutMs)
    return { ...outcome, calls: bridge.calls }
  },
  stop: () => runner.stop(),
  calls: () => lastBridge?.calls ?? [],
  rejected: () => runner.rejected,
  draft: () => draft,
  resetDraft: () => {
    draft = undefined
    render()
  },
  published,
  summary,
  /** The draft's storage key, as the admin view keeps it (ADM-45); the spike keeps it in memory. */
  draftKey: async () => worldDraftKey((await game).domain, ROOM.map),
  /** Proposals the admin has received in the umpire room (PD6), validated on receipt (PY-8). */
  proposals: async () => {
    const { admin } = await game
    const messages = admin.roomView(UMPIRE_ROOM).data?.messages ?? []
    return messages.flatMap((m) => {
      if (m.kind !== 'message' || m.body.type !== 'chat') return []
      const text = m.body.content.text
      if (!text.startsWith(PROPOSAL_PREFIX)) return []
      const json = JSON.parse(text.slice(PROPOSAL_PREFIX.length)) as { note: string; state: unknown }
      const state = worldStateSchema.safeParse(json.state)
      return [{ from: m.sender.loginName, note: json.note, valid: state.success, chars: text.length }]
    })
  },
  /** The admin's one action (PD6): load a proposal into the draft, then see the summary. */
  loadProposal: async (index: number) => {
    const { admin } = await game
    const messages = (admin.roomView(UMPIRE_ROOM).data?.messages ?? []).filter(
      (m) => m.kind === 'message' && m.body.type === 'chat' && m.body.content.text.startsWith(PROPOSAL_PREFIX),
    )
    const m = messages[index]
    if (m?.kind !== 'message' || m.body.type !== 'chat') throw new Error('no such proposal')
    const json = JSON.parse(m.body.content.text.slice(PROPOSAL_PREFIX.length)) as { state: unknown }
    draft = worldStateSchema.parse(json.state)
    render()
    return summary()
  },
}

declare global {
  interface Window {
    s17: typeof api
  }
}
window.s17 = api
