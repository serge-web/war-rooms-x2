// The publish marker (§3 rule 8, ADM-11): set before a publish's first step and cleared after
// its last. While it is set:
// - the version it names is still owed: a re-run publishes `game-setup` with it even when every
//   other change already landed;
// - documents may lag behind access, so the planner does not trust the published room documents
//   to say which members are read-only, and re-checks them.
// It holds no secret: only the design version being published and when it started.
//
// Where it is kept is the caller's choice (a MarkerStore). The admin's XEP-0049 private storage
// would be the natural place, but the real transport keeps only one private key per session
// (defining a second makes every request use the last one defined), and the vault already uses
// it; so the admin UI keeps the marker in browser storage, keyed by server, and tests in memory.
import { z } from 'zod'

const markerSchema = z.object({
  format: z.literal('wrx1-publish-pending'),
  designVersion: z.int().positive(),
  startedAt: z.string(),
})

export type PublishMarker = z.infer<typeof markerSchema>

export interface MarkerStore {
  read(): PublishMarker | undefined
  write(marker: PublishMarker): void
  clear(): void
}

/** A marker held for this page only. */
export function memoryMarkerStore(): MarkerStore {
  let marker: PublishMarker | undefined
  return {
    read: () => marker,
    write: (next) => {
      marker = next
    },
    clear: () => {
      marker = undefined
    },
  }
}

/** The part of the Web Storage API a marker needs. */
export interface MarkerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * A marker in Web Storage under `key` (one per server). An unreadable value counts as a marker
 * with no version, so everything is re-checked; storage that throws counts as no marker on read
 * and is ignored on write (the publish itself does not depend on it).
 */
export function storageMarkerStore(storage: MarkerStorage, key: string): MarkerStore {
  return {
    read: () => {
      let text: string | null
      try {
        text = storage.getItem(key)
      } catch {
        return undefined
      }
      if (text === null || text === '') return undefined
      return parseMarker(text)
    },
    write: (marker) => {
      try {
        storage.setItem(key, JSON.stringify(marker))
      } catch {
        // Quota or blocked storage: the publish goes on without a marker.
      }
    },
    clear: () => {
      try {
        storage.removeItem(key)
      } catch {
        // As above.
      }
    },
  }
}

export function parseMarker(text: string): PublishMarker {
  const unknownVersion: PublishMarker = {
    format: 'wrx1-publish-pending',
    designVersion: 1,
    startedAt: '',
  }
  try {
    const parsed = markerSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : unknownVersion
  } catch {
    return unknownVersion
  }
}

export function newMarker(designVersion: number, now: Date): PublishMarker {
  return { format: 'wrx1-publish-pending', designVersion, startedAt: now.toISOString() }
}
