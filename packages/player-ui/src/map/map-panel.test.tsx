// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FORCE, WORLD_ASSET, sampleDesign, sampleWorldState } from '@wrx/schemas/fixtures'
import type { WorldState } from '@wrx/schemas'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { MapPanelCore, rowKeyTarget } from './map-panel.tsx'
import type { MapPanelCoreProps } from './map-panel.tsx'
import { createSymbolCache } from './symbols.ts'
import type { MapTiles } from './tiles.tsx'
import {
  assetBounds,
  assetFields,
  assetRows,
  assetsByForce,
  formatPosition,
  initialView,
} from './view.ts'

afterEach(cleanup)

const forces = sampleDesign().forces
const TILES: MapTiles = {
  url: 'https://tiles.wrx.test/{z}/{x}/{y}.png',
  attribution: '© Test tiles',
  attributionUrl: 'https://tiles.wrx.test/copyright',
  maxZoom: 18,
}

function withoutAsset(state: WorldState, id: string): WorldState['assets'] {
  return Object.fromEntries(Object.entries(state.assets).filter(([key]) => key !== id))
}

function panel(props: Partial<MapPanelCoreProps> = {}) {
  return createElement(MapPanelCore, {
    name: 'Map',
    state: sampleWorldState(),
    loading: false,
    problem: undefined,
    forces,
    tiles: TILES,
    ...props,
  })
}

describe('the map room’s data (PLY-57)', () => {
  it('groups assets by force, in force order, then by title', () => {
    const groups = assetsByForce(sampleWorldState(), forces)
    expect(groups.map((g) => g.name)).toEqual(['Blue', 'Red'])
    expect(groups[0]?.assets.map((a) => a.title)).toEqual([
      '1st Rifles',
      'A Squadron',
      'Recce Troop',
    ])
    const stray = sampleWorldState()
    const asset = stray.assets[WORLD_ASSET.redArmour]
    if (asset !== undefined) asset.forceId = '90000000-0000-4000-8000-000000000009'
    expect(assetsByForce(stray, forces).map((g) => g.name)).toEqual([
      'Blue',
      'Red',
      'Unknown force',
    ])
    expect(groups.some((g) => g.forceId === FORCE.white)).toBe(false)
    expect(assetRows(sampleWorldState(), forces).map((r) => r.forceName)).toEqual([
      'Blue',
      'Blue',
      'Blue',
      'Red',
      'Red',
      'Red',
    ])
  })

  it('opens at the config’s view, else fits the assets (mapRoomConfigSchema)', () => {
    const assets = Object.values(sampleWorldState().assets)
    const bounds = { south: 51.97, west: 5.85, north: 52.035, east: 5.95 }
    expect(assetBounds(assets)).toEqual(bounds)
    expect(assetBounds([])).toBeUndefined()
    const centre = { lat: 52, lon: 5.9 }
    expect(initialView({ schemaVersion: 1, centre, zoom: 11 }, assets)).toEqual({
      kind: 'view',
      centre,
      zoom: 11,
    })
    expect(initialView({ schemaVersion: 1 }, assets)).toEqual({
      kind: 'fit',
      bounds,
      centre: undefined,
      zoom: undefined,
    })
    expect(initialView(undefined, assets)).toMatchObject({ kind: 'fit', bounds })
    expect(initialView({ schemaVersion: 1, centre }, assets)).toEqual({
      kind: 'fit',
      bounds,
      centre,
      zoom: undefined,
    })
    expect(initialView({ schemaVersion: 1, zoom: 9 }, assets)).toEqual({
      kind: 'fit',
      bounds,
      centre: undefined,
      zoom: 9,
    })
    expect(initialView({ schemaVersion: 1 }, [])).toEqual({
      kind: 'world',
      centre: undefined,
      zoom: undefined,
    })
  })

  it('formats an asset’s fields', () => {
    expect(formatPosition({ lat: 51.985, lon: -5.87 })).toBe('51.9850° N, 5.8700° W')
    expect(formatPosition({ lat: -0.5, lon: 0 })).toBe('0.5000° S, 0.0000° E')
    const asset = sampleWorldState().assets[WORLD_ASSET.blueArmour]
    if (asset === undefined) throw new Error('fixture')
    expect(assetFields({ ...asset, health: 62.4, fuel: 7 }, 'Blue')).toEqual([
      ['Force', 'Blue'],
      ['Category', 'armour'],
      ['State', 'operational'],
      ['Health', '62%'],
      ['Fuel', '7%'],
      ['Position', '51.9700° N, 5.8500° E'],
      ['Symbol code', 'SFGPUCA----K---'],
    ])
  })
})

describe('symbols (milsymbol, NFR-7)', () => {
  it('draws each code once, as an SVG data: URL', () => {
    const symbols = createSymbolCache()
    const friend = symbols.image('SFGPUCI----K---')
    expect(friend.url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(friend.url)).toContain('<svg')
    expect(friend.valid).toBe(true)
    expect(friend.width).toBeGreaterThan(10)
    expect(friend.anchorX).toBeGreaterThan(0)
    expect(symbols.image('SFGPUCI----K---')).toBe(friend)
    expect(symbols.size).toBe(1)
    // Number-based (2525D): a friendly land unit, infantry.
    expect(symbols.image('10031000001211000000').valid).toBe(true)
    // A code milsymbol does not know still draws a frame.
    const unknown = symbols.image('SFGPZZZZZZ-----')
    expect(unknown.url).toContain('svg')
  })
})

describe('the map room panel (PLY-57, PLY-59)', () => {
  it('says when there is no world state yet, or while it looks for one', () => {
    const view = render(panel({ state: undefined }))
    expect(view.container.textContent).toContain('The umpire has not published a world state yet.')
    view.rerender(panel({ state: undefined, loading: true }))
    expect(screen.getByRole('status').textContent).toContain('Loading the world state')
    view.rerender(panel({ problem: 'closed: kicked' }))
    expect(view.container.textContent).toContain('This map cannot be shown: closed: kicked')
    // Read-only: no composer, whatever the role.
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the turn and draws one symbol per asset', async () => {
    const view = render(panel())
    expect(screen.getByText(/^World state for turn/).textContent).toBe(
      'World state for turn 1: 6 assets',
    )
    const map = await screen.findByRole('region', { name: /^Map: map of 6 assets/ })
    await expect.poll(() => map.querySelectorAll('img.wrx-map__symbol').length).toBe(6)
    const ids = [...map.querySelectorAll('img.wrx-map__symbol')].map((img) =>
      img.getAttribute('data-asset'),
    )
    expect(new Set(ids)).toEqual(new Set(Object.keys(sampleWorldState().assets)))
    expect(screen.getByRole('link', { name: '© Test tiles' }).getAttribute('href')).toBe(
      'https://tiles.wrx.test/copyright',
    )
    expect(screen.queryByRole('textbox')).toBeNull()

    // A newer state replaces it live: one asset gone, one moved.
    const next: WorldState = sampleWorldState()
    next.turn = 2
    next.assets = withoutAsset(next, WORLD_ASSET.redArtillery)
    const moved = next.assets[WORLD_ASSET.blueRecce]
    if (moved !== undefined) moved.lat = 52.1
    view.rerender(panel({ state: next }))
    expect(screen.getByText(/^World state for turn/).textContent).toBe(
      'World state for turn 2: 5 assets',
    )
    await expect.poll(() => map.querySelectorAll('img.wrx-map__symbol').length).toBe(5)
  })

  it('selects an asset from the table, shows its fields, and clears with Escape', async () => {
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(7)
    const pick = within(table).getByRole('button', { name: 'Tank Company' })
    fireEvent.click(pick)
    expect(pick.getAttribute('aria-pressed')).toBe('true')
    const details = screen.getByRole('region', { name: 'Asset details' })
    expect(within(details).getByRole('heading').textContent).toBe('Tank Company')
    expect(details.textContent).toContain('ForceRed')
    expect(details.textContent).toContain('Symbol codeSHGPUCA----K---')
    fireEvent.keyDown(pick, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Asset details' })).toBeNull()

    // A selected symbol on the map is outlined; "Show on map" switches back to it.
    fireEvent.click(pick)
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }))
    expect(screen.queryByRole('table')).toBeNull()
    const map = await screen.findByRole('region', { name: /^Map: map of/ })
    await expect
      .poll(() => map.querySelector('img.wrx-map__symbol--selected')?.getAttribute('data-asset'))
      .toBe(WORLD_ASSET.redArmour)
  })

  it('gives the table one Tab stop; the arrow keys move between rows (A2, WP 5.9)', () => {
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const table = screen.getByRole('table')
    const picks = within(table).getAllByRole('button')
    const stops = () => picks.filter((b) => b.tabIndex === 0)
    expect(picks).toHaveLength(6)
    expect(stops()).toEqual([picks[0]])
    picks[0]?.focus()
    fireEvent.keyDown(picks[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(picks[1])
    expect(stops()).toEqual([picks[1]])
    fireEvent.keyDown(picks[1]!, { key: 'End' })
    expect(document.activeElement).toBe(picks[5])
    fireEvent.keyDown(picks[5]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(picks[5])
    fireEvent.keyDown(picks[5]!, { key: 'Home' })
    expect(document.activeElement).toBe(picks[0])
    fireEvent.keyDown(picks[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(picks[0])
    // Selecting a row keeps it the stop.
    fireEvent.click(picks[3]!)
    expect(stops()).toEqual([picks[3]])
  })

  it('moves by rows, pages and ends', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `a${String(i)}`)
    expect(rowKeyTarget('ArrowDown', ids, 'a0')).toBe('a1')
    expect(rowKeyTarget('PageDown', ids, 'a0')).toBe('a10')
    expect(rowKeyTarget('PageDown', ids, 'a20')).toBe('a24')
    expect(rowKeyTarget('PageUp', ids, 'a5')).toBe('a0')
    expect(rowKeyTarget('End', ids, 'a3')).toBe('a24')
    expect(rowKeyTarget('Enter', ids, 'a3')).toBeUndefined()
    expect(rowKeyTarget('ArrowDown', [], undefined)).toBeUndefined()
  })

  it('drops a selection the newer state no longer holds', () => {
    const view = render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Artillery Battery' }))
    expect(screen.getByRole('region', { name: 'Asset details' })).toBeTruthy()
    const next = sampleWorldState()
    next.assets = withoutAsset(next, WORLD_ASSET.redArtillery)
    act(() => {
      view.rerender(panel({ state: next }))
    })
    expect(screen.queryByRole('region', { name: 'Asset details' })).toBeNull()
  })

  it('says so when the deployment has no base map', () => {
    render(panel({ tiles: undefined }))
    expect(screen.getByText(/No base map is configured for this deployment/).textContent).toContain(
      'plain background',
    )
    expect(screen.queryByRole('link')).toBeNull()
  })
})
