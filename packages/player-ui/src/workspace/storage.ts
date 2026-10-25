// Where saved layouts live (PLY-5, D6): browser storage, keyed by server, role and the game's
// design version. The host supplies the storage and the key function, so the workspace touches
// no browser global itself. On the mock, the key function is the mock host's
// `names.storageKey`, which puts every key under the deployment's namespace (DOC-10).

/** Saved layouts by key. Reads and writes never throw: a blocked store just forgets. */
export interface LayoutStorage {
  load(key: string): string | undefined
  save(key: string, layout: string): void
}

export interface LayoutKeyParts {
  /** The XMPP domain the session is on. */
  readonly server: string
  /** The role id, or `admin` for the admin account. */
  readonly role: string
  /** `game-setup.designVersion` (§3 rule 8); a new design starts from the default layout. */
  readonly designVersion: number
}

/** The logical key of a saved layout. Bump the `v1` only if the saved format changes. */
export function layoutKey({ server, role, designVersion }: LayoutKeyParts): string {
  return `layout:v1:${server}:${role}:${designVersion}`
}

/** The subset of the Web Storage API the workspace uses. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Layouts in a Web Storage object (normally `localStorage`), under `storageKey(key)`. `storage`
 * is a function because merely reading `localStorage` throws where storage is blocked; any
 * failure is swallowed and the layout lasts only until reload.
 */
export function webLayoutStorage(
  storage: () => StorageLike,
  storageKey: (key: string) => string = (key) => key,
): LayoutStorage {
  return Object.freeze({
    load(key: string) {
      try {
        return storage().getItem(storageKey(key)) ?? undefined
      } catch {
        return undefined
      }
    },
    save(key: string, layout: string) {
      try {
        storage().setItem(storageKey(key), layout)
      } catch {
        // Blocked or full: the layout lasts until reload.
      }
    },
  })
}

/** Layouts in memory, for tests, stories and hosts without storage. */
export function memoryLayoutStorage(
  initial?: Iterable<readonly [string, string]>,
): LayoutStorage & {
  readonly entries: ReadonlyMap<string, string>
} {
  const entries = new Map<string, string>(initial)
  return {
    entries,
    load: (key) => entries.get(key),
    save(key, layout) {
      entries.set(key, layout)
    },
  }
}
