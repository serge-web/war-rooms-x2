// The test surface each workspace exposes on window.wrx. Every method is implemented with the
// library's public API only; the Playwright tests read the DOM but never change it.

export type Library = 'flexlayout' | 'dockview'

export interface TabsetInfo {
  id: string
  /** Room ids in tab-strip order. */
  tabs: string[]
  selected: string | undefined
}

export interface WorkspaceHarness {
  library: Library
  /** Rooms the workspace currently holds (the role's visible rooms). */
  rooms(): string[]
  /** Tabsets of the main (docked) layout, in left-to-right tree order. */
  structure(): TabsetInfo[]
  /** Rooms currently shown in a popout window. */
  popouts(): string[]
  /** The library's own serialised layout, as a JSON string. */
  toJson(): string
  /** PLY-41: add a room into the tabset with the fewest tabs. */
  addRoom(id: string): void
  removeRoom(id: string): void
  /** Move a room to the end of the tabset at the given index in structure(). */
  moveRoom(id: string, toTabset: number): void
  selectRoom(id: string): void
  /** D6, PLY-6: load a saved layout, then reconcile it with the given room set. */
  restore(json: string, rooms: string[]): void
  /** PLY-42: back to the PLY-40 default for the current rooms. */
  reset(): void
  /** PLY-11: set a room's unread count, shown by the custom tab renderer. */
  setUnread(id: string, count: number): void
}

declare global {
  interface Window {
    wrx: {
      workspaces: Record<string, WorkspaceHarness>
      /** Room ids in the order their panels mounted (StrictMode doubles them in dev). */
      mounts: string[]
    }
  }
}

export function registerHarness(wsId: string, harness: WorkspaceHarness): () => void {
  window.wrx ??= { workspaces: {}, mounts: [] }
  window.wrx.workspaces[wsId] = harness
  return () => {
    if (window.wrx.workspaces[wsId] === harness) delete window.wrx.workspaces[wsId]
  }
}
