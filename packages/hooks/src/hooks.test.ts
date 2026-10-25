// @vitest-environment happy-dom
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { withSlots, defaultRoomTypes } from '@wrx/domain'
import type { SessionStore } from '@wrx/domain'
import { force, flush, harness, message, role, room } from '@wrx/domain/fixtures'
import { StrictMode, createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { SessionStoreProvider, useSessionStore } from './context.ts'
import {
  useAnnouncements,
  useAsset,
  useAuthors,
  useDesignAccess,
  useDocument,
  useEffectiveAccess,
  useForce,
  useForces,
  useGameSetup,
  useMe,
  useObjectives,
  useOccupants,
  useRole,
  useRoles,
  useRoom,
  useRoomMessages,
  useRooms,
  useSessionStatus,
} from './hooks.ts'
import type { PlayerPanel, PlayerPanelProps, ReactRoomTypeRegistry } from './registry.ts'

// Testing Library's automatic cleanup needs test globals, which this repo does not enable.
afterEach(cleanup)

function strictWrapper(store: SessionStore) {
  return ({ children }: { children?: ReactNode }) =>
    createElement(StrictMode, null, createElement(SessionStoreProvider, { store }, children))
}

async function ready(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options)
  await h.store.ready()
  return h
}

describe('hooks under StrictMode (ARC-3)', () => {
  it('reports the session status, from starting to ready', async () => {
    const h = harness()
    const { result } = renderHook(() => useSessionStatus(), { wrapper: strictWrapper(h.store) })
    expect(result.current).toMatchObject({ data: { state: 'starting' }, status: 'loading' })
    await act(() => h.store.ready())
    expect(result.current).toEqual({ data: { state: 'ready' }, status: 'ready', error: undefined })
  })

  it('returns live documents and re-renders on change (PLY-28)', async () => {
    const h = await ready()
    const { result } = renderHook(
      () => ({
        game: useGameSetup(),
        forces: useForces(),
        roles: useRoles(),
        rooms: useRooms(),
        red: useForce('red'),
        me: useMe(),
        authors: useAuthors(),
        announcements: useAnnouncements(),
        objectives: useObjectives('blue'),
      }),
      { wrapper: strictWrapper(h.store) },
    )
    expect(result.current.game.data?.name).toBe('Exercise Northern Gate')
    expect(result.current.forces.data.map((f) => f.id)).toEqual(['blue', 'red', 'white'])
    expect(result.current.roles.status).toBe('ready')
    expect(result.current.rooms.data).toHaveLength(3)
    expect(result.current.me.data.rooms.map((r) => r.room.id)).toEqual(['blue-hq', 'negotiation'])
    expect(result.current.objectives.data?.markdown).toBe('Secure the crossing.')
    expect(result.current.announcements.data).toEqual([])
    act(() => {
      h.publish('forces:red', force('red', { name: 'Red Alliance', colour: '#ff0000', order: 1 }))
    })
    expect(result.current.red.data?.name).toBe('Red Alliance')
    expect(result.current.authors.data.get('red-co')?.colour).toBe('#ff0000')
  })

  it('acquires a node while mounted, and leaks nothing after a double mount (StrictMode)', async () => {
    const h = await ready()
    const baseline = h.session.listenerCount()
    const { result, unmount } = renderHook(() => useAsset('logo'), {
      wrapper: strictWrapper(h.store),
    })
    await act(() => flush())
    expect(h.session.listenerCount()).toBe(baseline + 1)
    expect(result.current.status).toBe('error')
    expect(result.current.error?.code).toBe('not-found')
    unmount()
    await flush()
    expect(h.session.listenerCount()).toBe(baseline)
    expect(
      h.session.calls.filter((c) => c.op === 'getItems' && c.args[0] === 'assets:logo'),
    ).toHaveLength(1)
  })

  it('joins a room once under StrictMode, and leaves it after unmount', async () => {
    const h = await ready({ pageSize: 10 })
    h.archive.set('blue-hq@conference.wrx.test', [message('blue-hq'), message('blue-hq')])
    const baseline = h.session.listenerCount()
    function Room(): ReactNode {
      const messages = useRoomMessages('blue-hq')
      const occupants = useOccupants('blue-hq')
      return createElement(
        'p',
        null,
        `${messages.status}:${String(messages.data?.messages.length)}:${String(occupants.data.length)}`,
      )
    }
    const view = render(createElement(Room), { wrapper: strictWrapper(h.store) })
    await act(() => flush())
    expect(view.container.textContent).toBe('ready:2:0')
    expect(h.session.calls.filter((c) => c.op === 'join')).toHaveLength(1)
    expect(h.session.listenerCount()).toBe(baseline + 2)
    act(() => {
      h.session.emitMessage(message('blue-hq'))
    })
    expect(view.container.textContent).toBe('ready:3:0')
    view.unmount()
    await flush()
    expect(h.session.listenerCount()).toBe(baseline)
    expect(h.session.calls.filter((c) => c.op === 'leave')).toHaveLength(1)
  })

  it('moves its subscription when the id changes', async () => {
    const h = await ready()
    const baseline = h.session.listenerCount()
    const { result, rerender, unmount } = renderHook(({ id }) => useDocument(`assets:${id}`), {
      wrapper: strictWrapper(h.store),
      initialProps: { id: 'one' },
    })
    await act(() => flush())
    rerender({ id: 'two' })
    await act(() => flush())
    expect(h.session.listenerCount()).toBe(baseline + 1)
    expect(result.current.status).toBe('error')
    unmount()
    await flush()
    expect(h.session.listenerCount()).toBe(baseline)
  })

  it('leaves no listeners at all after unmount and logout (PLY-3)', async () => {
    const h = await ready()
    const { unmount } = renderHook(
      () => [useRoomMessages('negotiation'), useRole('red-co'), useRoom('blue-hq'), useAsset('x')],
      { wrapper: strictWrapper(h.store) },
    )
    await act(() => flush())
    unmount()
    await flush()
    await h.store.logout()
    expect(h.session.listenerCount()).toBe(0)
  })

  it('answers invalid ids with an error and acquires nothing', async () => {
    const h = await ready()
    const baseline = h.session.listenerCount()
    const { result } = renderHook(() => useForce('Not An Id'), { wrapper: strictWrapper(h.store) })
    expect(result.current).toMatchObject({ status: 'error', error: { code: 'invalid' } })
    expect(h.session.listenerCount()).toBe(baseline)
  })

  it('computes effective access live, and for a design being edited (ADM-9)', async () => {
    const h = await ready()
    const { result } = renderHook(() => useEffectiveAccess(), { wrapper: strictWrapper(h.store) })
    expect(result.current.data.cells.get('red-hq')?.get('white-1')?.access).toBe('write')
    const design = {
      forces: [force('blue')],
      roles: [role('blue-co', 'blue')],
      rooms: [room('a', [{ kind: 'force' as const, id: 'blue', access: 'read' as const }])],
    }
    const pure = renderHook(({ input }) => useDesignAccess(input), {
      initialProps: { input: design },
    })
    const first = pure.result.current
    pure.rerender({ input: design })
    expect(pure.result.current).toBe(first)
    expect(first.cells.get('a')?.get('blue-co')?.access).toBe('read')
  })

  it('keeps panes apart: each provider has its own store (D15)', async () => {
    const a = await ready()
    const b = await ready({ roleId: 'red-co' })
    function Name(): ReactNode {
      return createElement('span', null, useMe().data.role?.name)
    }
    const view = render(
      createElement(
        'div',
        null,
        createElement(SessionStoreProvider, { store: a.store }, createElement(Name)),
        createElement(SessionStoreProvider, { store: b.store }, createElement(Name)),
      ),
    )
    expect(view.container.textContent).toBe('blue-cored-co')
  })

  it('throws a clear error outside a provider', () => {
    expect(() => renderHook(() => useSessionStore())).toThrow(/SessionStoreProvider/)
  })
})

describe('React registry slots (ARC-5)', () => {
  it('fills the chat slots with React components', () => {
    const ChatPanel: PlayerPanel = (props: PlayerPanelProps) =>
      createElement('div', null, props.room.name)
    const registry: ReactRoomTypeRegistry = withSlots(defaultRoomTypes(), {
      chat: { playerComponent: ChatPanel },
    })
    expect(registry.get('chat')?.playerComponent).toBe(ChatPanel)
    expect(registry.get('chat')?.adminEditor).toBeUndefined()
    expectTypeOf(registry.get('chat')?.playerComponent).toEqualTypeOf<PlayerPanel | undefined>()
  })
})
