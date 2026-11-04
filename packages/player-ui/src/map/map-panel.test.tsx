// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { FORCE, WORLD_ASSET, sampleDesign, sampleWorldState } from '@wrx/schemas/fixtures'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { MapPanelCore, assetsByForce } from './map-panel.tsx'

afterEach(cleanup)

const forces = sampleDesign().forces

describe('the map room placeholder (WP 5.2, until WP 5.5)', () => {
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
  })

  it('shows the turn and the assets, or says there is none yet', () => {
    const view = render(
      createElement(MapPanelCore, {
        name: 'Map',
        state: sampleWorldState(),
        loading: false,
        problem: undefined,
        forces,
      }),
    )
    expect(view.container.textContent).toContain('World state for turn 1: 6 assets.')
    expect(screen.getByRole('region', { name: 'Blue' }).textContent).toContain(
      'A Squadron (armour), operational: health 100, fuel 100',
    )
    view.rerender(
      createElement(MapPanelCore, {
        name: 'Map',
        state: undefined,
        loading: false,
        problem: undefined,
        forces,
      }),
    )
    expect(view.container.textContent).toContain('The umpire has not published a world state yet.')
  })
})
