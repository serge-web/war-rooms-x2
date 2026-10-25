// @vitest-environment happy-dom
// The workspace over a store, rendered (happy-dom): tabs per visible room, room panels in their
// theme, the registry and badge slots, saving and restoring, live reconciliation, reset, the
// keyboard move, two instances on one page, and the non-room panels.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import { flush, game, harness, room, selfPresence } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import type { AdminEditor, PlayerPanel, PlayerPanelProps } from '@wrx/hooks'
import { nodeName } from '@wrx/schemas'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { OnlinePanelCore } from './panels.tsx'
import { layoutKey, memoryLayoutStorage } from './storage.ts'
import type { LayoutStorage } from './storage.ts'
import { UnreadBadge } from './tabs.tsx'
import type { RoomTabBadgeProps } from './tabs.tsx'
import { Workspace } from './workspace.tsx'
import type { WorkspaceProps } from './workspace.tsx'

afterEach(cleanup)

// FlexLayout renders a tab's content only once its container has a size, and happy-dom lays
// nothing out, so every element reports a fixed box.
beforeAll(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 900, height: 600 }),
  )
})
afterAll(() => {
  vi.restoreAllMocks()
})

const KEY = (role: string) => layoutKey({ server: 'wrx.test', role, designVersion: 1 })

async function mount(
  props: WorkspaceProps = {},
  { roleId = 'white-1', panes = 1 }: { roleId?: string; panes?: number } = {},
): Promise<Harness & { rerender: (p: WorkspaceProps) => void; unmount: () => void }> {
  const h = harness({ roleId })
  const ui = (p: WorkspaceProps): ReactNode => (
    <StrictMode>
      <SessionStoreProvider store={h.store}>
        {Array.from({ length: panes }, (_, i) => (
          <section key={i} aria-label={`Pane ${i + 1}`}>
            <Workspace {...p} />
          </section>
        ))}
      </SessionStoreProvider>
    </StrictMode>
  )
  const view = render(ui(props))
  await act(() => h.store.ready())
  await act(() => flush())
  return Object.assign(h, {
    rerender: (p: WorkspaceProps) => {
      view.rerender(ui(p))
    },
    unmount: view.unmount,
  })
}

/** Room tab names per docked tabset, in DOM order (left to right in the default row). */
function columns(scope: HTMLElement = document.body): string[][] {
  return [...scope.querySelectorAll('.flexlayout__layout_main .flexlayout__tabset')].map((ts) =>
    [...ts.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-label') ?? ''),
  )
}

function stripTabs(scope: HTMLElement = document.body): string[] {
  return [...scope.querySelectorAll('.flexlayout__border_bottom [role="tab"]')].map(
    (t) => t.getAttribute('aria-label') ?? '',
  )
}

const tab = (name: string, scope: HTMLElement = document.body) =>
  within(scope).getByRole('tab', { name })

describe('Workspace', () => {
  it('shows one tab per visible room in the PLY-40 columns, and the panels in the strip', async () => {
    await mount()
    expect(columns()).toEqual([['blue-hq'], ['red-hq'], ['negotiation']])
    expect(stripTabs()).toEqual(['Game info', 'Online'])
    // Each room panel is the placeholder until WP 2.6, inside the room's theme scope.
    const panel = screen.getByRole('region', { name: 'blue-hq' })
    expect(panel.hasAttribute('data-wrx-theme')).toBe(true)
    expect(panel.style.getPropertyValue('--wrx-primary')).not.toBe('')
    expect(within(panel).getByText('Chat room')).toBeTruthy()
    expect(within(panel).getByText(/not in this build yet/)).toBeTruthy()
  })

  it('shows only the role’s rooms, read-only ones marked', async () => {
    await mount({}, { roleId: 'blue-observer' })
    expect(columns()).toEqual([['blue-hq']])
    expect(screen.getByText('Chat room, read only')).toBeTruthy()
  })

  it('renders the room type’s player component when one is registered (ARC-5)', async () => {
    const seen: PlayerPanelProps[] = []
    const ChatPanel: PlayerPanel = (props) => {
      seen.push(props)
      return <p>Chat for {props.room.name}</p>
    }
    const registry = withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {
      chat: { playerComponent: ChatPanel },
    })
    await mount({ registry })
    expect(screen.getByText('Chat for blue-hq')).toBeTruthy()
    expect(seen.at(-1)).toMatchObject({ roomId: 'negotiation', config: {} })
  })

  it('fills the unread badge slot on room tabs only (PLY-11)', async () => {
    const Badge = ({ roomId }: RoomTabBadgeProps) => (
      <UnreadBadge count={roomId === 'red-hq' ? 4 : roomId === 'blue-hq' ? 120 : 0} />
    )
    await mount({ tabBadge: Badge })
    expect(within(tab('red-hq')).getByLabelText('4 unread').textContent).toBe('4')
    expect(within(tab('blue-hq')).getByLabelText('99+ unread')).toBeTruthy()
    expect(within(tab('negotiation')).queryByText(/unread/)).toBeNull()
    expect(document.querySelectorAll('[role="tab"] .wrx-unread')).toHaveLength(2)
  })

  it('reconciles live: a new room goes to the fewest-tab tabset, a lost one closes (PLY-6, PLY-41)', async () => {
    const h = await mount()
    // Move negotiation next to blue-hq, so red-hq's tabset is the smallest... then add one.
    fireEvent.keyDown(tab('negotiation'), { key: 'ArrowLeft', altKey: true, shiftKey: true })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq'], ['red-hq', 'negotiation']])
    // PubSub does not announce new nodes: publishing bumps the design version (§3 rule 8).
    act(() => {
      h.publish(
        nodeName.room('press'),
        room('press', [{ kind: 'force', id: 'blue', access: 'write' }], { order: 3 }),
      )
      h.publish('game-setup', game(2))
    })
    await act(() => flush())
    expect(columns()).toEqual([
      ['blue-hq', 'press'],
      ['red-hq', 'negotiation'],
    ])
    act(() => {
      h.publish(
        nodeName.room('red-hq'),
        room('red-hq', [{ kind: 'force', id: 'red', access: 'write' }], { name: 'Red Main' }),
      )
    })
    await act(() => flush())
    expect(columns()).toEqual([
      ['blue-hq', 'press'],
      ['Red Main', 'negotiation'],
    ])
  })

  it('saves per server, role and design version, and restores on the next login (PLY-5)', async () => {
    const storage = memoryLayoutStorage()
    const first = await mount({ storage })
    expect(storage.entries.size).toBe(0)
    fireEvent.keyDown(tab('blue-hq'), { key: 'ArrowRight', altKey: true, shiftKey: true })
    await act(() => flush())
    expect(columns()).toEqual([['red-hq', 'blue-hq'], ['negotiation']])
    const saved = storage.entries.get(KEY('white-1'))
    expect(saved).toBeDefined()
    expect(saved).not.toContain('wrx-')
    first.unmount()

    await mount({ storage })
    expect(columns()).toEqual([['red-hq', 'blue-hq'], ['negotiation']])
  })

  it('a new design version carries the layout over, or restores the one saved for it (PLY-5)', async () => {
    const storage = memoryLayoutStorage()
    const h = await mount({ storage })
    fireEvent.keyDown(tab('red-hq'), { key: 'ArrowLeft', altKey: true, shiftKey: true })
    await act(() => flush())
    act(() => {
      h.publish('game-setup', game(2))
    })
    await act(() => flush())
    const v2 = layoutKey({ server: 'wrx.test', role: 'white-1', designVersion: 2 })
    expect(storage.entries.get(v2)).toBe(storage.entries.get(KEY('white-1')))
    expect(columns()).toEqual([['blue-hq', 'red-hq'], ['negotiation']])

    // Version 3 has a saved layout of its own: it replaces the one on screen.
    const v3 = layoutKey({ server: 'wrx.test', role: 'white-1', designVersion: 3 })
    storage.save(
      v3,
      JSON.stringify({
        layout: {
          type: 'row',
          children: [
            { type: 'tabset', children: [{ type: 'tab', id: 'room:negotiation', name: 'n' }] },
          ],
        },
      }),
    )
    act(() => {
      h.publish('game-setup', game(3))
    })
    await act(() => flush())
    expect(columns()).toEqual([['negotiation', 'blue-hq', 'red-hq']])
  })

  it('restores a saved layout reconciled with today’s rooms (D6)', async () => {
    const saved = JSON.stringify({
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            children: [
              { type: 'tab', id: 'room:gone', name: 'Gone' },
              { type: 'tab', id: 'room:negotiation', name: 'negotiation' },
              { type: 'tab', id: 'panel:online', name: 'Online' },
            ],
          },
          { type: 'tabset', children: [{ type: 'tab', id: 'room:blue-hq', name: 'blue-hq' }] },
        ],
      },
    })
    const storage: LayoutStorage = memoryLayoutStorage([[KEY('white-1'), saved]])
    await mount({ storage })
    expect(columns()).toEqual([
      ['negotiation', 'Online'],
      ['blue-hq', 'red-hq'],
    ])
    expect(stripTabs()).toEqual(['Game info'])
  })

  it('Reset layout restores the default for the current rooms (PLY-42)', async () => {
    const storage = memoryLayoutStorage()
    await mount({ storage })
    fireEvent.keyDown(tab('red-hq'), { key: 'ArrowLeft', altKey: true, shiftKey: true })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq', 'red-hq'], ['negotiation']])
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq'], ['red-hq'], ['negotiation']])
    expect(screen.getByRole('status').textContent).toBe('Layout reset.')
    const saved = storage.entries.get(KEY('white-1')) ?? ''
    expect(JSON.parse(saved)).toMatchObject({ layout: { children: [{}, {}, {}] } })
  })

  it('moves a tab with Alt+Shift+Arrow, announces it and keeps focus on it (NFR-14)', async () => {
    await mount()
    tab('blue-hq').focus()
    fireEvent.keyDown(tab('blue-hq'), { key: 'ArrowRight', altKey: true, shiftKey: true })
    await act(() => flush())
    expect(columns()).toEqual([['red-hq', 'blue-hq'], ['negotiation']])
    expect(screen.getByRole('status').textContent).toBe('blue-hq moved to column 1 of 2.')
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(document.activeElement).toBe(tab('blue-hq'))
    // Alone at the edge: it stays, and says so.
    fireEvent.keyDown(tab('negotiation'), { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(screen.getByRole('status').textContent).toBe('negotiation cannot move further right.')
    // Other keys and other targets are left to the library and the panels.
    fireEvent.keyDown(tab('negotiation'), { key: 'ArrowLeft', shiftKey: true })
    expect(columns()).toEqual([['red-hq', 'blue-hq'], ['negotiation']])
  })

  it('two instances on one page have their own layouts and unique DOM ids (D15, D22)', async () => {
    await mount({}, { panes: 2 })
    const [one, two] = screen.getAllByRole('region', { name: /^Pane/ })
    if (one === undefined || two === undefined) throw new Error('two panes expected')
    fireEvent.keyDown(tab('blue-hq', one), { key: 'ArrowRight', altKey: true, shiftKey: true })
    await act(() => flush())
    expect(columns(one)).toEqual([['red-hq', 'blue-hq'], ['negotiation']])
    expect(columns(two)).toEqual([['blue-hq'], ['red-hq'], ['negotiation']])
    const domIds = [...document.querySelectorAll('[id]')].map((e) => e.id)
    expect(domIds.filter((id, i) => domIds.indexOf(id) !== i)).toEqual([])
  })

  it('shows the no-rooms empty state (PLY-32)', async () => {
    const h = await mount({}, { roleId: 'blue-co' })
    act(() => {
      h.publish(
        nodeName.room('blue-hq'),
        room('blue-hq', [{ kind: 'force', id: 'red', access: 'write' }]),
      )
      h.publish(
        nodeName.room('negotiation'),
        room('negotiation', [{ kind: 'role', id: 'red-co', access: 'write' }]),
      )
    })
    await act(() => flush())
    expect(columns()).toEqual([[]])
    expect(screen.getByText(/Your role has no rooms yet/)).toBeTruthy()
  })

  it('docks game info and online as panels (PLY-8)', async () => {
    const h = await mount({}, { roleId: 'blue-co' })
    fireEvent.click(tab('Game info'))
    await act(() => flush())
    expect(screen.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Game briefing' })).toBeTruthy()

    fireEvent.click(tab('Online'))
    await act(() => flush())
    act(() => {
      h.session.emitOccupant(selfPresence('blue-hq', 'blue-co'))
      h.session.emitOccupant({
        ...selfPresence('negotiation', 'red-co'),
        jid: 'red-co@wrx.test/x',
        self: false,
        statusCodes: [],
      })
    })
    await act(() => flush())
    const online = screen.getByRole('region', { name: 'Online' })
    expect(
      within(online)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['blue-coBLUE(you)', 'red-coRED'])
  })
})

describe('OnlinePanelCore', () => {
  it('has an empty state', () => {
    render(<OnlinePanelCore roles={[]} />)
    expect(screen.getByText('Nobody is online in your rooms yet.')).toBeTruthy()
  })
})
