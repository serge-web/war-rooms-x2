// Code loaded on first use (lazy chunks) can fail to arrive: a dropped connection, a timeout, or
// a redeploy that replaced the file the page asked for. Without a boundary such a failure is
// thrown to the root and takes the whole view down. `retryingImport` tries again a few times
// before giving up; `lazyChunk` makes a lazy component that can start a fresh load; and
// `ChunkBoundary` keeps a failure to the part that needed the code, with Try again and Reload.
import { Component, lazy } from 'react'
import type { ComponentType, ErrorInfo, LazyExoticComponent, ReactNode } from 'react'
import { Banner } from './banner.tsx'
import { Button } from './button.tsx'

/**
 * The module a failed dynamic import names ("Failed to fetch dynamically imported module: URL"
 * in Chromium, "error loading dynamically imported module: URL" in Firefox, "Importing a module
 * script failed." without one in Safari), if it is on this page's origin.
 */
export function failedModuleUrl(error: unknown): string | undefined {
  const text = error instanceof Error ? error.message : String(error)
  const match = /(https?:\/\/\S+?\.m?js)(?:\?\S*)?\s*$/.exec(text)
  if (match?.[1] === undefined) return undefined
  try {
    const url = new URL(match[1])
    return url.origin === globalThis.location.origin ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Runs `load`, trying again after a short wait when it fails, `attempts` times in all. A browser
 * keeps a failed dynamic import for the life of the page and refuses the same URL again at once
 * (Chromium 153), so a retry imports the module the error names with a query added, which is a
 * new URL to the browser and the same file to the server. Without a URL, it calls `load` again.
 */
export function retryingImport<T>(load: () => Promise<T>, attempts = 3, delayMs = 400): Promise<T> {
  return load().catch((error: unknown) => {
    if (attempts <= 1) throw error
    const url = failedModuleUrl(error)
    const again =
      url === undefined
        ? load
        : () => {
            const fresh = `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}-${attempts}`
            return import(/* @vite-ignore */ fresh) as Promise<T>
          }
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        retryingImport(again, attempts - 1, delayMs * 2).then(resolve, reject)
      }, delayMs)
    })
  })
}

/** A lazy component whose load retries, and which `reset()` loads afresh after a failure. */
export interface LazyChunk<P extends object> {
  (props: P): ReactNode
  /** Forgets a failed load, so the next render fetches the chunk again. */
  readonly reset: () => void
}

export function lazyChunk<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyChunk<P> {
  const make = (): LazyExoticComponent<ComponentType<P>> => lazy(() => retryingImport(load))
  let current = make()
  const view = (props: P) => {
    const View = current as unknown as ComponentType<P>
    return <View {...props} />
  }
  return Object.assign(view, {
    reset: () => {
      current = make()
    },
  })
}

export interface ChunkBoundaryProps {
  /** What failed to load, for the message: "the symbol preview". */
  readonly what: string
  /** Called before trying again, e.g. a `LazyChunk`'s `reset`. */
  readonly onRetry?: () => void
  readonly children?: ReactNode
}

interface ChunkBoundaryState {
  readonly failed: boolean
}

/** Shows a contained message, with Try again and Reload, when anything inside fails to render. */
export class ChunkBoundary extends Component<ChunkBoundaryProps, ChunkBoundaryState> {
  override state: ChunkBoundaryState = { failed: false }

  static getDerivedStateFromError(): ChunkBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn(`Could not show ${this.props.what}:`, error, info.componentStack)
  }

  private readonly retry = () => {
    this.props.onRetry?.()
    this.setState({ failed: false })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <Banner
        tone="warning"
        title={`${capitalise(this.props.what)} could not be loaded`}
        actions={
          <>
            <Button size="small" onClick={this.retry}>
              Try again
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                window.location.reload()
              }}
            >
              Reload the page
            </Button>
          </>
        }
      >
        Check the connection and try again. If the app was updated since this page was opened,
        reload it.
      </Banner>
    )
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
