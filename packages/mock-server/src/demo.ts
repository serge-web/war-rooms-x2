// The demo scenario (PLY-21, PLY-34): the sample design from @wrx/schemas, "Exercise Northern
// Gate", with a short morning of message history. Every password is a DEMO PASSWORD (NFR-6):
// `demo-<roleId>`, and `demo-admin` for the admin.
import type { DesignFile } from '@wrx/schemas'
// The schemas package keeps its sample design with its tests and does not export it.
import { sampleDesign } from '../../schemas/src/fixtures.ts'
import { stateFromDesign } from './seed.ts'
import type { DesignSeed, SeedMessage } from './seed.ts'
import type { MockState } from './state.ts'

function chat(text: string): string {
  return JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text } })
}

function at(time: string): string {
  return `2026-10-24T${time}.000Z`
}

const DEMO_HISTORY: readonly SeedMessage[] = Object.freeze([
  {
    room: 'blue-hq',
    author: 'blue-co',
    body: chat('Morning all. Orders for the crossing are out.'),
    at: at('08:40:00'),
  },
  {
    room: 'blue-hq',
    author: 'umpire-1',
    body: chat('Umpire here: the exercise clock starts at 09:00.'),
    at: at('08:45:00'),
  },
  {
    room: 'blue-hq',
    author: 'blue-co',
    body: chat('Understood. Recce team moving to the bridge.'),
    at: at('08:52:30'),
  },
  {
    room: 'red-hq',
    author: 'red-co',
    body: chat('Hold the east bank and wait for Blue to commit.'),
    at: at('08:41:00'),
  },
  {
    room: 'red-hq',
    author: 'umpire-1',
    body: chat('Red, confirm your opening positions by 08:55.'),
    at: at('08:47:00'),
  },
  {
    room: 'negotiation',
    author: 'blue-co',
    body: chat('Blue proposes a ceasefire at the crossing until noon.'),
    at: at('08:58:00'),
  },
  {
    room: 'negotiation',
    author: 'red-co',
    body: chat('Red will consider it. What do you offer in return?'),
    at: at('08:59:10'),
  },
])

/** The demo seed: the sample design, its history and its demo passwords. */
export function demoSeed(domain?: string): DesignSeed {
  const design: DesignFile = sampleDesign()
  return {
    design,
    ...(domain === undefined ? {} : { domain }),
    history: DEMO_HISTORY,
  }
}

/** The demo seed as server state, ready for `new MockServer({ seed })`. */
export function demoState(domain?: string): MockState {
  const state = stateFromDesign(demoSeed(domain))
  if (!state.ok) throw new Error(`the demo seed is invalid: ${state.error}`)
  return state.value
}
