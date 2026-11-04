// The scale fixture (WP 3.2, NFR-11): the v1 sizes, valid, deterministic, and usable through the
// transport, with the busy room's history paged by MAM as a client reads it; and its templated
// form (WP 4.4): 2,000 templated messages, each valid, and the receiver's check timed per message.
import { chatRoomConfigReader, checkDesign, templateMessageBodySchema } from '@wrx/schemas'
import { checkTemplatedMessage, createTemplateValidator } from '@wrx/templates'
import type { TemplateValidator } from '@wrx/templates'
import { describe, expect, it } from 'vitest'
import { SCALE_BUSY_ROOM, SCALE_PLAYER, scaleDesign, scaleHistory, scaleState } from './scale.ts'
import { demoPassword } from './seed.ts'
import { MockServer } from './server.ts'
import { parseMockState } from './state.ts'
import { MockTransport } from './transport.ts'

describe('the scale fixture', () => {
  it('has 50 roles, 30 rooms and 10,000 messages in the busy room, and a clean design', () => {
    const design = scaleDesign()
    expect(design.roles).toHaveLength(50)
    expect(design.rooms).toHaveLength(30)
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
