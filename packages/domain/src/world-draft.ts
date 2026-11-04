// The admin's world-state draft (ADM-44, ADM-45, ADM-46, R25; WP 5.6), as plain data: the
// operations the editor applies to a world state, the change summary between the published state
// and the draft, the size check before a publish (PLY-53), and the form the draft is stored in,
// in the admin's browser only. Framework-free and immutable: every operation returns a new state
// and leaves its input untouched.
import { LIMITS, worldAssetSchema, worldStateSchema } from '@wrx/schemas'
import type { Result, WorldAsset, WorldState } from '@wrx/schemas'
import { z } from 'zod'
import { fitsWorldStateStanza } from './size.ts'

/** The fixed asset fields (§3 rule 17), in the order the editor and the summary show them. */
export const WORLD_ASSET_FIELDS = Object.freeze([
  'title',
  'forceId',
  'category',
  'sidc',
  'lat',
  'lon',
  'state',
  'health',
  'fuel',
] as const satisfies readonly (keyof WorldAsset)[])

export type WorldAssetField = (typeof WORLD_ASSET_FIELDS)[number]

/** What an edit may change: any fixed field but the id. */
export type WorldAssetPatch = Partial<Pick<WorldAsset, WorldAssetField>>

/** Why an edit was refused, in words the editor shows. */
export type WorldEditResult = Result<WorldState, string>

/** An empty world state for a turn, from which the admin can set up the starting state. */
export function emptyWorldState(turn = 1): WorldState {
  return { turn, assets: {} }
}

function checked(asset: unknown): Result<WorldAsset, string> {
  const parsed = worldAssetSchema.safeParse(asset)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  const where = issue?.path.join('.') ?? ''
  return { ok: false, error: `${where === '' ? '' : `${where}: `}${issue?.message ?? 'invalid'}` }
}

/** Adds an asset; refused if it is invalid, its id is taken, or the state is full. */
export function addWorldAsset(state: WorldState, asset: WorldAsset): WorldEditResult {
  if (state.assets[asset.id] !== undefined) return { ok: false, error: 'the id is taken' }
  if (Object.keys(state.assets).length >= LIMITS.worldStateAssets) {
    return { ok: false, error: `a world state holds at most ${LIMITS.worldStateAssets} assets` }
  }
  const valid = checked(asset)
  if (!valid.ok) return valid
  return { ok: true, value: { ...state, assets: { ...state.assets, [asset.id]: valid.value } } }
}

/** Changes an asset's fields; refused for an unknown id or a value the schema refuses. */
export function updateWorldAsset(
  state: WorldState,
  id: string,
  patch: WorldAssetPatch,
): WorldEditResult {
  const before = state.assets[id]
  if (before === undefined) return { ok: false, error: 'no such asset' }
  const valid = checked({ ...before, ...patch, id })
  if (!valid.ok) return valid
  return { ok: true, value: { ...state, assets: { ...state.assets, [id]: valid.value } } }
}

/** Decimal places a dragged position keeps: about 0.1 m, and short in the message. */
const POSITION_PLACES = 6

/** A position from the map: longitude wrapped into −180 to 180, latitude clamped, rounded. */
export function normalisePosition(lat: number, lon: number): { lat: number; lon: number } {
  const round = (n: number) => Number(n.toFixed(POSITION_PLACES))
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180
  return { lat: round(Math.max(-90, Math.min(90, lat))), lon: round(wrapped) }
}

/** Moves an asset (a drag on the map): the position normalised, as `normalisePosition`. */
export function moveWorldAsset(
  state: WorldState,
  id: string,
  lat: number,
  lon: number,
): WorldEditResult {
  return updateWorldAsset(state, id, normalisePosition(lat, lon))
}

/** Removes an asset; refused for an unknown id. */
export function removeWorldAsset(state: WorldState, id: string): WorldEditResult {
  if (state.assets[id] === undefined) return { ok: false, error: 'no such asset' }
  const assets = Object.fromEntries(Object.entries(state.assets).filter(([key]) => key !== id))
  return { ok: true, value: { ...state, assets } }
}

/** An asset whose fields changed, and which (ADM-46). */
export interface WorldAssetChange {
  readonly before: WorldAsset
  readonly after: WorldAsset
  readonly fields: readonly WorldAssetField[]
}

/** The change summary from one world state to another (ADM-46), each list by title. */
export interface WorldStateDiff {
  readonly added: readonly WorldAsset[]
  readonly removed: readonly WorldAsset[]
  readonly changed: readonly WorldAssetChange[]
}

const byTitle = (a: WorldAsset, b: WorldAsset) =>
  a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * What publishing `draft` over `published` changes, asset by asset (ADM-46). Only the assets are
 * compared: the turn is stamped when the state is published, so a new turn alone is no change.
 * With nothing published, every asset is added.
 */
export function diffWorldStates(
  published: WorldState | undefined,
  draft: WorldState,
): WorldStateDiff {
  const before = published?.assets ?? {}
  const added: WorldAsset[] = []
  const changed: WorldAssetChange[] = []
  for (const asset of Object.values(draft.assets)) {
    const old = before[asset.id]
    if (old === undefined) {
      added.push(asset)
      continue
    }
    const fields = WORLD_ASSET_FIELDS.filter((field) => old[field] !== asset[field])
    if (fields.length > 0) changed.push({ before: old, after: asset, fields })
  }
  const removed = Object.values(before).filter((asset) => draft.assets[asset.id] === undefined)
  return {
    added: added.sort(byTitle),
    removed: removed.sort(byTitle),
    changed: changed.sort((a, b) => byTitle(a.after, b.after)),
  }
}

/** How many assets a diff touches. */
export function diffSize(diff: WorldStateDiff): number {
  return diff.added.length + diff.removed.length + diff.changed.length
}

/** True when publishing would change no asset (ADM-45: publish only if the draft differs). */
export function isEmptyDiff(diff: WorldStateDiff): boolean {
  return diffSize(diff) === 0
}

/** The map-room message a world state is published as (D25), as `sendWorldState` sends it. */
export function worldStateMessage(state: WorldState): string {
  return JSON.stringify({ type: 'world-state', schemaVersion: 1, content: state })
}

/** Whether a world state fits the 500 KB map-room cap as a message (PLY-53), and its size. */
export function worldStateSize(state: WorldState): {
  ok: boolean
  bytes: number
  limitBytes: number
} {
  return fitsWorldStateStanza(worldStateMessage(state))
}

/** "12.3 KB": a size in kilobytes of 1,000 bytes, as the 500 KB cap is stated. */
export function formatKilobytes(bytes: number): string {
  const kb = bytes / 1000
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb).toLocaleString('en-GB')} KB`
}

/** The stored draft's format and version. */
export const WORLD_DRAFT_FORMAT = 'wrx1-world-draft'
export const WORLD_DRAFT_VERSION = 1

/** The admin's draft as kept in this browser (ADM-45, R25). */
export interface WorldDraft {
  readonly state: WorldState
  /** The stanza-id of the published state it started from; undefined if none was published. */
  readonly baseStanzaId: string | undefined
  /** When it was last saved, by this browser's clock (display only). */
  readonly savedAt: string
}

const storedWorldDraftSchema = z.object({
  format: z.literal(WORLD_DRAFT_FORMAT),
  schemaVersion: z.literal(WORLD_DRAFT_VERSION),
  state: worldStateSchema,
  baseStanzaId: z.string().max(200).optional(),
  savedAt: z.string().max(40),
})

export function serialiseWorldDraft(draft: WorldDraft): string {
  return JSON.stringify({
    format: WORLD_DRAFT_FORMAT,
    schemaVersion: WORLD_DRAFT_VERSION,
    state: draft.state,
    ...(draft.baseStanzaId === undefined ? {} : { baseStanzaId: draft.baseStanzaId }),
    savedAt: draft.savedAt,
  })
}

/** Reads a stored draft; fails, without throwing, on text that is not a valid one. */
export function parseWorldDraft(text: string): Result<WorldDraft, string> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'the saved world-state draft is not valid JSON' }
  }
  const parsed = storedWorldDraftSchema.safeParse(json)
  if (!parsed.success) {
    return { ok: false, error: 'the saved world-state draft is not readable' }
  }
  return {
    ok: true,
    value: {
      state: parsed.data.state,
      baseStanzaId: parsed.data.baseStanzaId,
      savedAt: parsed.data.savedAt,
    },
  }
}

/**
 * The logical key of a game's draft: per server and per map room, the game's one map room
 * (§3 rule 18), so each game on each server has its own. The host puts it under the
 * deployment's namespace (DOC-10). Bump `v1` only if the stored format changes.
 */
export function worldDraftKey(server: string, mapRoomId: string): string {
  return `world-draft:v1:${server}:${mapRoomId}`
}
