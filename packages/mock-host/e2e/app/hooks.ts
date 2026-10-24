// What the test page exposes to Playwright on `window`.

export interface TestHooks {
  /** How this tab reaches the server. */
  readonly hosting: string
  readonly tab: string
  isHosting(): boolean
  /** Notice kinds so far. */
  notices(): string[]
  /** Logs in as a demo role with its demo password (NFR-6). */
  login(role: string): Promise<void>
  /** Joins a room by id; rejoined after every reconnection. */
  join(room: string): Promise<void>
  /** Sends a chat message; resolves to the error condition, or undefined on success. */
  send(room: string, text: string): Promise<string | undefined>
  /** Chat texts seen in the room, live and from history, oldest first. */
  texts(room: string): string[]
  /** Reconnections so far (after a leader change or a reset). */
  recoveries(): number
  reset(): Promise<string | undefined>
  exportDb(): Promise<string>
  importDb(json: string): Promise<string | undefined>
}

/** On a page opened with `?nohost`: storage access with no mock host running. */
export interface StorageHooks {
  readonly database: string
  write(value: string): Promise<void>
  read(): Promise<unknown>
}

declare global {
  interface Window {
    /** Set once the page is ready; wait with `'wrx' in window`. */
    wrx: TestHooks
    /** Set on a `?nohost` page; wait with `'wrxStorage' in window`. */
    wrxStorage: StorageHooks
  }
}
