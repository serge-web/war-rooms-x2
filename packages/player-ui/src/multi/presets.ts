// Named demo presets for the multi-client view (PLY-19): the pane count, arrangement and each
// pane's login, kept in browser storage under the host's key (DOC-10). A login is the role id
// only, never a password (NFR-1): on the mock a preset logs back in with the demo password
// (NFR-6); on a real server it fills in the role id and waits for the password.
import type { StorageLike } from '../workspace/storage.ts'

export type PaneCount = 2 | 3 | 4
export type PaneArrangement = 'row' | 'grid'
export type PaneKind = 'player' | 'admin'

export interface PanePreset {
  readonly kind: PaneKind
  /** The role id the pane was logged in as, if any (`admin` for the admin's game view). */
  readonly roleId?: string | undefined
}

export interface MultiPreset {
  readonly name: string
  readonly count: PaneCount
  readonly arrangement: PaneArrangement
  readonly panes: readonly PanePreset[]
}

export interface PresetStorage {
  load(): readonly MultiPreset[]
  /** Saves the whole list; false when storage refused it. */
  save(presets: readonly MultiPreset[]): boolean
}

const FORMAT = 1
const MAX_PRESETS = 50
const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPaneCount(value: unknown): value is PaneCount {
  return value === 2 || value === 3 || value === 4
}

function parsePane(value: unknown): PanePreset | undefined {
  if (!isRecord(value)) return undefined
  const kind = value.kind
  if (kind !== 'player' && kind !== 'admin') return undefined
  const roleId = value.roleId
  if (roleId === undefined) return { kind }
  if (typeof roleId !== 'string' || !ROLE_ID.test(roleId)) return undefined
  return { kind, roleId }
}

/** One preset from storage, which nothing trusts: anything malformed is dropped. */
export function parsePreset(value: unknown): MultiPreset | undefined {
  if (!isRecord(value)) return undefined
  const { name, count, arrangement, panes } = value
  if (typeof name !== 'string' || name.trim() === '' || name.length > 80) return undefined
  if (!isPaneCount(count)) return undefined
  if (arrangement !== 'row' && arrangement !== 'grid') return undefined
  if (!Array.isArray(panes) || panes.length !== count) return undefined
  const parsed = panes.map(parsePane)
  if (parsed.some((p) => p === undefined)) return undefined
  return {
    name: name.trim(),
    count,
    arrangement,
    panes: parsed.filter((p): p is PanePreset => p !== undefined),
  }
}

export function parsePresets(json: string | null | undefined): readonly MultiPreset[] {
  if (json === null || json === undefined) return []
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return []
  }
  if (!isRecord(value) || value.format !== FORMAT || !Array.isArray(value.presets)) return []
  const presets: MultiPreset[] = []
  for (const entry of value.presets.slice(0, MAX_PRESETS)) {
    const preset = parsePreset(entry)
    if (preset !== undefined && !presets.some((p) => p.name === preset.name)) presets.push(preset)
  }
  return presets
}

export function serialisePresets(presets: readonly MultiPreset[]): string {
  return JSON.stringify({ format: FORMAT, presets: presets.slice(0, MAX_PRESETS) })
}

/** Adds or replaces (by name) a preset, keeping the list sorted by name. */
export function withPreset(
  presets: readonly MultiPreset[],
  preset: MultiPreset,
): readonly MultiPreset[] {
  return [...presets.filter((p) => p.name !== preset.name), preset].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

/** Presets in web storage, e.g. `webPresetStorage(() => localStorage, key)`. */
export function webPresetStorage(storage: () => StorageLike, key: string): PresetStorage {
  return {
    load: () => {
      try {
        return parsePresets(storage().getItem(key))
      } catch {
        return []
      }
    },
    save: (presets) => {
      try {
        storage().setItem(key, serialisePresets(presets))
        return true
      } catch {
        return false
      }
    },
  }
}

/** Presets that last until the page closes; for tests and when storage is blocked. */
export function memoryPresetStorage(initial: readonly MultiPreset[] = []): PresetStorage {
  let saved = serialisePresets(initial)
  return {
    load: () => parsePresets(saved),
    save: (presets) => {
      saved = serialisePresets(presets)
      return true
    },
  }
}
