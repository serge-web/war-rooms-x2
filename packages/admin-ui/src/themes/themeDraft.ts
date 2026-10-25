// Theme operations on the admin's draft (WP 2.8, ADM-18–21). Framework-free and immutable, like
// `draft.ts`: each returns a new draft, and an unknown target leaves the draft unchanged.
// Images go into `design.assets` and themes refer to them by id (§3 rule 12). An asset that no
// theme or force icon refers to any more is removed, so replaced logos don't pile up.
import { byOrderThenId } from '@wrx/domain'
import type { Asset, DesignFile, Force, Room, Theme, ThemeTokens } from '@wrx/schemas'
import { isEmptyTheme, resolveTheme } from '@wrx/theme'
import type { ResolvedTheme, TokenName } from '@wrx/theme'
import type { Draft } from '../draft/index.ts'
import { slugify, uniqueSlug } from '../draft/index.ts'

export type ThemeTarget =
  | { readonly kind: 'game' }
  | { readonly kind: 'force'; readonly id: string }
  | { readonly kind: 'room'; readonly id: string }

export type ThemeImage = 'logo' | 'icon'

const IMAGE_FIELD = { logo: 'logoAssetId', icon: 'iconAssetId' } as const

export const GAME_TARGET: ThemeTarget = Object.freeze({ kind: 'game' })

/** `game`, `force:<id>` or `room:<id>`: a target as one string, for selects and state. */
export function targetKey(target: ThemeTarget): string {
  return target.kind === 'game' ? 'game' : `${target.kind}:${target.id}`
}

/** The target a key names, if it still exists in the design. */
export function targetFromKey(design: DesignFile, key: string): ThemeTarget | undefined {
  return themeTargets(design).find((t) => t.key === key)?.target
}

export interface ThemeTargetOption {
  readonly key: string
  readonly target: ThemeTarget
  readonly label: string
}

/** Every theme the admin can edit: the game's, then each force's and room's in display order. */
export function themeTargets(design: DesignFile): ThemeTargetOption[] {
  return [
    { key: 'game', target: GAME_TARGET, label: 'Game theme (welcome page and default)' },
    ...[...design.forces].sort(byOrderThenId).map((f) => ({
      key: `force:${f.id}`,
      target: { kind: 'force' as const, id: f.id },
      label: `Force: ${f.name}`,
    })),
    ...[...design.rooms].sort(byOrderThenId).map((r) => ({
      key: `room:${r.id}`,
      target: { kind: 'room' as const, id: r.id },
      label: `Room: ${r.name}`,
    })),
  ]
}

/** The target's own theme, before inheritance. */
export function themeOf(design: DesignFile, target: ThemeTarget): Theme | undefined {
  switch (target.kind) {
    case 'game':
      return design.game.theme
    case 'force':
      return design.forces.find((f) => f.id === target.id)?.theme
    case 'room':
      return design.rooms.find((r) => r.id === target.id)?.theme
  }
}

/** The target's theme after inheritance (§3 rule 11). */
export function resolvedThemeOf(design: DesignFile, target: ThemeTarget): ResolvedTheme {
  const own = themeOf(design, target)
  return target.kind === 'game' ? resolveTheme(own) : resolveTheme(own, design.game.theme)
}

/** Where the target's theme sits in the design, as `checkDesign` paths name it. */
export function themePath(design: DesignFile, target: ThemeTarget): string | undefined {
  if (target.kind === 'game') return 'game.theme'
  const list = target.kind === 'force' ? design.forces : design.rooms
  const i = list.findIndex((item) => item.id === target.id)
  return i === -1 ? undefined : `${target.kind === 'force' ? 'forces' : 'rooms'}[${i}].theme`
}

/**
 * Replaces the target's own theme. For a force or room, an empty theme is removed, so it
 * inherits; the game always keeps a theme (its schema requires one).
 */
export function setTheme(draft: Draft, target: ThemeTarget, theme: Theme | undefined): Draft {
  const design = draft.design
  const previous = themeOf(design, target)
  let next: DesignFile
  if (target.kind === 'game') {
    next = { ...design, game: { ...design.game, theme: theme ?? { tokens: {} } } }
  } else {
    const kept = theme !== undefined && !isEmptyTheme(theme) ? theme : undefined
    if (target.kind === 'force') {
      if (!design.forces.some((f) => f.id === target.id)) return draft
      const forces = design.forces.map((f): Force => {
        if (f.id !== target.id) return f
        const { theme: _old, ...rest } = f
        return kept === undefined ? rest : { ...rest, theme: kept }
      })
      next = { ...design, forces }
    } else {
      if (!design.rooms.some((r) => r.id === target.id)) return draft
      const rooms = design.rooms.map((r): Room => {
        if (r.id !== target.id) return r
        const { theme: _old, ...rest } = r
        return kept === undefined ? rest : { ...rest, theme: kept }
      })
      next = { ...design, rooms }
    }
  }
  const released = [previous?.logoAssetId, previous?.iconAssetId]
  return pruneAssets({ ...draft, design: next }, released)
}

/** Sets one token on the target's own theme; `undefined` clears it, so it inherits. */
export function setThemeToken(
  draft: Draft,
  target: ThemeTarget,
  token: TokenName,
  value: string | undefined,
): Draft {
  const own = themeOf(draft.design, target) ?? { tokens: {} }
  const { [token]: previous, ...rest } = own.tokens
  let tokens: ThemeTokens = rest
  if (token === 'fontFamily' && value !== undefined) {
    if (value !== 'sans' && value !== 'serif' && value !== 'mono') return draft
    tokens = { ...rest, fontFamily: value }
  } else if (value !== undefined) {
    tokens = { ...rest, [token]: value.toLowerCase() }
  }
  if (value === undefined && previous === undefined) return draft
  return setTheme(draft, target, { ...own, tokens })
}

/** Sets or clears the target's own logo or icon. */
export function setThemeImage(
  draft: Draft,
  target: ThemeTarget,
  image: ThemeImage,
  assetId: string | undefined,
): Draft {
  const field = IMAGE_FIELD[image]
  const { [field]: _previous, ...own } = themeOf(draft.design, target) ?? { tokens: {} }
  return setTheme(draft, target, assetId === undefined ? own : { ...own, [field]: assetId })
}

/**
 * Copies `from`'s own theme to `to` (ADM-21), replacing it. Copying into the game theme is not
 * offered: it would make the source's images public (§3 rule 15).
 */
export function copyTheme(draft: Draft, from: ThemeTarget, to: ThemeTarget): Draft {
  if (to.kind === 'game' || targetKey(from) === targetKey(to)) return draft
  const source = themeOf(draft.design, from)
  return setTheme(draft, to, source === undefined ? undefined : structuredClone(source))
}

/** Resets the target to inherit everything (ADM-21); for the game, to the built-in default. */
export function resetTheme(draft: Draft, target: ThemeTarget): Draft {
  return setTheme(draft, target, undefined)
}

/** A fresh asset id for the target's logo or icon, e.g. `force-blue-logo`. */
export function newAssetId(design: DesignFile, target: ThemeTarget, image: ThemeImage): string {
  const base =
    target.kind === 'game'
      ? `game-${image}`
      : slugify(`${target.kind}-${target.id}-${image}`, image)
  return uniqueSlug(base, new Set(design.assets.map((a) => a.id)))
}

/** Adds an asset, replacing any asset with the same id. */
export function putAsset(draft: Draft, asset: Asset): Draft {
  const assets = [...draft.design.assets.filter((a) => a.id !== asset.id), asset]
  return { ...draft, design: { ...draft.design, assets } }
}

export function assetById(design: DesignFile, id: string | undefined): Asset | undefined {
  return id === undefined ? undefined : design.assets.find((a) => a.id === id)
}

/** Ids of assets referred to by any theme or force icon. */
export function referencedAssetIds(design: DesignFile): Set<string> {
  const ids = new Set<string>()
  const add = (id: string | undefined) => {
    if (id !== undefined) ids.add(id)
  }
  const addTheme = (theme: Theme | undefined) => {
    add(theme?.logoAssetId)
    add(theme?.iconAssetId)
  }
  addTheme(design.game.theme)
  for (const f of design.forces) {
    add(f.iconAssetId)
    addTheme(f.theme)
  }
  for (const r of design.rooms) addTheme(r.theme)
  return ids
}

/** Removes the given assets if nothing refers to them any more. */
function pruneAssets(draft: Draft, candidates: readonly (string | undefined)[]): Draft {
  const used = referencedAssetIds(draft.design)
  const drop = new Set(candidates.filter((id): id is string => id !== undefined && !used.has(id)))
  if (drop.size === 0) return draft
  const assets = draft.design.assets.filter((a) => !drop.has(a.id))
  if (assets.length === draft.design.assets.length) return draft
  return { ...draft, design: { ...draft.design, assets } }
}
