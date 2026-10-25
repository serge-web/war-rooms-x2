// The publish marker (§3 rule 8, ADM-11): set before a publish's first step and cleared after
// its last. While it is set:
// - the version it names is still owed: a re-run publishes `game-setup` with it even when every
//   other change already landed;
// - documents may lag behind access, so the planner does not trust the published room documents
//   to say which members are read-only, and re-checks them.
// It holds no secret: only the design version being published and when it started.
//
// Where it is kept is the caller's choice (a MarkerStore). The admin UI keeps it in the admin
// account's XEP-0049 private storage (`privateMarkerStore`), next to the vault, so every admin
// browser sees an unfinished publish: a marker kept in one browser would let another trust stale
// room documents and skip a re-check of read-only members. Tests use `memoryMarkerStore`. Earlier
// versions kept it in browser storage (`storageMarkerStore`), which the private store takes over
// once, as its `legacy` source.
import type { AdminApi } from '@wrx/transport'
import { z } from 'zod'
import { opsErr, opsOk } from '../errors.ts'
import type { OpsOutcome } from '../errors.ts'

const markerSchema = z.object({
  format: z.literal('wrx1-publish-pending'),
  designVersion: z.int().positive(),
  startedAt: z.string(),
})

export type PublishMarker = z.infer<typeof markerSchema>

export interface MarkerStore {
  /** The marker, if set. A store that cannot tell says a marker of unknown version (fail safe). */
  read(): Promise<PublishMarker | undefined>
  /** Sets the marker. A publish does not start when this fails. */
  write(marker: PublishMarker): OpsOutcome<void>
  /** Clears it. A failure leaves the marker set, which only makes the next plan re-check more. */
  clear(): Promise<void>
}

/** The private-storage key (a safe namespace suffix for XEP-0049). */
export const MARKER_STORAGE_KEY = 'wrx-publish-marker'

/** A marker of no known version: everything is re-checked. */
const UNKNOWN_VERSION: PublishMarker = Object.freeze({
  format: 'wrx1-publish-pending',
  designVersion: 1,
  startedAt: '',
})

/** A marker held for this page only. */
export function memoryMarkerStore(): MarkerStore {
  let marker: PublishMarker | undefined
  return {
    read: () => Promise.resolve(marker),
    write: (next) => {
      marker = next
      return Promise.resolve(opsOk(undefined))
    },
    clear: () => {
      marker = undefined
      return Promise.resolve()
    },
  }
}

export interface PrivateMarkerOptions {
  /**
   * Where an earlier version kept the marker (browser storage). A marker found there when the
   * private storage holds none is moved into the private storage on the first read; the legacy
   * one is then cleared either way.
   */
  readonly legacy?: MarkerStore
}

/**
 * The marker in the admin account's XEP-0049 private storage, under `MARKER_STORAGE_KEY`, so it
 * is the same in every admin browser. An empty value is no marker (private storage has no
 * delete). A read that fails counts as a marker of unknown version, so the plan re-checks.
 */
export function privateMarkerStore(
  admin: AdminApi,
  options: PrivateMarkerOptions = {},
): MarkerStore {
  let legacy = options.legacy
  const write = async (marker: PublishMarker): OpsOutcome<void> => {
    const written = await admin.setPrivate(MARKER_STORAGE_KEY, JSON.stringify(marker))
    if (!written.ok) {
      return opsErr('refused', 'storing the publish marker failed', {
        op: 'executePlan',
        step: 'write publish marker',
        cause: written.error,
      })
    }
    return opsOk(undefined)
  }
  return {
    read: async () => {
      const stored = await admin.getPrivate(MARKER_STORAGE_KEY)
      if (!stored.ok) return UNKNOWN_VERSION
      const text = stored.value ?? ''
      if (legacy !== undefined) {
        // One-time migration from browser storage.
        const old = legacy
        const found = await old.read()
        if (text === '' && found !== undefined) {
          const moved = await write(found)
          if (!moved.ok) return found
        }
        await old.clear()
        legacy = undefined
        if (text === '') return found
      }
      return text === '' ? undefined : parseMarker(text)
    },
    write,
    clear: async () => {
      await admin.setPrivate(MARKER_STORAGE_KEY, '')
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
 * A marker in Web Storage under `key` (one per server): where earlier versions kept it, now read
 * only as `privateMarkerStore`'s legacy source. An unreadable value counts as a marker with no
 * version, so everything is re-checked; storage that throws counts as no marker on read and is
 * ignored on write and clear.
 */
export function storageMarkerStore(storage: MarkerStorage, key: string): MarkerStore {
  return {
    read: () => {
      let text: string | null
      try {
        text = storage.getItem(key)
      } catch {
        return Promise.resolve(undefined)
      }
      if (text === null || text === '') return Promise.resolve(undefined)
      return Promise.resolve(parseMarker(text))
    },
    write: (marker) => {
      try {
        storage.setItem(key, JSON.stringify(marker))
      } catch {
        // Quota or blocked storage: the publish goes on without a marker here.
      }
      return Promise.resolve(opsOk(undefined))
    },
    clear: () => {
      try {
        storage.removeItem(key)
      } catch {
        // As above.
      }
      return Promise.resolve()
    },
  }
}

export function parseMarker(text: string): PublishMarker {
  try {
    const parsed = markerSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : UNKNOWN_VERSION
  } catch {
    return UNKNOWN_VERSION
  }
}

export function newMarker(designVersion: number, now: Date): PublishMarker {
  return { format: 'wrx1-publish-pending', designVersion, startedAt: now.toISOString() }
}
