import { pixelAsset, sampleDesign } from '@wrx/schemas/fixtures'
import { describe, expect, it } from 'vitest'
import { draftFromDesign, validateDraft } from '../draft/index.ts'
import {
  GAME_TARGET,
  copyTheme,
  newAssetId,
  putAsset,
  referencedAssetIds,
  resetTheme,
  resolvedThemeOf,
  setThemeImage,
  setThemeToken,
  targetFromKey,
  themeOf,
  themePath,
  themeTargets,
} from './themeDraft.ts'

const blue = { kind: 'force', id: 'blue' } as const
const red = { kind: 'force', id: 'red' } as const

function draft() {
  return draftFromDesign(sampleDesign())
}

describe('theme targets', () => {
  it('lists the game, then forces and rooms in order', () => {
    const d = draft()
    const keys = themeTargets(d.design).map((t) => t.key)
    expect(keys[0]).toBe('game')
    expect(keys).toContain('force:blue')
    expect(keys.some((k) => k.startsWith('room:'))).toBe(true)
    expect(targetFromKey(d.design, 'force:blue')).toEqual(blue)
    expect(targetFromKey(d.design, 'force:nope')).toBeUndefined()
    expect(themePath(d.design, GAME_TARGET)).toBe('game.theme')
    expect(themePath(d.design, blue)).toMatch(/^forces\[\d\]\.theme$/)
  })
})

describe('editing tokens (ADM-18)', () => {
  it('sets and clears a token on a force, which then inherits from the game', () => {
    const before = draft()
    const set = setThemeToken(before, blue, 'primary', '#ABCDEF')
    expect(themeOf(set.design, blue)?.tokens.primary).toBe('#abcdef')
    expect(resolvedThemeOf(set.design, blue).sources.primary).toBe('own')
    expect(themeOf(before.design, blue)).toBeUndefined()

    const cleared = setThemeToken(set, blue, 'primary', undefined)
    expect(themeOf(cleared.design, blue)).toBeUndefined()
    expect(resolvedThemeOf(cleared.design, blue).tokens.primary).toBe(
      before.design.game.theme.tokens.primary,
    )
    expect(validateDraft(cleared.design).errorCount).toBe(0)
  })

  it('keeps a theme object on the game even when emptied', () => {
    const d = resetTheme(draft(), GAME_TARGET)
    expect(d.design.game.theme).toEqual({ tokens: {} })
  })

  it('sets the font only to a bundled id', () => {
    const d = setThemeToken(draft(), blue, 'fontFamily', 'mono')
    expect(themeOf(d.design, blue)?.tokens.fontFamily).toBe('mono')
    expect(setThemeToken(d, blue, 'fontFamily', 'comic')).toEqual(d)
  })
})

describe('images (§3 rule 12)', () => {
  it('stores an asset and references it by id; replacing removes the orphan', () => {
    let d = draft()
    const id = newAssetId(d.design, blue, 'logo')
    expect(id).toBe('force-blue-logo')
    d = setThemeImage(putAsset(d, pixelAsset(id)), blue, 'logo', id)
    expect(themeOf(d.design, blue)?.logoAssetId).toBe(id)
    expect(d.design.assets.map((a) => a.id)).toContain(id)
    expect(validateDraft(d.design).errorCount).toBe(0)

    const second = newAssetId(d.design, blue, 'logo')
    expect(second).toBe('force-blue-logo-2')
    d = setThemeImage(putAsset(d, pixelAsset(second)), blue, 'logo', second)
    expect(d.design.assets.map((a) => a.id)).not.toContain(id)

    d = setThemeImage(d, blue, 'logo', undefined)
    expect(d.design.assets.map((a) => a.id)).not.toContain(second)
    expect(themeOf(d.design, blue)).toBeUndefined()
  })

  it('keeps an asset that something else still uses', () => {
    let d = setThemeImage(draft(), blue, 'icon', 'game-logo')
    d = setThemeImage(d, blue, 'icon', undefined)
    expect(d.design.assets.map((a) => a.id)).toContain('game-logo')
    expect(referencedAssetIds(d.design).has('game-logo')).toBe(true)
  })
})

describe('copy and reset (ADM-21)', () => {
  it('copies a force theme to another force, independently', () => {
    let d = setThemeToken(draft(), blue, 'text', '#000000')
    d = copyTheme(d, blue, red)
    expect(themeOf(d.design, red)).toEqual(themeOf(d.design, blue))
    d = setThemeToken(d, red, 'text', '#111111')
    expect(themeOf(d.design, blue)?.tokens.text).toBe('#000000')
  })

  it('never copies into the game theme', () => {
    const d = setThemeToken(draft(), blue, 'text', '#000000')
    expect(copyTheme(d, blue, GAME_TARGET)).toBe(d)
  })

  it('resets a force to inherit, removing its own images', () => {
    let d = putAsset(draft(), pixelAsset('force-blue-icon'))
    d = setThemeImage(d, blue, 'icon', 'force-blue-icon')
    d = setThemeToken(d, blue, 'surface', '#eeeeee')
    d = resetTheme(d, blue)
    expect(themeOf(d.design, blue)).toBeUndefined()
    expect(d.design.assets.map((a) => a.id)).not.toContain('force-blue-icon')
  })
})
