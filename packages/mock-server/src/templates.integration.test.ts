// Message templates in the session store on the demo mock (Annex A, WP 4.1): the store loads and
// live-updates templates and chat room config version 2, says what each role may post in a room,
// sends templated messages only after the receiver's own check, and checks what it receives.
import { createSessionStore } from '@wrx/domain'
import type { ReadableEntry, SessionStore } from '@wrx/domain'
import { nodeName } from '@wrx/schemas'
import type { Template } from '@wrx/schemas'
import { FORCE, ROOM, TEMPLATE, blueReportsConfig, templatedDesign } from '@wrx/schemas/fixtures'
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

const silent = { debug: () => undefined, warn: () => undefined }

function demo() {
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
  const store = async (id: string): Promise<SessionStore> => {
    const s = createSessionStore({ session: await login(id), logger: silent })
    await s.ready()
    return s
  }
  return { state, login, store }
}

const names = (templates: readonly Template[]) => templates.map((t) => t.name)

const SITREP = {
  force: FORCE.blue,
  summary: 'Holding the bridge',
  readiness: 75,
  asOf: '2026-10-24',
}

async function joined(store: SessionStore, roomId: string) {
  store.acquireRoom(roomId)
  await vi.waitFor(() => {
    expect(store.roomView(roomId).data?.status).toBe('joined')
  })
}

function templated(store: SessionStore, roomId: string): ReadableEntry[] {
  return (store.roomView(roomId).data?.messages ?? []).filter(
    (m): m is ReadableEntry => m.kind === 'message' && m.body.type === 'template',
  )
}

describe('templates in the session store (Annex A)', () => {
  it('loads every template and what each role may use in a room', async () => {
    const { store } = demo()
    const blue = await store('blue-co')
    expect(names(blue.templates().data)).toEqual([
      'Contact report',
      'Situation report',
      'Support request',
    ])
    const reports = blue.roomTemplates(ROOM.blueReports).data
    expect(reports.config).toEqual(blueReportsConfig())
    expect(reports.freeText).toBe(false)
    // Blue's two, then Blue CO's own entry (provisional answer 4).
    expect(names(reports.templates)).toEqual([
      'Situation report',
      'Contact report',
      'Support request',
    ])
    // A version 1 room: free text, no templates.
    expect(blue.roomTemplates(ROOM.blueHq).data).toEqual({
      config: { schemaVersion: 2, freeText: true, templates: [] },
      freeText: true,
      templates: [],
    })

    const observer = await store('blue-observer')
    expect(observer.roomTemplates(ROOM.blueReports).data.templates).toEqual([])
    const red = await store('red-co')
    expect(red.templates().data).toHaveLength(3)
    expect(red.roomTemplates(ROOM.blueReports).data.templates).toEqual([])
    const white = await store('white-observer')
    expect(white.roomTemplates(ROOM.blueReports).data.templates).toEqual([])
    const admin = await store('admin')
    expect(admin.roomTemplates(ROOM.blueReports).data.templates).toHaveLength(3)
  })

  it('sends a templated message only after the receiver’s check, and checks it on receipt', async () => {
    const { store } = demo()
    const blue = await store('blue-co')
    await joined(blue, ROOM.blueReports)

    // Free text is off here (TD3).
    const text = await blue.sendMessage(ROOM.blueReports, 'hello')
    expect(text.ok ? undefined : text.error.code).toBe('not-permitted')

    const bad = await blue.sendTemplateMessage(ROOM.blueReports, TEMPLATE.sitrep, {
      ...SITREP,
      readiness: 101,
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error.code).toBe('invalid')
      expect(bad.error.unsentValues).toMatchObject({ readiness: 101 })
      expect(bad.error.check?.status).toBe('invalid')
    }
    // Kept on the room for the composer, as refused text is (PLY-33, WP 4.2).
    expect(blue.roomView(ROOM.blueReports).data?.unsentTemplate).toMatchObject({
      templateId: TEMPLATE.sitrep,
      values: { readiness: 101 },
      error: { code: 'invalid' },
    })
    const unknownForce = await blue.sendTemplateMessage(ROOM.blueReports, TEMPLATE.sitrep, {
      ...SITREP,
      force: '10000000-0000-4000-8000-0000000000ee',
    })
    expect(unknownForce.ok ? undefined : unknownForce.error.code).toBe('invalid')
    const elsewhere = await blue.sendTemplateMessage(ROOM.blueHq, TEMPLATE.sitrep, SITREP)
    expect(elsewhere.ok ? undefined : elsewhere.error.code).toBe('not-joined')

    unwrap(await blue.sendTemplateMessage(ROOM.blueReports, TEMPLATE.sitrep, SITREP))
    expect(blue.roomView(ROOM.blueReports).data?.unsentTemplate).toBeUndefined()
    await vi.waitFor(() => {
      expect(templated(blue, ROOM.blueReports)).toHaveLength(1)
    })
    const [entry] = templated(blue, ROOM.blueReports)
    expect(blue.checkTemplate(entry!)).toMatchObject({ status: 'valid' })
    // Cached while nothing it depends on changes.
    expect(blue.checkTemplate(entry!)).toBe(blue.checkTemplate(entry!))

    // The White observer reads every room and sees the same check.
    const white = await store('white-observer')
    await joined(white, ROOM.blueReports)
    await vi.waitFor(() => {
      expect(templated(white, ROOM.blueReports)).toHaveLength(1)
    })
    expect(white.checkTemplate(templated(white, ROOM.blueReports)[0]!)?.status).toBe('valid')
  })

  it('shows a modified client’s message that does not fit as invalid', async () => {
    const { store, login, state } = demo()
    const raw = await login('blue-co')
    const room = `${ROOM.blueReports}@conference.${state.domain}`
    unwrap(await raw.muc.join(room, 'blue-co'))
    const hostile = {
      type: 'template',
      schemaVersion: 1,
      content: { templateId: TEMPLATE.sitrep, values: { ...SITREP, readiness: 'all of them' } },
    }
    unwrap(await raw.muc.send(room, JSON.stringify(hostile)))
    const unknown = { ...hostile, content: { templateId: FORCE.red, values: SITREP } }
    unwrap(await raw.muc.send(room, JSON.stringify(unknown)))

    const white = await store('white-observer')
    await joined(white, ROOM.blueReports)
    await vi.waitFor(() => {
      expect(templated(white, ROOM.blueReports)).toHaveLength(2)
    })
    const [first, second] = templated(white, ROOM.blueReports)
    expect(white.checkTemplate(first!)).toMatchObject({ status: 'invalid', reason: 'schema' })
    expect(white.checkTemplate(second!)).toMatchObject({
      status: 'invalid',
      reason: 'unknown-template',
    })
  })

  it('live-updates templates and the room config, and re-checks old messages as not permitted', async () => {
    const { store, login } = demo()
    const admin = await login('admin')
    const blue = await store('blue-co')
    await joined(blue, ROOM.blueReports)
    unwrap(
      await blue.sendTemplateMessage(ROOM.blueReports, TEMPLATE.support, {
        kind: 'air',
        detail: 'strike',
      }),
    )
    await vi.waitFor(() => {
      expect(templated(blue, ROOM.blueReports)).toHaveLength(1)
    })
    const [entry] = templated(blue, ROOM.blueReports)
    expect(blue.checkTemplate(entry!)?.status).toBe('valid')

    // A new template arrives live.
    const copy = {
      ...templatedDesign().templates[0]!,
      id: '50000000-0000-4000-8000-0000000000aa',
      name: 'Copy',
    }
    unwrap(await admin.pubsub.publish('templates', copy.id, JSON.stringify(copy)))
    await vi.waitFor(() => {
      expect(names(blue.templates().data)).toContain('Copy')
    })

    // The room stops offering Blue CO the support request: the old message is still a card, with
    // a warning (provisional answer 3), and free text comes back.
    const room = templatedDesign().rooms.find((r) => r.id === ROOM.blueReports)!
    const config = {
      ...blueReportsConfig(),
      freeText: true,
      templates: blueReportsConfig().templates.slice(0, 1),
    }
    unwrap(
      await admin.pubsub.publish(
        nodeName.room(ROOM.blueReports),
        'current',
        JSON.stringify({ ...room, config }),
      ),
    )
    await vi.waitFor(() => {
      expect(blue.roomTemplates(ROOM.blueReports).data.freeText).toBe(true)
    })
    expect(names(blue.roomTemplates(ROOM.blueReports).data.templates)).toEqual([
      'Situation report',
      'Contact report',
    ])
    expect(blue.checkTemplate(entry!)).toMatchObject({ status: 'not-permitted' })
    const again = await blue.sendTemplateMessage(ROOM.blueReports, TEMPLATE.support, {
      kind: 'air',
      detail: 'strike',
    })
    expect(again.ok ? undefined : again.error.code).toBe('not-permitted')
  })
})
