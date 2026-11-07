// The Python runner's test page (WP 6.2): the demo game on an in-tab mock server, sessions for
// the admin, the White Force and a player, and the runner loaded from the app's build
// (`../py/runner.js`) as the script panel will load it (`loadRunner`). The admin's draft is
// held in memory. py-runner.spec.ts drives it through `window.pyHarness`.
import '@wrx/schemas/jitless'
import { createSessionStore } from '@wrx/domain'
import type { SessionStore } from '@wrx/domain'
import {
  MockServer,
  MockTransport,
  demoPassword,
  demoState,
  scaleWorldState,
} from '@wrx/mock-server'
import { loadRunner } from '@wrx/py-runner/load'
import type { RunOutcome, Runner, ScriptRole, StartResult } from '@wrx/py-runner'
import type { WorldState } from '@wrx/schemas'
import { ROOM, demoDesign } from '@wrx/schemas/fixtures'

const silent = { debug: () => undefined, warn: () => undefined }
const LOGINS = { admin: 'admin', 'white-force': 'white-cell', player: 'blue-co' } as const
type Login = keyof typeof LOGINS

async function setUp() {
  const state = demoState()
  const transport = new MockTransport(new MockServer({ seed: state }))
  const endpoint = { websocketUrl: '', domain: state.domain }
  const login = async (loginName: string): Promise<SessionStore> => {
    const result = await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: loginName, password: demoPassword(loginName) },
    })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    const store = createSessionStore({ session: result.value, logger: silent })
    await store.ready()
    return store
  }
  const stores = {
    admin: await login(LOGINS.admin),
    'white-force': await login(LOGINS['white-force']),
    player: await login(LOGINS.player),
  }
  for (const store of Object.values(stores)) store.acquireWorldState(ROOM.map)
  await new Promise<void>((resolve) => {
    const check = () => {
      if (Object.values(stores).every((s) => s.worldState(ROOM.map).data?.state !== undefined)) {
        resolve()
      }
    }
    for (const store of Object.values(stores)) store.subscribe(check)
    check()
  })
  return stores
}

const game = setUp()
const runnerModule = loadRunner(new URL('../', document.baseURI).href)

/** The admin's draft (ADM-45): undefined until a run that finished well applied one. */
let draft: WorldState | undefined
let applied = 0
const runners = new Map<ScriptRole, Runner>()
/** How the runners are made (review M1's measures): the defaults unless `configure` says. */
interface Configured {
  readonly prewarm?: boolean
  readonly preimportSdk?: boolean
}
const configured = new Map<ScriptRole, Configured>()

async function runnerFor(role: ScriptRole): Promise<Runner> {
  const existing = runners.get(role)
  if (existing !== undefined) return existing
  const { createRunner } = await runnerModule
  const stores = await game
  const runner = createRunner({
    role,
    store: stores[role],
    ...configured.get(role),
    ...(role === 'admin'
      ? {
          draft: {
            current: () => draft,
            // The harness keeps the script's state as it wrote it (WP 6.4's merge is the panel's).
            apply: ({ state }: { state: WorldState }) => {
              draft = state
              applied++
            },
          },
        }
      : {}),
  })
  runners.set(role, runner)
  return runner
}

const api = {
  ready: async () => {
    await game
    await runnerModule
    return true
  },
  ids: { map: ROOM.map, blueHq: ROOM.blueHq },
  start: async (role: ScriptRole = 'admin'): Promise<StartResult> =>
    (await runnerFor(role)).start(),
  run: async (role: ScriptRole, code: string, timeoutMs?: number): Promise<RunOutcome> =>
    (await runnerFor(role)).run(code, timeoutMs === undefined ? {} : { timeoutMs }),
  stop: async (role: ScriptRole = 'admin') => {
    ;(await runnerFor(role)).stop()
  },
  /** Ends the role's runner and makes the next one with these options (the performance spec). */
  configure: (role: ScriptRole, options: Configured) => {
    runners.get(role)?.dispose()
    runners.delete(role)
    configured.set(role, options)
  },
  calls: async (role: ScriptRole = 'admin') => (await runnerFor(role)).calls(),
  rejected: async (role: ScriptRole = 'admin') => (await runnerFor(role)).rejected().length,
  draft: () => draft,
  applied: () => applied,
  resetDraft: () => {
    draft = undefined
  },
  published: async () => (await game).admin.worldState(ROOM.map).data?.state,
  /**
   * The admin publishes a world state of `count` assets (the Phase 5 scale fixture's), and every
   * session sees it: for the performance spec (WP 6.5). Returns its size as JSON, in characters.
   */
  publishScale: async (count: number): Promise<number> => {
    const stores = await game
    const state = scaleWorldState(demoDesign(), count)
    const sent = await stores.admin.sendWorldState(ROOM.map, state)
    if (!sent.ok) throw new Error(sent.error.message)
    await new Promise<void>((resolve) => {
      const check = () => {
        const seen = Object.values(stores).every(
          (s) => Object.keys(s.worldState(ROOM.map).data?.state?.assets ?? {}).length === count,
        )
        if (seen) resolve()
      }
      for (const store of Object.values(stores)) store.subscribe(check)
      check()
    })
    return JSON.stringify(state).length
  },
  /** Blue CO posts `count` messages to Blue HQ, one after another; resolves when all are sent. */
  playerPosts: async (count: number, prefix: string): Promise<number> => {
    const { player } = await game
    const release = player.acquireRoom(ROOM.blueHq)
    await new Promise<void>((resolve) => {
      const check = () => {
        if (player.roomView(ROOM.blueHq).data?.status === 'joined') resolve()
      }
      player.subscribe(check)
      check()
    })
    const t0 = performance.now()
    for (let i = 0; i < count; i++) {
      const sent = await player.sendMessage(ROOM.blueHq, `${prefix} ${i}`)
      if (!sent.ok) throw new Error(sent.error.message)
    }
    const ms = performance.now() - t0
    release()
    return ms
  },
  /** Whether a runner may be made for a session as a role: PD4 refuses everyone else. */
  refused: async (login: Login, role: ScriptRole): Promise<string | undefined> => {
    const { createRunner } = await runnerModule
    const store = (await game)[login]
    try {
      createRunner({
        role,
        store,
        ...(role === 'admin'
          ? { draft: { current: () => undefined, apply: () => undefined } }
          : {}),
      })
      return undefined
    } catch (error) {
      return String(error)
    }
  },
}

declare global {
  interface Window {
    pyHarness: typeof api
  }
}
window.pyHarness = api
void api.ready().then(() => {
  const status = document.getElementById('status')
  if (status !== null) status.textContent = 'Ready'
})
