// The demo scenario (PLY-21, PLY-34): the sample design from @wrx/schemas, "Exercise Northern
// Gate", with its message templates and the Blue Reports room that offers them, free text off
// (Annex A, `templatedDesign`), its map room with the admin's turn-1 world state (`demoDesign`,
// D25), a short morning of message history, provisioned and published as the admin tooling
// would leave it, observer vault included. Every password is a DEMO PASSWORD (NFR-6):
// `demo-<loginName>`, and `demo-admin` for the admin; the vault opens with the DEMO passphrase
// DEMO_VAULT_PASSPHRASE.
import type { DesignFile } from '@wrx/schemas'
// The schemas package keeps its sample design with its tests and does not export it.
import { ROOM, demoDesign, sampleWorldState } from '../../schemas/src/fixtures.ts'
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
    room: ROOM.blueHq,
    author: 'blue-co',
    body: chat('Morning all. Orders for the crossing are out.'),
    at: at('08:40:00'),
  },
  {
    room: ROOM.blueHq,
    author: 'admin',
    body: chat('The exercise clock starts at 09:00.'),
    at: at('08:45:00'),
  },
  {
    room: ROOM.blueHq,
    author: 'blue-co',
    body: chat('Understood. Recce team moving to the bridge.'),
    at: at('08:52:30'),
  },
  {
    room: ROOM.redHq,
    author: 'red-co',
    body: chat('Hold the east bank and wait for Blue to commit.'),
    at: at('08:41:00'),
  },
  {
    room: ROOM.redHq,
    author: 'admin',
    body: chat('Red, confirm your opening positions by 08:55.'),
    at: at('08:47:00'),
  },
  {
    room: ROOM.negotiation,
    author: 'blue-co',
    body: chat('Blue proposes a ceasefire at the crossing until noon.'),
    at: at('08:58:00'),
  },
  {
    room: ROOM.negotiation,
    author: 'red-co',
    body: chat('Red will consider it. What do you offer in return?'),
    at: at('08:59:10'),
  },
])

/**
 * The DEMO passphrase of the demo seed's observer vault (ADM-37, NFR-6): known, not secret, for
 * the mock only. The app shows it only in the mock-only build, where the demo passwords are shown
 * too; the real-server build leaves it out (apps/web AdminApp.tsx).
 */
export const DEMO_VAULT_PASSPHRASE = 'demo-observer-vault'

/** The admin's private-storage key for the vault: `VAULT_STORAGE_KEY` in @wrx/admin-ops. */
const VAULT_KEY = 'wrx-observer-vault'

/**
 * The demo vault as the admin tooling stores it in the admin's private storage: the demo design's
 * read-only roles with their demo passwords (the observers, and Blue CO and Red CO, read only in
 * the map room, §3 rule 18), AES-GCM under a PBKDF2 key from DEMO_VAULT_PASSPHRASE (the vault's
 * minimum 100,000 iterations, so it opens quickly). Fixed, so the seed is the same on every start.
 * packages/admin-ops/src/demo-vault.test.ts checks it still matches the demo design, and prints a
 * new one when it does not.
 */
const DEMO_VAULT_ENVELOPE = JSON.stringify({
  format: 'wrx1-observer-vault',
  version: 1,
  kdf: {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 100000,
    salt: 'j/HXzsfyPm2UZjST0zXYoQ==',
  },
  cipher: { name: 'AES-GCM', iv: '5Ngrgx/W/5Q0KOE7' },
  ciphertext:
    'Zhapi+5owrT6drnNpQFhzJIRIlmcZralrGlg1zvsJDEbWjFwJLbmYulrDFYwMoZIuqdgZD4JbXos6CreAnpy8rc8g6g5pAd5rFAd5jkTwuJhRrGxj83lXwEIfY0knBK4dL9F9jhdDpobZ/v1RDgKp95r0AejuqFnUtENimY4cNqob5VItWbXJO2g4y41kZYCRY23eQESy7GL5tE=',
})

/**
 * The demo seed: the templated sample design with its map room (`demoDesign`), its history, the
 * admin's turn-1 world state in the map room (D25), and its demo passwords.
 */
export function demoSeed(domain?: string): DesignSeed {
  const design: DesignFile = demoDesign()
  return {
    design,
    ...(domain === undefined ? {} : { domain }),
    history: DEMO_HISTORY,
    worldState: sampleWorldState(),
    worldStateAt: at('08:30:00'),
    adminPrivate: { [VAULT_KEY]: DEMO_VAULT_ENVELOPE },
  }
}

/** The demo seed as server state, ready for `new MockServer({ seed })`. */
export function demoState(domain?: string): MockState {
  const state = stateFromDesign(demoSeed(domain))
  if (!state.ok) throw new Error(`the demo seed is invalid: ${state.error}`)
  return state.value
}
