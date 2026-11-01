// The special tab slot (FT-1). A host above the workspace, the player shell, can ask the
// workspace to show one extra tab, such as the out-of-game column when the client is narrow. The
// tab is the host's: it cannot be closed or popped out, and it is never saved with the layout.
// The host learns whether a workspace is there to take it (`claim`) and whether the tab is on
// screen (`onShownChange`), so it can keep its content elsewhere when no workspace is mounted and
// mark what arrives while the tab is hidden.
import { createContext } from 'react'
import type { ReactNode } from 'react'

/** The extra tab a host asks for. */
export interface WorkspaceSpecialTab {
  /** A slug, unique among special tabs; the tab's logical id is `special:<id>`. */
  readonly id: string
  readonly name: string
  readonly content: ReactNode
  /** Shown before the name, e.g. an icon (aria-hidden: the name is the label). */
  readonly icon?: ReactNode
  /** Shown after the name, e.g. an unread badge. */
  readonly badge?: ReactNode
}

export interface WorkspaceSpecialSlot {
  /** The tab to show now, or undefined for none. */
  readonly tab: WorkspaceSpecialTab | undefined
  /**
   * Called by each workspace mounted under the slot, which can show the tab; the returned
   * function releases the claim on unmount. Stable across renders.
   */
  readonly claim: () => () => void
  /** Whether the tab's content is on screen (its tab selected and its tabset or strip open). */
  readonly onShownChange?: ((shown: boolean) => void) | undefined
}

export const WorkspaceSpecialContext = createContext<WorkspaceSpecialSlot | undefined>(undefined)

export interface WorkspaceSpecialProviderProps {
  readonly value: WorkspaceSpecialSlot
  readonly children?: ReactNode
}

/** Offers a special tab to the workspace inside it. */
export function WorkspaceSpecialProvider({ value, children }: WorkspaceSpecialProviderProps) {
  return (
    <WorkspaceSpecialContext.Provider value={value}>{children}</WorkspaceSpecialContext.Provider>
  )
}
