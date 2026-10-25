// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { SessionStore } from '@wrx/domain'
import { flush, harness } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { err, ok } from '@wrx/transport'
import type { ConnectOptions, Outcome, Session, Transport } from '@wrx/transport'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { endedExplanation } from './ended.tsx'
import { loginErrorMessage, useAnonymousStore, usePlayerSession } from './session.ts'
import type { Connection, EndedSession } from './session.ts'

afterEach(cleanup)

const strict = ({ children }: { children?: ReactNode }) => <StrictMode>{children}</StrictMode>

/** A transport that hands out harness sessions and records what it was asked. */
function fakeTransport(
  answer: (options: ConnectOptions) => Harness | 'refuse' | 'unreachable',
): Connection & { readonly asked: ConnectOptions[]; readonly made: Harness[] } {
  const asked: ConnectOptions[] = []
  const made: Harness[] = []
  const transport: Transport = {
    kind: 'mock',
    connect(options): Outcome<Session> {
      asked.push(options)
      const result = answer(options)
      if (result === 'refuse') return Promise.resolve(err('not-authorized'))
      if (result === 'unreachable') return Promise.resolve(err('remote-server-not-found'))
      made.push(result)
      return Promise.resolve(ok(result.session))
    },
  }
  return { transport, endpoint: { websocketUrl: '', domain: 'wrx.test' }, asked, made }
}

/** Uses the harness's own store for its session. */
function storeOf(made: readonly Harness[]) {
  return (session: Session): SessionStore => {
    const found = made.find((h) => h.session === session)
    if (found === undefined) throw new Error('unknown session')
    return found.store
  }
}

function disconnected(h: Harness): boolean {
  return h.session.calls.some((c) => c.op === 'disconnect')
}

describe('usePlayerSession', () => {
  it('logs in with role id and password, one store per login, and logs out (PLY-1, PLY-3)', async () => {
    const connection = fakeTransport(() => harness())
    const { result } = renderHook(
      () => usePlayerSession(connection, { createStore: storeOf(connection.made) }),
      { wrapper: strict },
    )
    expect(result.current.state.phase).toBe('signed-out')
    await act(() => result.current.login(' blue-co ', 'pw'))
    expect(connection.asked[0]?.credentials).toEqual({
      kind: 'password',
      username: 'blue-co',
      password: 'pw',
    })
    expect(connection.asked[0]?.resource).toMatch(/^wrx-/)
    const first = connection.made[0]!
    expect(result.current.state).toEqual({ phase: 'signed-in', store: first.store })

    await act(() => result.current.logout())
    expect(result.current.state).toEqual({ phase: 'signed-out' })
    expect(disconnected(first)).toBe(true)

    await act(() => result.current.login('blue-co', 'pw'))
    expect(connection.made).toHaveLength(2)
    expect(result.current.state.phase === 'signed-in' && result.current.state.store).toBe(
      connection.made[1]!.store,
    )
  })

  it('reports a refused login', async () => {
    const connection = fakeTransport(() => 'refuse')
    const { result } = renderHook(() => usePlayerSession(connection))
    await act(() => result.current.login('blue-co', 'wrong'))
    expect(result.current.state).toEqual({
      phase: 'signed-out',
      error: 'Wrong role id or password.',
    })
  })

  it.each([
    ['session-ended', 'Your session was ended'],
    ['account-removed', 'Your login was removed'],
  ] as const)(
    'is logged out with an explanation when the server ends the session: %s (PLY-50)',
    async (reason, title) => {
      const connection = fakeTransport(() => harness())
      const { result } = renderHook(
        () => usePlayerSession(connection, { createStore: storeOf(connection.made) }),
        { wrapper: strict },
      )
      await act(() => result.current.login('blue-co', 'pw'))
      const h = connection.made[0]!
      await act(async () => {
        h.session.emitStatus({ state: 'ended', reason })
        await flush()
      })
      expect(result.current.state).toEqual({ phase: 'signed-out', ended: { reason } })
      const ended: EndedSession = { reason }
      expect(endedExplanation(ended.reason).title).toBe(title)
      act(() => {
        result.current.acknowledge()
      })
      expect(result.current.state).toEqual({ phase: 'signed-out' })
    },
  )

  it('is logged out with an explanation when its role is deleted (PLY-29)', async () => {
    const connection = fakeTransport(() => harness())
    const { result } = renderHook(
      () => usePlayerSession(connection, { createStore: storeOf(connection.made) }),
      { wrapper: strict },
    )
    await act(() => result.current.login('blue-co', 'pw'))
    const h = connection.made[0]!
    await act(async () => {
      await h.store.ready()
      h.session.emitItems({ node: 'roles:blue-co', items: [], retracted: [], deleted: true })
      await flush()
    })
    expect(result.current.state).toEqual({ phase: 'signed-out', ended: { reason: 'deleted' } })
    expect(disconnected(h)).toBe(true)
  })

  it('logs out when unmounted', async () => {
    const connection = fakeTransport(() => harness())
    const { result, unmount } = renderHook(() =>
      usePlayerSession(connection, { createStore: storeOf(connection.made) }),
    )
    await act(() => result.current.login('blue-co', 'pw'))
    unmount()
    await flush()
    expect(disconnected(connection.made[0]!)).toBe(true)
  })
})

describe('useAnonymousStore (D20)', () => {
  it('connects anonymously and releases the session on unmount', async () => {
    const connection = fakeTransport(() => harness({ fake: { anonymous: true } }))
    const { result, unmount } = renderHook(
      () => useAnonymousStore(connection, { createStore: storeOf(connection.made) }),
      { wrapper: strict },
    )
    expect(result.current.phase).toBe('connecting')
    await act(() => flush())
    expect(connection.asked.every((o) => o.credentials.kind === 'anonymous')).toBe(true)
    const live = connection.made.at(-1)!
    expect(result.current).toEqual({ phase: 'ready', store: live.store })
    // StrictMode's first mount was cancelled; its session was disconnected at once.
    for (const h of connection.made.slice(0, -1)) expect(disconnected(h)).toBe(true)
    unmount()
    await flush()
    expect(disconnected(live)).toBe(true)
  })

  it('is unavailable when the server cannot be reached (PLY-27)', async () => {
    const connection = fakeTransport(() => 'unreachable')
    const { result } = renderHook(() => useAnonymousStore(connection))
    await act(() => flush())
    expect(result.current).toEqual({ phase: 'unavailable', reason: 'remote-server-not-found' })
  })
})

describe('messages', () => {
  it('words login failures', () => {
    expect(loginErrorMessage({ condition: 'timeout' })).toMatch(/Could not reach the server/)
    expect(loginErrorMessage({ condition: 'conflict' })).toBe('Login failed (conflict).')
  })

  it('explains every forced logout', () => {
    for (const reason of [
      'session-ended',
      'account-removed',
      'deleted',
      'auth-failed',
      'unreachable',
    ] as const) {
      expect(endedExplanation(reason).body.length).toBeGreaterThan(10)
    }
  })
})
