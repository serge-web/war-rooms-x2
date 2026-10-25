// The welcome page's data (PLY-27, PLY-46): the game setup and its logo, read from an anonymous
// store that may not exist yet. The page renders the same tree with or without a store, so the
// login form keeps its text and focus when the store arrives; that is why this reads the store
// directly rather than through @wrx/hooks, which need a SessionStoreProvider.
import { safeNodeName } from '@wrx/domain'
import type { SessionStore } from '@wrx/domain'
import type { Asset, GameSetup } from '@wrx/schemas'
import { useCallback, useSyncExternalStore } from 'react'

/**
 * `loading` until the anonymous read finishes; `none` when no game is published; `unavailable`
 * when the server could not be asked. The last two fall back to the default theme (PLY-27).
 */
export type WelcomeStatus = 'loading' | 'ready' | 'none' | 'unavailable'

export interface WelcomeData {
  readonly status: WelcomeStatus
  readonly game: GameSetup | undefined
  readonly logo: Asset | undefined
}

const NONE: WelcomeData = Object.freeze({ status: 'none', game: undefined, logo: undefined })
const LOADING: WelcomeData = Object.freeze({ status: 'loading', game: undefined, logo: undefined })
const UNAVAILABLE: WelcomeData = Object.freeze({
  status: 'unavailable',
  game: undefined,
  logo: undefined,
})

function useStoreValue<T>(
  store: SessionStore | undefined,
  node: string | undefined,
  read: (store: SessionStore) => T,
  fallback: T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (store === undefined) return () => undefined
      const release = node === undefined ? undefined : store.acquire(node)
      const unsubscribe = store.subscribe(onChange)
      return () => {
        unsubscribe()
        release?.()
      }
    },
    [store, node],
  )
  const get = () => (store === undefined ? fallback : read(store))
  return useSyncExternalStore(subscribe, get, get)
}

/**
 * The game and logo for the welcome page. With no store (still connecting, or the server could
 * not be reached), `pending` says whether to show loading or the no-game fallback.
 */
export function useWelcomeData(store: SessionStore | undefined, pending: boolean): WelcomeData {
  const setup = useStoreValue(store, 'game-setup', (s) => s.gameSetup(), undefined)
  const logoId = setup?.data?.theme.logoAssetId
  const logoNode = logoId === undefined ? undefined : safeNodeName('asset', logoId)
  const asset = useStoreValue(
    store,
    logoNode,
    (s) => (logoId === undefined ? undefined : s.asset(logoId)),
    undefined,
  )
  if (setup === undefined) return pending ? LOADING : UNAVAILABLE
  if (setup.data !== undefined) {
    return { status: 'ready', game: setup.data, logo: asset?.data }
  }
  if (setup.status === 'loading') return LOADING
  const code = setup.error?.code
  return code === 'transport' || code === 'session-ended' ? UNAVAILABLE : NONE
}

/** An asset as a `data:` URL for an `<img>` (SVG is only ever shown this way, §3 rule 12). */
export function assetUrl(asset: Asset): string {
  return `data:${asset.mimeType};base64,${asset.data}`
}
