// Toasts over Radix Toast: announced politely by screen readers, swipe or Escape (F8 moves focus
// to the region) to dismiss (NFR-14). The provider holds its own list, so each pane of the
// multi-client view has its own toasts.
import * as RadixToast from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type Tone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  readonly title: string
  readonly description?: string
  /** Default `info`. */
  readonly tone?: Tone
  /** Milliseconds before it closes by itself. Default 6000; `Infinity` keeps it open. */
  readonly durationMs?: number
}

export interface Toaster {
  /** Shows a toast; returns its id. */
  show(toast: ToastOptions): string
  dismiss(id: string): void
}

interface ShownToast extends ToastOptions {
  readonly id: string
  readonly open: boolean
}

const ToasterContext = createContext<Toaster | undefined>(undefined)

export interface ToastProviderProps {
  readonly children?: ReactNode
  /** The region's accessible label. Default "Notifications". */
  readonly label?: string
}

/** Holds the toasts of everything inside it, and renders them in a viewport. */
export function ToastProvider({ children, label = 'Notifications' }: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ShownToast[]>([])
  const next = useRef(0)
  const dismiss = useCallback((id: string) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, open: false } : t)))
  }, [])
  const show = useCallback((toast: ToastOptions) => {
    const id = `wrx-toast-${next.current++}`
    setToasts((all) => [...all.filter((t) => t.open), { ...toast, id, open: true }])
    return id
  }, [])
  const toaster = useMemo<Toaster>(() => ({ show, dismiss }), [show, dismiss])
  return (
    <ToasterContext.Provider value={toaster}>
      <RadixToast.Provider label={label} swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            className={`wrx-toast wrx-toast--${toast.tone ?? 'info'}`}
            open={toast.open}
            duration={toast.durationMs ?? 6000}
            type={toast.tone === 'danger' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) dismiss(toast.id)
            }}
          >
            <RadixToast.Title className="wrx-toast__title">{toast.title}</RadixToast.Title>
            {toast.description === undefined ? null : (
              <RadixToast.Description className="wrx-toast__description">
                {toast.description}
              </RadixToast.Description>
            )}
            <RadixToast.Close className="wrx-toast__close" aria-label="Dismiss notification">
              <span aria-hidden="true">×</span>
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="wrx-toast__viewport" />
      </RadixToast.Provider>
    </ToasterContext.Provider>
  )
}

/** The enclosing provider's toaster. Throws outside a {@link ToastProvider}: a wiring bug. */
export function useToast(): Toaster {
  const toaster = useContext(ToasterContext)
  if (toaster === undefined) throw new Error('useToast needs a ToastProvider')
  return toaster
}
