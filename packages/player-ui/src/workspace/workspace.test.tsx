// @vitest-environment happy-dom
// The workspace over a store, rendered (happy-dom): tabs per visible room, room panels in their
// theme, the registry and badge slots, saving and restoring, the reset when the rooms or the
// design version change (PLY-5), Reset layout, the keyboard move, two instances on one page,
// and the non-room panels.
import { tid } from '@wrx/schemas/fixtures'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import { flush, game, harness, role, room, selfPresence } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import type { AdminEditor, PlayerPanel, PlayerPanelProps } from '@wrx/hooks'
import { nodeName } from '@wrx/schemas'
import { ToastProvider } from '@wrx/ui'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../chat/chat-panel.tsx'
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

// Layouts are keyed by the role's GUID (PLY-5), so one saved before GUID ids is not found.
const KEY = (role: string) => layoutKey({ server: 'wrx.test', role: tid(role), designVersion: 1 })

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
    expect(seen.at(-1)).toMatchObject({ roomId: tid('negotiation'), config: {} })
  })

  it('fills the unread badge slot on room tabs only (PLY-11)', async () => {
    const Badge = ({ roomId }: RoomTabBadgeProps) => (
      <UnreadBadge count={roomId === tid('red-hq') ? 4 : roomId === tid('blue-hq') ? 120 : 0} />
    )
    await mount({ tabBadge: Badge })
    expect(within(tab('red-hq')).getByLabelText('4 unread messages').textContent).toBe('4')
    expect(within(tab('blue-hq')).getByLabelText('99+ unread messages')).toBeTruthy()
    expect(within(tab('negotiation')).queryByText(/unread/)).toBeNull()
    expect(document.querySelectorAll('[role="tab"] .wrx-unread')).toHaveLength(2)
    // NFR-14: the count is the tab's description; its name stays the room's name.
    const badge = within(tab('red-hq')).getByRole('img', { name: '4 unread messages' })
    expect(tab('red-hq').getAttribute('aria-describedby')).toBe(badge.id)
    expect(tab('negotiation').hasAttribute('aria-describedby')).toBe(false)
  })

  it('a room gained or lost resets the layout to the default; a rename relabels in place (PLY-5)', async () => {
    const h = await mount()
    fireEvent.keyDown(tab('negotiation'), { key: 'ArrowLeft', altKey: true, shiftKey: true })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq'], ['red-hq', 'negotiation']])
    // A rename is not structural: the arrangement stays.
    act(() => {
      h.publish(
        nodeName.room(tid('red-hq')),
        room('red-hq', [{ kind: 'force', id: 'red', access: 'write' }], {
          name: 'Red Main',
          order: 1,
        }),
      )
    })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq'], ['Red Main', 'negotiation']])
    // A room is added: the publish's directory names it, and the layout is the default again,
    // never the room fitted into it (PLY-6 and PLY-41 are retired).
    act(() => {
      h.publish(
        nodeName.room(tid('press')),
        room('press', [{ kind: 'force', id: 'blue', access: 'write' }], { order: 3 }),
      )
      h.publishDirectory()
    })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq', 'Red Main'], ['negotiation'], ['press']])
    expect(screen.getByRole('status').textContent).toBe(
      'Your rooms changed: layout reset to the default.',
    )
    // And lost: the default again.
    fireEvent.keyDown(tab('press'), { key: 'ArrowLeft', altKey: true, shiftKey: true })
    await act(() => flush())
    expect(columns()).toEqual([
      ['blue-hq', 'Red Main'],
      ['negotiation', 'press'],
    ])
    act(() => {
      h.publish(
        nodeName.room(tid('negotiation')),
        room('negotiation', [{ kind: 'role', id: 'red-co', access: 'write' }], { order: 2 }),
      )
    })
    await act(() => flush())
    // The White Force writes everywhere: White 1 keeps it, and nothing changes.
    expect(columns()).toEqual([
      ['blue-hq', 'Red Main'],
      ['negotiation', 'press'],
    ])
    // Destroyed by a publish: its node is deleted (which is announced), and the directory no
    // longer names it.
    act(() => {
      h.docs.delete(nodeName.room(tid('press')))
      h.session.emitItems({
        node: nodeName.room(tid('press')),
        items: [],
        retracted: [],
        deleted: true,
      })
      h.publishDirectory()
    })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq'], ['Red Main'], ['negotiation']])
  })

  it('says which rooms closed when the role loses them during play, and not on login (PLY-30)', async () => {
    const h = harness({ roleId: 'blue-co' })
    render(
      <ToastProvider>
        <SessionStoreProvider store={h.store}>
          <Workspace />
        </SessionStoreProvider>
      </ToastProvider>,
    )
    await act(() => h.store.ready())
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq'], ['negotiation']])
    expect(screen.queryByText(/closed$/)).toBeNull()
    // Blue CO moves to Red: Blue's room goes, Red's comes, the negotiation stays.
    act(() => {
      h.publish(nodeName.role(tid('blue-co')), role('blue-co', 'red'))
    })
    await act(() => flush())
    expect(columns().flat().sort()).toEqual(['negotiation', 'red-hq'])
    expect(screen.getByText('blue-hq closed')).toBeTruthy()
    expect(screen.getByText('Your role no longer has access to blue-hq.')).toBeTruthy()
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

  it('a new design version resets the layout to the default, with a notice, saved under the new key (PLY-5, R28)', async () => {
    const storage = memoryLayoutStorage()
    const h = harness({ roleId: 'white-1' })
    render(
      <ToastProvider>
        <SessionStoreProvider store={h.store}>
          <Workspace storage={storage} />
        </SessionStoreProvider>
      </ToastProvider>,
    )
    await act(() => h.store.ready())
    await act(() => flush())
    fireEvent.keyDown(tab('red-hq'), { key: 'ArrowLeft', altKey: true, shiftKey: true })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq', 'red-hq'], ['negotiation']])
    expect(screen.queryByText('Layout reset')).toBeNull()
    // Something is saved for version 2 already (another tab of this role, say): the reset wins.
    const v2 = layoutKey({ server: 'wrx.test', role: tid('white-1'), designVersion: 2 })
    storage.save(
      v2,
      JSON.stringify({
        layout: {
          type: 'row',
          children: [
            {
              type: 'tabset',
              children: ['negotiation', 'blue-hq', 'red-hq'].map((n) => ({
                type: 'tab',
                id: `room:${tid(n)}`,
                name: n,
              })),
            },
          ],
        },
      }),
    )
    // The same rooms, but a structural change elsewhere (§3 rule 8).
    act(() => {
      h.publish('game-setup', game(2))
    })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq'], ['red-hq'], ['negotiation']])
    expect(screen.getByText('Layout reset')).toBeTruthy()
    expect(
      screen.getByText(
        'The admin changed the game’s rooms or who may use them, so your workspace is back to the default layout.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('The game changed: layout reset to the default.')).toBeTruthy()
    expect(JSON.parse(storage.entries.get(v2) ?? '{}')).toMatchObject({
      layout: { children: [{}, {}, {}] },
    })
    // The version-1 layout is left as it was.
    expect(JSON.parse(storage.entries.get(KEY('white-1')) ?? '{}')).toMatchObject({
      layout: { children: [{}, {}] },
    })
    // A change that is not structural keeps the version, and the layout.
    fireEvent.keyDown(tab('red-hq'), { key: 'ArrowLeft', altKey: true, shiftKey: true })
    await act(() => flush())
    act(() => {
      h.publish('game-setup', { ...game(2), name: 'Renamed' })
    })
    await act(() => flush())
    expect(columns()).toEqual([['blue-hq', 'red-hq'], ['negotiation']])
    expect(screen.getAllByText('Layout reset')).toHaveLength(1)
  })

  it('a saved layout for other rooms is not restored: the default is used (PLY-5)', async () => {
    const saved = JSON.stringify({
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            children: [
              { type: 'tab', id: `room:${tid('gone')}`, name: 'Gone' },
              { type: 'tab', id: `room:${tid('negotiation')}`, name: 'negotiation' },
              { type: 'tab', id: 'panel:online', name: 'Online' },
            ],
          },
          {
            type: 'tabset',
            children: [{ type: 'tab', id: `room:${tid('blue-hq')}`, name: 'blue-hq' }],
          },
        ],
      },
    })
    const storage: LayoutStorage = memoryLayoutStorage([[KEY('white-1'), saved]])
    await mount({ storage })
    expect(columns()).toEqual([['blue-hq'], ['red-hq'], ['negotiation']])
    expect(stripTabs()).toEqual(['Game info', 'Online'])
  })

  it('restores a saved layout of the same rooms, its panels kept where they were (D6)', async () => {
    const saved = JSON.stringify({
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            children: [
              { type: 'tab', id: `room:${tid('red-hq')}`, name: 'red-hq' },
              { type: 'tab', id: `room:${tid('negotiation')}`, name: 'negotiation' },
              { type: 'tab', id: 'panel:online', name: 'Online' },
            ],
          },
          {
            type: 'tabset',
            children: [{ type: 'tab', id: `room:${tid('blue-hq')}`, name: 'blue-hq' }],
          },
        ],
      },
    })
    const storage: LayoutStorage = memoryLayoutStorage([[KEY('white-1'), saved]])
    await mount({ storage })
    expect(columns()).toEqual([['red-hq', 'negotiation', 'Online'], ['blue-hq']])
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
        nodeName.room(tid('blue-hq')),
        room('blue-hq', [{ kind: 'force', id: 'red', access: 'write' }]),
      )
      h.publish(
        nodeName.room(tid('negotiation')),
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

describe('the collapsed composer, remembered per room (PLY-54)', () => {
  const CHAT = withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {
    chat: { playerComponent: ChatPanel },
  })
  const panel = (name: string) => screen.getByRole('region', { name })
  const toggleIn = (name: string) => within(panel(name)).getByRole('button', { name: /message/ })

  it('is saved in the room’s tab, per room, and restored on the next login', async () => {
    const storage = memoryLayoutStorage()
    const first = await mount({ storage, registry: CHAT })
    expect(toggleIn('blue-hq').textContent).toBe('Hide message entry')
    fireEvent.click(toggleIn('blue-hq'))
    await act(() => flush())
    expect(toggleIn('blue-hq').textContent).toBe('Write a message')
    expect(toggleIn('red-hq').textContent).toBe('Hide message entry')
    const saved = JSON.parse(storage.entries.get(KEY('white-1')) ?? '{}') as unknown
    expect(JSON.stringify(saved)).toContain('"config":{"composerCollapsed":true}')
    first.unmount()

    await mount({ storage, registry: CHAT })
    expect(toggleIn('blue-hq').getAttribute('aria-expanded')).toBe('false')
    expect(toggleIn('red-hq').getAttribute('aria-expanded')).toBe('true')
  })

  it('Reset layout returns every room to its default, keeping what was typed (PLY-42)', async () => {
    const storage = memoryLayoutStorage()
    await mount({ storage, registry: CHAT })
    fireEvent.change(within(panel('blue-hq')).getByRole('textbox'), {
      target: { value: 'Kept' },
    })
    fireEvent.click(toggleIn('blue-hq'))
    await act(() => flush())
    expect(within(panel('blue-hq')).getByText('Draft not sent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
    await act(() => flush())
    expect(toggleIn('blue-hq').getAttribute('aria-expanded')).toBe('true')
    expect(within(panel('blue-hq')).getByRole<HTMLTextAreaElement>('textbox').value).toBe('Kept')
    expect(storage.entries.get(KEY('white-1'))).not.toContain('composerCollapsed')
  })

  it('a design change’s reset returns every room to its default, keeping what was typed; the state set after it is saved under the new key (PLY-5)', async () => {
    const storage = memoryLayoutStorage()
    const h = await mount({ storage, registry: CHAT })
    fireEvent.change(within(panel('blue-hq')).getByRole('textbox'), {
      target: { value: 'Kept' },
    })
    fireEvent.click(toggleIn('blue-hq'))
    await act(() => flush())
    expect(toggleIn('blue-hq').getAttribute('aria-expanded')).toBe('false')
    act(() => {
      h.publish('game-setup', game(2))
    })
    await act(() => flush())
    expect(toggleIn('blue-hq').getAttribute('aria-expanded')).toBe('true')
    expect(within(panel('blue-hq')).getByRole<HTMLTextAreaElement>('textbox').value).toBe('Kept')
    const v2 = layoutKey({ server: 'wrx.test', role: tid('white-1'), designVersion: 2 })
    expect(storage.entries.get(v2)).not.toContain('composerCollapsed')
    // Collapsed again, under version 2: saved there, and restored on the next login.
    fireEvent.click(toggleIn('red-hq'))
    await act(() => flush())
    expect(storage.entries.get(v2)).toContain('"config":{"composerCollapsed":true}')
    expect(storage.entries.get(KEY('white-1'))).toContain('"config":{"composerCollapsed":true}')
  })

  it('starts collapsed for an observer, who can still expand it', async () => {
    await mount({ registry: CHAT }, { roleId: 'blue-observer' })
    const toggle = within(panel('blue-hq')).getByRole('button', { name: 'Show message entry' })
    fireEvent.click(toggle)
    await act(() => flush())
    expect(within(panel('blue-hq')).getByText(/You are observing this game/)).toBeTruthy()
  })
})

describe('OnlinePanelCore', () => {
  it('has an empty state', () => {
    render(<OnlinePanelCore roles={[]} />)
    expect(screen.getByText('Nobody is online in your rooms yet.')).toBeTruthy()
  })
})
