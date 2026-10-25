// Hash routes, so one build works under any base path, on file hosting too (NFR-8, DOC-11):
// the path never changes, only the fragment.
//
//   #/        the player client: welcome page and login, then the shell
//   #/admin   the admin backend (WP 2.2)
//   #/multi   the multi-client view (WP 2.9)
import { useSyncExternalStore } from 'react'

export type Route =
  | { readonly name: 'player' }
  | { readonly name: 'admin' }
  | { readonly name: 'multi' }
  | { readonly name: 'not-found'; readonly path: string }

export const ROUTE_HREFS = Object.freeze({ player: '#/', admin: '#/admin', multi: '#/multi' })

export function parseRoute(hash: string): Route {
  const path =
    hash
      .replace(/^#/, '')
      .replace(/[?].*$/, '')
      .replace(/\/+$/, '') || '/'
  switch (path) {
    case '/':
      return { name: 'player' }
    case '/admin':
      return { name: 'admin' }
    case '/multi':
      return { name: 'multi' }
    default:
      return { name: 'not-found', path }
  }
}

function subscribe(onChange: () => void): () => void {
  addEventListener('hashchange', onChange)
  return () => {
    removeEventListener('hashchange', onChange)
  }
}

const readHash = () => location.hash

/** The current route; re-renders on navigation. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash, readHash)
  return parseRoute(hash)
}
