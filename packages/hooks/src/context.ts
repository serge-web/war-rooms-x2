import type { SessionStore } from '@wrx/domain'
import { createContext, createElement, useContext } from 'react'
import type { ReactNode } from 'react'

/**
 * The pane's store. Each pane in the multi-client view renders its own provider (D15), so
 * hooks never reach a store that belongs to another pane.
 */
const SessionStoreContext = createContext<SessionStore | undefined>(undefined)

export interface SessionStoreProviderProps {
  readonly store: SessionStore
  readonly children?: ReactNode
}

export function SessionStoreProvider({ store, children }: SessionStoreProviderProps): ReactNode {
  return createElement(SessionStoreContext.Provider, { value: store }, children)
}

/** The pane's store. Throws outside a {@link SessionStoreProvider}: that is a wiring bug. */
export function useSessionStore(): SessionStore {
  const store = useContext(SessionStoreContext)
  if (store === undefined) throw new Error('useSessionStore needs a SessionStoreProvider')
  return store
}
