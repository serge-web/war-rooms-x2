// The scale fixture (WP 3.2, NFR-11): the v1 sizes, valid, deterministic, and usable through the
// transport, with the busy room's history paged by MAM as a client reads it; and its templated
// form (WP 4.4): 2,000 templated messages, each valid, and the receiver's check timed per message.
import {
  LIMITS,
  chatRoomConfigReader,
  checkDesign,
  templateMessageBodySchema,
  worldStateSchema,
} from '@wrx/schemas'
import { diffWorldStates, moveWorldAsset, worldStateSize } from '@wrx/domain'
import type { WorldAsset, WorldState } from '@wrx/schemas'
import { checkTemplatedMessage, createTemplateValidator } from '@wrx/templates'
import type { TemplateValidator } from '@wrx/templates'
import { describe, expect, it } from 'vitest'
import {
  SCALE_BUSY_ROOM,
  SCALE_PLAYER,
  scaleDesign,
  scaleHistory,
  scaleState,
  scaleWorldState,
} from './scale.ts'
import { demoPassword } from './seed.ts'
import { MockServer } from './server.ts'
import { parseMockState } from './state.ts'
import { MockTransport } from './transport.ts'

describe('the scale fixture', () => {
  it('has 50 roles, 30 rooms and the map room, 10,000 messages in the busy room, and a clean design', () => {
    const design = scaleDesign()
    expect(design.roles).toHaveLength(50)
    expect(design.rooms.filter((r) => r.roomType === 'chat')).toHaveLength(30)
    expect(design.rooms.filter((r) => r.roomType === 'map')).toHaveLength(1)
    expect(checkDesign(design).filter((i) => i.severity === 'error')).toEqual([])
    const state = scaleState()
    const busy = state.rooms.find((r) => r.jid.startsWith(`${SCALE_BUSY_ROOM}@`))
    expect(busy?.archive).toHaveLength(10_000)
    expect(state.accounts).toHaveLength(51)
    // What importDatabase reads back.
    expect(parseMockState(JSON.stringify(state)).ok).toBe(true)
  })

  it('is the same every time', () => {
    expect(JSON.stringify(scaleState({ messages: 200 }))).toBe(
      JSON.stringify(scaleState({ messages: 200 })),
    )
  })

  it('lets a player join the busy room and page its history back', async () => {
    const state = scaleState({ messages: 120 })
    const transport = new MockTransport(new MockServer({ seed: state }))
    const login = await transport.connect({
      endpoint: { websocketUrl: '', domain: state.domain },
      credentials: {
        kind: 'password',
        username: SCALE_PLAYER,
        password: demoPassword(SCALE_PLAYER),
      },
    })
    if (!login.ok) throw new Error(login.error.condition)
    const jid = `${SCALE_BUSY_ROOM}@conference.${state.domain}`
    expect((await login.value.muc.join(jid, SCALE_PLAYER)).ok).toBe(true)
    const page = await login.value.mam.queryRoom(jid, { max: 50 })
    if (!page.ok) throw new Error(page.error.condition)
    expect(page.value.messages).toHaveLength(50)
    expect(page.value.complete).toBe(false)
    await login.value.disconnect()
  })
})

describe('the templated scale fixture (WP 4.4)', () => {
  const options = { messages: 2_000, templated: true } as const
  const design = scaleDesign(options)
  const history = scaleHistory(design, options).filter((m) => m.room === SCALE_BUSY_ROOM)
  const busy = design.rooms.find((r) => r.id === SCALE_BUSY_ROOM)
  const config = chatRoomConfigReader.parse(busy?.config)
  const entities = { forces: design.forces, roles: design.roles, retired: design.retired }
  const bodies = history.map((m) => ({
    author: m.author,
    body: templateMessageBodySchema.parse(JSON.parse(m.body)),
  }))
  const check = (validator: TemplateValidator, m: (typeof bodies)[number]) =>
    checkTemplatedMessage(
      m.body,
      design.templates.find((t) => t.id === m.body.content.templateId),
      config,
      { loginName: m.author === 'admin' ? undefined : m.author, isAdmin: m.author === 'admin' },
      entities,
      { validator },
    )

  it('has 2,000 templated messages in the busy room, every one valid and permitted', () => {
    expect(checkDesign(design).filter((i) => i.severity === 'error')).toEqual([])
    expect(design.templates).toHaveLength(3)
    expect(bodies).toHaveLength(2_000)
    const validator = createTemplateValidator()
    const statuses = new Set(bodies.map((m) => check(validator, m).status))
    expect([...statuses]).toEqual(['valid'])
    expect(parseMockState(JSON.stringify(scaleState(options))).ok).toBe(true)
  })

  // The receiver's check per message (TPL-6), as the store runs it: one validator for the
  // session, its per-schema cache warm after the first message of each template. Recorded in
  // plan/reviews/phase-4-performance.md; the guard is generous, as for the browser numbers.
  it('checks a templated message in well under a millisecond', () => {
    const cold = performance.now()
    const first = createTemplateValidator()
    for (const m of bodies.slice(0, 3)) check(first, m)
    const coldMs = performance.now() - cold
    const validator = createTemplateValidator()
    for (const m of bodies) check(validator, m)
    const runs: number[] = []
    for (let r = 0; r < 5; r++) {
      const start = performance.now()
      for (const m of bodies) check(validator, m)
      runs.push((performance.now() - start) / bodies.length)
    }
    runs.sort((a, b) => a - b)
    const median = runs[2] ?? 0
    console.log(
      `[perf] receiver check: ${(median * 1000).toFixed(1)} µs per message (median of 5 runs of 2,000); first three, new validator: ${coldMs.toFixed(1)} ms`,
    )
    expect(median).toBeLessThan(1)
  })
})

describe('the scale fixture’s world state (WP 5.5, NFR-11)', () => {
  it('holds 600 valid assets over the player forces, within the map-room cap', () => {
    const design = scaleDesign()
    const state = scaleWorldState(design, 600)
    expect(worldStateSchema.safeParse(state).success).toBe(true)
    const assets = Object.values(state.assets)
    expect(assets).toHaveLength(600)
    expect(new Set(assets.map((a) => a.forceId)).size).toBe(4)
    expect(assets.some((a) => /^\d{20}$/.test(a.sidc))).toBe(true)
    const body = JSON.stringify({ type: 'world-state', schemaVersion: 1, content: state })
    expect(body.length).toBeLessThan(LIMITS.worldStateStanzaBytes / 2)
    expect(JSON.stringify(scaleWorldState(design, 600))).toBe(JSON.stringify(state))
    expect(parseMockState(JSON.stringify(scaleState({ messages: 50, worldAssets: 600 }))).ok).toBe(
      true,
    )
  })
})

/** The median of five timed runs of `run`, in ms. */
function medianMs(run: () => void): number {
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    run()
    times.push(performance.now() - start)
  }
  return times.sort((a, b) => a - b)[2] ?? Number.NaN
}

/** The most assets like `asset` that fit one map-room message (PLY-53), by halving. */
function mostThatFit(asset: (i: number) => WorldAsset): number {
  const state = (n: number): WorldState => ({
    turn: 1,
    assets: Object.fromEntries(
      Array.from({ length: n }, (_, i) => {
        const a = asset(i)
        return [a.id, a]
      }),
    ),
  })
  let low = 0
  let high = LIMITS.worldStateAssets
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (worldStateSize(state(mid)).ok) low = mid
    else high = mid - 1
  }
  return low
}

describe('the world state against the 500 KB map-room cap (WP 5.7, PLY-53, NFR-11)', () => {
  it('measures a 600-asset state, the most assets that fit, and the client-side costs', () => {
    const design = scaleDesign()
    const state = scaleWorldState(design, 600)
    const size = worldStateSize(state)
    expect(size.ok).toBe(true)
    const assets = Object.values(state.assets)
    const first = assets[0]
    if (first === undefined) throw new Error('fixture')
    const typical = (i: number): WorldAsset => ({
      ...(assets[i % assets.length] ?? first),
      id: `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
    })
    // Every text field at its longest, plain ASCII, and a 30-digit code.
    const longest = (i: number): WorldAsset => ({
      ...typical(i),
      title: 'T'.repeat(LIMITS.nameChars),
      category: 'C'.repeat(LIMITS.worldLabelChars),
      state: 'S'.repeat(LIMITS.worldLabelChars),
      sidc: '1'.repeat(30),
      lat: -12.345678901234,
      lon: -123.45678901234,
    })
    // The same, every character one XML escapes to five bytes (&amp;): the worst case.
    const escaped = (i: number): WorldAsset => ({
      ...longest(i),
      title: '&'.repeat(LIMITS.nameChars),
      category: '&'.repeat(LIMITS.worldLabelChars),
      state: '&'.repeat(LIMITS.worldLabelChars),
    })
    const fit = {
      typical: mostThatFit(typical),
      longest: mostThatFit(longest),
      escaped: mostThatFit(escaped),
    }
    const parse = medianMs(() => worldStateSchema.parse(state))
    const measure = medianMs(() => worldStateSize(state))
    const moved = moveWorldAsset(state, first.id, first.lat + 0.01, first.lon)
    if (!moved.ok) throw new Error(moved.error)
    const diff = medianMs(() => diffWorldStates(state, moved.value))
    console.log(
      `[perf] world state, 600 assets: ${size.bytes.toLocaleString('en-GB')} bytes as a message (${((100 * size.bytes) / size.limitBytes).toFixed(0)}% of the cap), ${Math.round(size.bytes / 600)} bytes per asset; most that fit: ${fit.typical} typical, ${fit.longest} with every field at its longest, ${fit.escaped} with every character escaped; parse ${parse.toFixed(1)} ms, size check ${measure.toFixed(1)} ms, diff ${diff.toFixed(1)} ms (medians of 5)`,
    )
    // NFR-11's 600 assets fit with room to spare, even at the longest plain field values.
    expect(size.bytes).toBeLessThan(LIMITS.worldStateStanzaBytes / 2)
    expect(fit.typical).toBeGreaterThan(1_200)
    expect(fit.longest).toBeGreaterThan(600)
    // The worst case does not: the editor refuses the publish with its size (WP 5.6).
    expect(fit.escaped).toBeLessThan(600)
    expect(parse + measure + diff).toBeLessThan(250)
  })
})
