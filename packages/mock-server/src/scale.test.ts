// The scale fixture (WP 3.2, NFR-11): the v1 sizes, valid, deterministic, and usable through the
// transport, with the busy room's history paged by MAM as a client reads it.
import { checkDesign } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
import { SCALE_BUSY_ROOM, SCALE_PLAYER, scaleDesign, scaleState } from './scale.ts'
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
