// @vitest-environment happy-dom
// The out-of-game column over a store (happy-dom): the three parts in order, announcements oldest
// first with the newest live one highlighted, the admin's post box, the force panel in the force
// theme with live objectives, and the umpire's force choice and editor.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { flush, force, harness, objectives, sampleDocuments } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import { nodeName } from '@wrx/schemas'
import { err } from '@wrx/transport'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { AnnouncementsPanelCore } from './announcements.tsx'
import type { AnnouncementItem } from './announcements.tsx'
import { OutOfGameColumn } from './column.tsx'

afterEach(cleanup)

async function mount(roleId: string, docs = sampleDocuments()): Promise<Harness> {
  const h = harness({ roleId, docs, now: () => '2026-10-25T09:00:00.000Z' })
  render(
    <StrictMode>
      <SessionStoreProvider store={h.store}>
        <aside aria-label="Out-of-game column">
          <OutOfGameColumn />
        </aside>
      </SessionStoreProvider>
    </StrictMode>,
  )
  await act(() => h.store.ready())
  await act(() => flush())
  return h
}

const forcePanel = () => screen.getByRole('region', { name: 'Force panel' })
const announcements = () => screen.getByRole('region', { name: 'Announcements' })

function item(id: string, text: string, live = false, at = '10:00'): AnnouncementItem {
  return { id, text, postedAt: `2026-10-24T${at}:00.000Z`, live }
}

describe('the out-of-game column (PLY-36)', () => {
  it('shows the game-time slot, the admin panel and the force panel, top to bottom', async () => {
    await mount('blue-co')
    const column = screen.getByRole('complementary', { name: 'Out-of-game column' })
    const names = [...column.querySelectorAll('section[aria-label], section[aria-labelledby]')]
      .filter((s) => s.parentElement?.classList.contains('wrx-column') === true)
      .map((s) => s.getAttribute('aria-label') ?? s.querySelector('h2')?.textContent)
    expect(names).toEqual(['Game time', 'Announcements', 'Force panel'])
    expect(screen.getByText('Game time and turn: not used in this version.')).toBeTruthy()
  })
})

describe('the admin panel (PLY-37, PLY-38, ADM-29)', () => {
  it('lists announcements oldest first and highlights only the newest live one', async () => {
    const { rerender } = render(
      <AnnouncementsPanelCore items={[item('a', 'First', false, '09:00'), item('b', 'Second')]} />,
    )
    const texts = () =>
      within(screen.getByRole('log'))
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    expect(texts()).toEqual([expect.stringContaining('First'), expect.stringContaining('Second')])
    // Loaded at startup: nothing is new.
    expect(document.querySelectorAll('[data-new]')).toHaveLength(0)

    rerender(
      <AnnouncementsPanelCore
        highlightMs={30}
        items={[item('a', 'First', false, '09:00'), item('b', 'Second'), item('c', 'Third', true)]}
      />,
    )
    const fresh = [...document.querySelectorAll('[data-new]')]
    expect(fresh.map((li) => li.textContent)).toEqual([expect.stringContaining('Third')])
    // Briefly: the highlight goes after the timer.
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)))
    expect(document.querySelectorAll('[data-new]')).toHaveLength(0)
  })

  it('moves the highlight to a newer arrival', () => {
    const { rerender } = render(
      <AnnouncementsPanelCore items={[item('a', 'First', true)]} highlightMs={10_000} />,
    )
    expect(document.querySelectorAll('[data-new]')).toHaveLength(1)
    rerender(
      <AnnouncementsPanelCore
        items={[item('a', 'First', true), item('b', 'Second', true)]}
        highlightMs={10_000}
      />,
    )
    const fresh = [...document.querySelectorAll('[data-new]')]
    expect(fresh.map((li) => li.textContent)).toEqual([expect.stringContaining('Second')])
  })

  it('shows an announcement published while open, highlighted', async () => {
    const h = await mount('blue-co')
    expect(within(announcements()).getByText(/None yet/)).toBeTruthy()
    // No post box for a player: only the admin may publish (§3 rule 15).
    expect(within(announcements()).queryByRole('textbox')).toBeNull()
    act(() => {
      h.publish(
        'announcements',
        { schemaVersion: 1, text: 'Break until 10:30.', postedAt: '2026-10-24T10:00:00.000Z' },
        'a1',
      )
    })
    await act(() => flush())
    const entry = within(screen.getByRole('log')).getByRole('listitem')
    expect(entry.textContent).toContain('Break until 10:30.')
    expect(entry.hasAttribute('data-new')).toBe(true)
  })

  it('gives the admin a text box that posts with Enter and clears once posted', async () => {
    const h = await mount('admin')
    const box = within(announcements()).getByRole('textbox', { name: 'New announcement' })
    fireEvent.change(box, { target: { value: 'Lunch at 12:30' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await act(() => flush())
    const call = h.session.calls.find((c) => c.op === 'publish')
    expect(call?.args[0]).toBe('announcements')
    expect(JSON.parse(String(call?.args[2]))).toMatchObject({ text: 'Lunch at 12:30' })
    expect((box as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps the admin’s text and says why when the post is refused', async () => {
    const h = await mount('admin')
    h.session.stub('pubsub', 'publish', () => Promise.resolve(err('forbidden')))
    const box = within(announcements()).getByRole('textbox', { name: 'New announcement' })
    fireEvent.change(box, { target: { value: 'Lunch' } })
    fireEvent.click(within(announcements()).getByRole('button', { name: 'Post announcement' }))
    await act(() => flush())
    expect(screen.getByRole('alert').textContent).toBe(
      'Not posted: your role is not allowed to do this.',
    )
    expect((box as HTMLTextAreaElement).value).toBe('Lunch')
  })
})

describe('the force panel (PLY-25, PLY-35)', () => {
  it('shows the role, its force and the force’s objectives in the force theme', async () => {
    const docs = sampleDocuments()
    docs.set(nodeName.force('blue'), [force('blue', { theme: { tokens: { primary: '#123456' } } })])
    await mount('blue-co', docs)
    const panel = forcePanel()
    expect(within(panel).getByRole('heading', { name: 'blue-co' })).toBeTruthy()
    expect(within(panel).getByText('BLUE')).toBeTruthy()
    expect(within(panel).getByRole('region', { name: 'Objectives' }).textContent).toContain(
      'Secure the crossing.',
    )
    // The force theme on this panel only (PLY-26).
    expect(panel.style.getPropertyValue('--wrx-primary')).toBe('#123456')
    // A player neither chooses another force nor edits.
    expect(within(panel).queryByRole('combobox')).toBeNull()
    expect(within(panel).queryByRole('button', { name: /Edit/ })).toBeNull()
  })

  it('updates live when someone publishes newer objectives', async () => {
    const h = await mount('blue-co')
    act(() => {
      h.publish(
        nodeName.objectives('blue'),
        objectives('blue', 'Hold the bridge.', '2026-10-25T09:00:00.000Z'),
        'umpire-1',
      )
    })
    await act(() => flush())
    expect(within(forcePanel()).getByRole('region', { name: 'Objectives' }).textContent).toContain(
      'Hold the bridge.',
    )
  })

  it('lets an umpire choose any force and publish its objectives with a preview', async () => {
    const h = await mount('umpire-1')
    const panel = forcePanel()
    const choice = within(panel).getByRole('combobox', { name: 'Show objectives for' })
    expect(
      within(choice)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['BLUE', 'RED', 'UMPIRE'])
    fireEvent.change(choice, { target: { value: 'red' } })
    await act(() => flush())
    expect(within(panel).getByRole('region', { name: 'RED objectives' }).textContent).toContain(
      'Delay Blue.',
    )

    fireEvent.click(within(panel).getByRole('button', { name: 'Edit RED objectives' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit RED objectives' })
    const text = within(dialog).getByRole('textbox', { name: 'Objectives (Markdown)' })
    expect((text as HTMLTextAreaElement).value).toBe('Delay Blue.')
    fireEvent.change(text, { target: { value: '1. Delay **Blue** until noon.' } })
    const preview = within(dialog).getByRole('region', { name: 'Objectives preview' })
    expect(preview.querySelector('strong')?.textContent).toBe('Blue')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish objectives' }))
    await act(() => flush())
    const call = h.session.calls.find((c) => c.op === 'publish')
    // One item per author (§3 rule 14).
    expect(call?.args.slice(0, 2)).toEqual(['objectives:red', 'umpire-1'])
    expect(JSON.parse(String(call?.args[2]))).toMatchObject({
      forceId: 'red',
      markdown: '1. Delay **Blue** until noon.',
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the editor open with the reason when publishing fails', async () => {
    const h = await mount('umpire-1')
    h.session.stub('pubsub', 'publish', () => Promise.resolve(err('timeout')))
    fireEvent.click(within(forcePanel()).getByRole('button', { name: /^Edit .* objectives$/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish objectives' }))
    await act(() => flush())
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Not published: the server did not answer. Try again.',
    )
  })

  it('lets the admin in the game view choose a force too, with no force of its own', async () => {
    await mount('admin')
    const panel = forcePanel()
    expect(within(panel).getByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(within(panel).getByRole('combobox', { name: 'Show objectives for' })).toBeTruthy()
    expect(within(panel).getByRole('region', { name: 'BLUE objectives' }).textContent).toContain(
      'Secure the crossing.',
    )
  })
})
