// @vitest-environment happy-dom
// The turn panel (PLY-55, ADM-43; WP 5.4), over a store: the turn and phase live from
// `game-state`, what adjudication means for this role, and the admin's control behind its
// confirmation, a refused change kept in the dialog, and no control for anyone else.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { flush, harness, sampleDocuments } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import { err } from '@wrx/transport'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TurnPanel, TurnPanelCore, advanceWords } from './turn-panel.tsx'

afterEach(cleanup)

const at = (turn: number, phase: 'planning' | 'adjudication') =>
  ({ schemaVersion: 1, turn, phase }) as const

async function mount(roleId: string, state = at(1, 'planning')): Promise<Harness> {
  const docs = sampleDocuments()
  docs.set('game-state', [state])
  const h = harness({ roleId, docs })
  render(
    <StrictMode>
      <SessionStoreProvider store={h.store}>
        <TurnPanel />
      </SessionStoreProvider>
    </StrictMode>,
  )
  await act(() => h.store.ready())
  await act(() => flush())
  return h
}

const panel = () => screen.getByRole('region', { name: 'Turn' })
const status = () => within(panel()).getByRole('status')

describe('the turn panel (PLY-55)', () => {
  it('shows the turn and phase, live, and what adjudication means for a player', async () => {
    const h = await mount('blue-co', at(3, 'planning'))
    expect(status().textContent).toBe('Turn 3, Planning')
    expect(panel().getAttribute('data-phase')).toBe('planning')
    act(() => {
      h.publish('game-state', at(3, 'adjudication'))
    })
    expect(status().textContent).toBe('Turn 3, Adjudication')
    expect(panel().textContent).toContain('posting resumes when the next turn’s planning starts')
    // The note describes the status for screen readers.
    const note = document.getElementById(status().getAttribute('aria-describedby') ?? '')
    expect(note?.textContent).toContain('The umpires are adjudicating.')
    // Players get no control (ADM-43).
    expect(within(panel()).queryByRole('button')).toBeNull()
  })

  it('tells the White Force it keeps posting', async () => {
    await mount('white-1', at(2, 'adjudication'))
    expect(panel().textContent).toContain('Roles outside the White Force cannot post')
    expect(within(panel()).queryByRole('button')).toBeNull()
  })

  it('says when no turn is published, and when it cannot be read', () => {
    const { rerender } = render(<TurnPanelCore state={undefined} />)
    expect(panel().textContent).toContain('No turn yet')
    rerender(<TurnPanelCore state={undefined} problem="the server did not answer." />)
    expect(panel().textContent).toContain('The turn cannot be shown: the server did not answer.')
  })

  it('names the next phase for the admin’s button and confirmation', () => {
    expect(advanceWords(at(2, 'planning'))).toMatchObject({
      action: 'Start adjudication',
      title: 'Start adjudication?',
    })
    expect(advanceWords(at(2, 'adjudication'))).toMatchObject({
      action: 'Start turn 3',
      title: 'Start turn 3?',
    })
    expect(advanceWords(at(2, 'planning')).description).toContain(
      'roles outside the White Force can no longer post until turn 3 planning',
    )
  })
})

describe('the admin’s phase control (ADM-43)', () => {
  it('moves the game on after confirming, and not on Cancel', async () => {
    const h = await mount('admin', at(1, 'planning'))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Start adjudication…' }))
    const dialog = screen.getByRole('dialog', { name: 'Start adjudication?' })
    expect(dialog.textContent).toContain('Turn 1 moves from planning to adjudication.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(h.session.calls.some((c) => c.op === 'publish')).toBe(false)

    fireEvent.click(within(panel()).getByRole('button', { name: 'Start adjudication…' }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Start adjudication' }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    const call = h.session.calls.find((c) => c.op === 'publish')
    expect(call?.args[0]).toBe('game-state')
    expect(JSON.parse(String(call?.args[2]))).toEqual(at(1, 'adjudication'))
    act(() => {
      h.publish('game-state', at(1, 'adjudication'))
    })
    expect(within(panel()).getByRole('button', { name: 'Start turn 2…' })).toBeTruthy()
  })

  it('keeps a refusal in the dialog, and disables it when the game moves on meanwhile', async () => {
    const h = await mount('admin', at(1, 'planning'))
    h.session.stub('pubsub', 'publish', () => Promise.resolve(err('forbidden')))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Start adjudication…' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start adjudication' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Not changed: your role is not allowed to do this.',
    )
    // Another admin tab moves it on: this confirmation would now be wrong.
    act(() => {
      h.publish('game-state', at(1, 'adjudication'))
    })
    expect(dialog.textContent).toContain('The game has moved on to turn 1 adjudication')
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Start adjudication' })
        .disabled,
    ).toBe(true)
  })
})
