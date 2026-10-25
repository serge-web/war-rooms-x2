// The player's session lifecycle (PLY-1–3, PLY-29, PLY-50, D20): an anonymous store for the
// welcome page, and the logged-in store, one per login. Everything lives in the hook's state,
// never at module level, so each pane of the multi-client view has its own (D15).
import { createSessionStore } from '@wrx/domain'
import type { SessionEndReason, SessionStore } from '@wrx/domain'
import type { Endpoint, Session, Transport, TransportError } from '@wrx/transport'
import { useCallback, useEffect, useRef, useState } from 'react'

/** A backend to log in to: the transport and where the server is (NFR-9). */
export interface Connection {
  readonly transport: Transport
  readonly endpoint: Endpoint
}

export interface SessionOptions {
  /** Makes the store for a session. Default `createSessionStore({ session })`. */
  readonly createStore?: (session: Session) => SessionStore
  /** The resource part of the JID; each pane and tab gets its own (D22). */
  readonly resource?: () => string
}

function randomResource(): string {
  try {
    return `wrx-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    // randomUUID needs a secure context; a resource only needs to be unique per account.
    return `wrx-${Math.random().toString(36).slice(2, 10)}`
  }
}

const defaultCreateStore = (session: Session) =>
  createSessionStore({
    session,
    // The store's default is `queueMicrotask` itself, which browsers refuse to call as a method
    // ("Illegal invocation"); wrapped, it is called unbound.
    defer: (task) => {
      queueMicrotask(task)
    },
  })

// ---- Anonymous welcome-page session (D20, PLY-27) -------------------------------------------

export type AnonymousState =
  | { readonly phase: 'connecting' }
  | { readonly phase: 'ready'; readonly store: SessionStore }
  /** The welcome page falls back to the default theme and still allows login (PLY-27). */
  | { readonly phase: 'unavailable'; readonly reason: string }

export interface AnonymousOptions extends SessionOptions {
  /** Report `unavailable` if no session after this long (ms); a late one still arrives. */
  readonly timeoutMs?: number
}

/**
 * An anonymous session for the welcome page, which may read only `game-setup` and the game
 * theme's assets (D20, NFR-21). Released on unmount, e.g. when the player logs in.
 */
export function useAnonymousStore(
  connection: Connection,
  options: AnonymousOptions = {},
): AnonymousState {
  const [state, setState] = useState<AnonymousState>({ phase: 'connecting' })
  const {
    createStore = defaultCreateStore,
    resource = randomResource,
    timeoutMs = 10_000,
  } = options
  useEffect(() => {
    let cancelled = false
    let store: SessionStore | undefined
    const timer = setTimeout(() => {
      if (!cancelled && store === undefined) {
        setState({ phase: 'unavailable', reason: 'the server did not answer' })
      }
    }, timeoutMs)
    void connection.transport
      .connect({
        endpoint: connection.endpoint,
        credentials: { kind: 'anonymous' },
        resource: resource(),
      })
      .then((result) => {
        if (!result.ok) {
          if (!cancelled) setState({ phase: 'unavailable', reason: result.error.condition })
          return
        }
        if (cancelled) {
          void result.value.disconnect()
          return
        }
        clearTimeout(timer)
        store = createStore(result.value)
        setState({ phase: 'ready', store })
      })
    return () => {
      cancelled = true
      clearTimeout(timer)
      void store?.logout()
    }
    // A new connection is a new backend; the options are fixed for the hook's life.
  }, [connection])
  return state
}

// ---- Logged-in session (PLY-1–3) ------------------------------------------------------------

/** Why a session ended without the player logging out, for the explanation (PLY-29, PLY-50). */
export interface EndedSession {
  readonly reason: Exclude<SessionEndReason, 'logout'>
  readonly text?: string
}

export type PlayerSessionState =
  | {
      readonly phase: 'signed-out'
      /** The last login attempt's error, for the form. */
      readonly error?: string
      /** Set after a forced logout. */
      readonly ended?: EndedSession
    }
  | { readonly phase: 'signing-in' }
  | { readonly phase: 'signed-in'; readonly store: SessionStore }

export interface PlayerSession {
  readonly state: PlayerSessionState
  /** Logs in with role id and password (PLY-1). The old session, if any, is logged out. */
  readonly login: (roleId: string, password: string) => Promise<void>
  /** Leaves rooms, releases subscriptions and clears the store (PLY-3). */
  readonly logout: () => Promise<void>
  /** Clears the forced-logout explanation once read. */
  readonly acknowledge: () => void
}

/** The message for a refused login. */
export function loginErrorMessage(error: TransportError): string {
  switch (error.condition) {
    case 'not-authorized':
      return 'Wrong role id or password.'
    case 'timeout':
    case 'disconnected':
    case 'remote-server-not-found':
    case 'remote-server-timeout':
    case 'service-unavailable':
      return 'Could not reach the server. Check the connection and try again.'
    default:
      return `Login failed (${error.condition}).`
  }
}

/**
 * The session for one player client: a fresh store per login, released on logout, on a forced
 * logout, and on unmount.
 */
export function usePlayerSession(
  connection: Connection,
  options: SessionOptions = {},
): PlayerSession {
  const [state, setState] = useState<PlayerSessionState>({ phase: 'signed-out' })
  const current = useRef<SessionStore | undefined>(undefined)
  const mounted = useRef(false)
  const attempt = useRef(0)
  const { createStore = defaultCreateStore, resource = randomResource } = options

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      attempt.current++
      const store = current.current
      current.current = undefined
      void store?.logout()
    }
  }, [])

  const store = state.phase === 'signed-in' ? state.store : undefined
  useEffect(() => {
    if (store === undefined) return undefined
    const check = () => {
      const status = store.status()
      if (status.state !== 'ended') return
      if (current.current === store) current.current = undefined
      // Idempotent: makes sure rooms, subscriptions and data are released (PLY-3).
      void store.logout()
      setState(
        status.reason === 'logout'
          ? { phase: 'signed-out' }
          : {
              phase: 'signed-out',
              ended:
                status.text === undefined
                  ? { reason: status.reason }
                  : { reason: status.reason, text: status.text },
            },
      )
    }
    check()
    return store.subscribe(check)
  }, [store])

  const logout = useCallback(async () => {
    const old = current.current
    current.current = undefined
    attempt.current++
    setState({ phase: 'signed-out' })
    await old?.logout()
  }, [])

  const login = useCallback(
    async (roleId: string, password: string) => {
      const old = current.current
      current.current = undefined
      await old?.logout()
      const mine = ++attempt.current
      setState({ phase: 'signing-in' })
      const result = await connection.transport.connect({
        endpoint: connection.endpoint,
        credentials: { kind: 'password', username: roleId.trim(), password },
        resource: resource(),
      })
      if (!mounted.current || mine !== attempt.current) {
        if (result.ok) void result.value.disconnect()
        return
      }
      if (!result.ok) {
        setState({ phase: 'signed-out', error: loginErrorMessage(result.error) })
        return
      }
      const created = createStore(result.value)
      current.current = created
      setState({ phase: 'signed-in', store: created })
    },
    // The options are fixed for the hook's life.
    [connection],
  )

  const acknowledge = useCallback(() => {
    setState((s) => (s.phase === 'signed-out' ? { phase: 'signed-out' } : s))
  }, [])

  return { state, login, logout, acknowledge }
}
