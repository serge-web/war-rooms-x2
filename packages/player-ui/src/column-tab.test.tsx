// @vitest-environment happy-dom
// FT-1, rendered (happy-dom): the shell puts the out-of-game column in a workspace tab when the
// client is narrow, and back in the column when it is wide, without remounting it; the tab is
// special (class, icon) and counts announcements that arrive while it is hidden; with no
// workspace to hold it (no game yet) the column stays where it is.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { flush, harness } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLUMN_BREAKPOINT_REM, Shell } from './shell.tsx'
import type { ColumnForm } from './shell.tsx'
import { unseenCount } from './column/index.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** happy-dom lays nothing out: every element reports this box (FlexLayout needs a size too). */
let width = 1200
beforeEach(() => {
  width = 1200
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() =>
    DOMRect.fromRect({ x: 0, y: 0, width, height: 700 }),
  )
})

async function mount(
  roleId: string,
  columnForm?: ColumnForm,
): Promise<Harness & { rerender: (form?: ColumnForm) => void }> {
  const h = harness({ roleId, now: () => '2026-10-25T09:00:00.000Z' })
  const ui = (form?: ColumnForm) => (
    <StrictMode>
      <SessionStoreProvider store={h.store}>
        <Shell
          backend={null}
          onLogout={vi.fn()}
          {...(form === undefined ? {} : { columnForm: form })}
        />
      </SessionStoreProvider>
    </StrictMode>
  )
  const view = render(ui(columnForm))
  await act(() => h.store.ready())
  await act(() => flush())
  return Object.assign(h, {
    rerender: (form?: ColumnForm) => {
      view.rerender(ui(form))
    },
  })
}

const aside = () => screen.queryByRole('complementary', { name: 'Out-of-game column' })
const columnTab = () => screen.queryByRole('tab', { name: 'Out of game' })
const roomTabs = () =>
  screen
    .getAllByRole('tab')
    .filter((t) => !t.classList.contains('wrx-tab-special'))
    .map((t) => t.getAttribute('aria-label'))

describe('the out-of-game column as a tab (FT-1)', () => {
  it('is a tab in a narrow client and the fixed column in a wide one, measured on the client', async () => {
    width = COLUMN_BREAKPOINT_REM * 16 - 1
    await mount('blue-co')
    expect(aside()).toBeNull()
    const tab = columnTab()
    expect(tab?.classList.contains('wrx-tab-special')).toBe(true)
    expect(tab?.querySelector('.wrx-tab__icon svg')).not.toBeNull()
    expect(roomTabs()).toEqual(['blue-hq', 'negotiation', 'Game info', 'Online'])
    cleanup()

    width = COLUMN_BREAKPOINT_REM * 16
    await mount('blue-co')
    expect(aside()).not.toBeNull()
    expect(columnTab()).toBeNull()
  })

  it('moves between column and tab without remounting, so a half-written announcement survives', async () => {
    const h = await mount('admin', 'column')
    const box = within(aside() ?? document.body).getByRole('textbox', { name: 'New announcement' })
    fireEvent.change(box, { target: { value: 'Draft: break at 10:30' } })

    h.rerender('tab')
    await act(() => flush())
    expect(aside()).toBeNull()
    fireEvent.click(columnTab() ?? document.body)
    await act(() => flush())
    const region = screen.getByRole('region', { name: 'Out of game' })
    const inTab = within(region).getByRole('textbox', { name: 'New announcement' })
    // The same element: React kept the column's tree, only its node moved.
    expect(inTab).toBe(box)
    expect((inTab as HTMLTextAreaElement).value).toBe('Draft: break at 10:30')

    h.rerender('column')
    await act(() => flush())
    expect(columnTab()).toBeNull()
    expect(
      within(aside() ?? document.body).getByRole('textbox', { name: 'New announcement' }),
    ).toBe(box)
  })

  it('counts announcements that arrive while the tab is hidden, and clears when it is shown', async () => {
    const h = await mount('blue-co', 'tab')
    const badge = () => columnTab()?.querySelector('.wrx-unread')?.textContent
    expect(badge()).toBeUndefined()
    for (const id of ['a1', 'a2']) {
      act(() => {
        h.publish(
          'announcements',
          { schemaVersion: 1, text: `Notice ${id}`, postedAt: '2026-10-25T09:00:00.000Z' },
          id,
        )
      })
      await act(() => flush())
    }
    expect(badge()).toBe('2')
    // The badge describes its tab for screen readers (NFR-14, WP 3.2).
    const described = columnTab()?.querySelector('[aria-label="2 unread messages"]')
    expect(described).not.toBeNull()
    fireEvent.click(columnTab() ?? document.body)
    await act(() => flush())
    expect(badge()).toBeUndefined()
  })

  it('stays the column while there is no workspace to hold the tab (no game yet)', async () => {
    width = 400
    const h = harness({ docs: new Map() })
    render(
      <SessionStoreProvider store={h.store}>
        <Shell backend={null} onLogout={vi.fn()} />
      </SessionStoreProvider>,
    )
    await act(() => h.store.ready())
    await act(() => flush())
    expect(screen.getByText(/No game has been published yet/)).toBeTruthy()
    expect(aside()?.querySelector('.wrx-column')).not.toBeNull()
  })
})

describe('unseenCount (FT-1)', () => {
  const items = [
    { id: 'a', live: false },
    { id: 'b', live: true },
    { id: 'c', live: true },
  ]
  it('counts live announcements after the last one seen', () => {
    expect(unseenCount(items, undefined)).toBe(2)
    expect(unseenCount(items, 'a')).toBe(2)
    expect(unseenCount(items, 'b')).toBe(1)
    expect(unseenCount(items, 'c')).toBe(0)
    // A seen one since retracted: every live one counts.
    expect(unseenCount(items, 'gone')).toBe(2)
  })
})
