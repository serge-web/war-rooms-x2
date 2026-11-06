// The Python runner's test page (WP 6.2): the demo game on an in-tab mock server, sessions for
// the admin, the White Force and a player, and the runner loaded from the app's build
// (`../py/runner.js`) as the script panel will load it (`loadRunner`). The admin's draft is
// held in memory. py-runner.spec.ts drives it through `window.pyHarness`.
import '@wrx/schemas/jitless'
import { createSessionStore } from '@wrx/domain'
import type { SessionStore } from '@wrx/domain'
import { MockServer, MockTransport, demoPassword, demoState } from '@wrx/mock-server'
import { loadRunner } from '@wrx/py-runner/load'
import type { RunOutcome, Runner, ScriptRole, StartResult } from '@wrx/py-runner'
import type { WorldState } from '@wrx/schemas'
import { ROOM } from '@wrx/schemas/fixtures'

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

async function runnerFor(role: ScriptRole): Promise<Runner> {
  const existing = runners.get(role)
  if (existing !== undefined) return existing
  const { createRunner } = await runnerModule
  const stores = await game
  const runner = createRunner({
    role,
    store: stores[role],
    ...(role === 'admin'
      ? {
          draft: {
            apply: (state: WorldState) => {
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
  calls: async (role: ScriptRole = 'admin') => (await runnerFor(role)).calls(),
  rejected: async (role: ScriptRole = 'admin') => (await runnerFor(role)).rejected().length,
  draft: () => draft,
  applied: () => applied,
  resetDraft: () => {
    draft = undefined
  },
  published: async () => (await game).admin.worldState(ROOM.map).data?.state,
  /** Whether a runner may be made for a session as a role: PD4 refuses everyone else. */
  refused: async (login: Login, role: ScriptRole): Promise<string | undefined> => {
    const { createRunner } = await runnerModule
    const store = (await game)[login]
    try {
      createRunner({
        role,
        store,
        ...(role === 'admin' ? { draft: { apply: () => undefined } } : {}),
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
