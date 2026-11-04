// @vitest-environment happy-dom
// The composer during adjudication (PLY-56, WP 5.4), over a store: disabled with an explanation
// for a role outside the White Force, with the draft kept and sendable again at the next turn's
// planning; the collapsed bar says posting is paused (PLY-54); a templated room's form is disabled
// with its values kept (Annex A); White Force roles and the admin keep posting.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { flush, harness, room, sampleDocuments, selfPresence } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import { nodeName } from '@wrx/schemas'
import { blueReportsConfig, sampleTemplates, tid } from '@wrx/schemas/fixtures'
import { StrictMode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PAUSED_NOTE, PAUSED_REASON } from './chat-panel.tsx'
import { ChatPanel } from './chat-panel.tsx'
import { UnreadProvider } from './unread.tsx'

afterEach(cleanup)

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
})
afterAll(() => {
  vi.restoreAllMocks()
})

const at = (turn: number, phase: 'planning' | 'adjudication') => ({
  schemaVersion: 1,
  turn,
  phase,
})

async function mount(roleId: string, roomName: 'blue-hq' | 'blue-reports'): Promise<Harness> {
  const docs = sampleDocuments()
  docs.set('game-state', [at(1, 'planning')])
  docs.set('templates', sampleTemplates())
  const reports = room(
    'blue-reports',
    [
      { kind: 'force', id: 'blue', access: 'write' },
      { kind: 'force', id: 'white', access: 'write' },
    ],
    { order: 3, config: { ...blueReportsConfig(), freeText: true } },
  )
  docs.set(nodeName.room(reports.id), [reports])
  const h = harness({ roleId, docs })
  await h.store.ready()
  const doc = h.store.room(tid(roomName)).data
  if (doc === undefined) throw new Error('no room')
  render(
    <StrictMode>
      <SessionStoreProvider store={h.store}>
        <UnreadProvider>
          <ChatPanel roomId={tid(roomName)} room={doc} config={doc.config} access="write" />
        </UnreadProvider>
      </SessionStoreProvider>
    </StrictMode>,
  )
  await act(() => flush())
  act(() => {
    h.session.emitOccupant(selfPresence(roomName, roleId))
  })
  await act(() => flush())
  return h
}

const box = (name = 'blue-hq') =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: `Message ${name}` })
const send = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Send' })

describe('composers in adjudication (PLY-56)', () => {
  it('are disabled with an explanation for a role outside the White Force; the draft survives', async () => {
    const h = await mount('blue-co', 'blue-hq')
    fireEvent.change(box(), { target: { value: 'Advance at dawn' } })
    expect(send().disabled).toBe(false)

    act(() => {
      h.publish('game-state', at(1, 'adjudication'))
    })
    expect(screen.getByText(PAUSED_REASON)).toBeTruthy()
    expect(send().disabled).toBe(true)
    // Kept, read-only so it can still be copied, and described by the reason.
    expect(box().value).toBe('Advance at dawn')
    expect(box().readOnly).toBe(true)
    expect(box().getAttribute('aria-describedby')).toBeTruthy()

    // Collapsed, the bar says both: a draft waits, and posting is paused (PLY-54).
    fireEvent.click(screen.getByRole('button', { name: 'Hide message entry' }))
    const toggle = screen.getByRole('button', { name: 'Write a message' })
    const note = document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    expect(note?.textContent).toBe(`Draft not sent. ${PAUSED_NOTE}`)
    fireEvent.click(toggle)

    // The next turn's planning: the draft is there and sends.
    act(() => {
      h.publish('game-state', at(2, 'planning'))
    })
    expect(screen.queryByText(PAUSED_REASON)).toBeNull()
    expect(box().value).toBe('Advance at dawn')
    fireEvent.click(send())
    await waitFor(() => {
      expect(h.session.calls.some((c) => c.op === 'send')).toBe(true)
    })
  })

  it('stay open for White Force roles and the admin', async () => {
    for (const roleId of ['white-1', 'admin']) {
      const h = await mount(roleId, 'blue-hq')
      act(() => {
        h.publish('game-state', at(1, 'adjudication'))
      })
      expect(screen.queryByText(PAUSED_REASON)).toBeNull()
      fireEvent.change(box(), { target: { value: 'Ruling: the bridge holds.' } })
      expect(send().disabled).toBe(false)
      cleanup()
    }
  })

  it('disable a template’s form too, keeping its values (Annex A)', async () => {
    const h = await mount('blue-co', 'blue-reports')
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Message type' })
    const option = [...select.options].find((o) => o.textContent === 'Contact report')
    fireEvent.change(select, { target: { value: option?.value } })
    const grid = await screen.findByRole<HTMLInputElement>('textbox', { name: /Grid reference/ })
    fireEvent.change(grid, { target: { value: 'NV1234' } })

    act(() => {
      h.publish('game-state', at(1, 'adjudication'))
    })
    expect(screen.getByText(PAUSED_REASON)).toBeTruthy()
    expect(send().disabled).toBe(true)
    const kept = screen.getByRole<HTMLInputElement>('textbox', { name: /Grid reference/ })
    expect(kept.value).toBe('NV1234')
    expect(kept.disabled || kept.readOnly).toBe(true)

    act(() => {
      h.publish('game-state', at(2, 'planning'))
    })
    expect(send().disabled).toBe(false)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Grid reference/ }).value).toBe(
      'NV1234',
    )
  })
})
