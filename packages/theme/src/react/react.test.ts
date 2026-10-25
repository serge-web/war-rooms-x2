// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import type { SessionStore } from '@wrx/domain'
import { force, game, harness, room } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import { nodeName } from '@wrx/schemas'
import { pixelAsset } from '@wrx/schemas/fixtures'
import { StrictMode, createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_TOKENS, fontStack, themeProperties } from '../index.ts'
import { AssetImage, AssetImageCore } from './AssetImage.tsx'
import { ForceThemeScope, GameThemeScope, RoomThemeScope } from './scopes.tsx'
import { ThemeScope } from './ThemeScope.tsx'

// Testing Library's automatic cleanup needs test globals, which this repo does not enable.
afterEach(cleanup)

const h = createElement

function inStore(store: SessionStore, children: ReactNode) {
  return h(StrictMode, null, h(SessionStoreProvider, { store }, children))
}

const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name)
const byId = (id: string) => {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`#${id} is missing`)
  return el
}

async function ready() {
  const harnessed = harness()
  await harnessed.store.ready()
  return harnessed
}

describe('ThemeScope (PLY-26)', () => {
  it('sets every --wrx-* property on its own root only', () => {
    const tokens = { ...DEFAULT_TOKENS, primary: '#123456', fontFamily: 'serif' as const }
    render(
      h(
        'div',
        { id: 'outside' },
        h(ThemeScope, { tokens, id: 'a' }, h('p', null, 'inside a')),
        h(ThemeScope, { tokens: DEFAULT_TOKENS, id: 'b', as: 'section' }),
      ),
    )
    const a = byId('a')
    for (const [name, value] of Object.entries(themeProperties(tokens))) {
      expect(prop(a, name)).toBe(value)
    }
    expect(prop(a, '--wrx-font-family')).toBe(fontStack('serif'))
    expect(prop(byId('b'), '--wrx-primary')).toBe(DEFAULT_TOKENS.primary)
    expect(byId('b').tagName).toBe('SECTION')
    expect(prop(byId('outside'), '--wrx-primary')).toBe('')
    expect(screen.getByText('inside a').getAttribute('style')).toBeNull()
  })
})

describe('live themes from the store (ADM-22, PLY-24)', () => {
  it('restyles a room panel when its room or the game theme is republished', async () => {
    const hs = await ready()
    render(inStore(hs.store, h(RoomThemeScope, { roomId: 'blue-hq', id: 'room' })))
    const panel = byId('room')
    expect(prop(panel, '--wrx-primary')).toBe(DEFAULT_TOKENS.primary)

    act(() => {
      hs.publish('game-setup', { ...game(), theme: { tokens: { primary: '#aa0000' } } })
    })
    expect(prop(panel, '--wrx-primary')).toBe('#aa0000')

    const blueHq = room('blue-hq', [{ kind: 'force', id: 'blue', access: 'write' }], {
      theme: { tokens: { primary: '#00aa00', text: '#000000' } },
    })
    act(() => {
      hs.publish(nodeName.room('blue-hq'), blueHq)
    })
    expect(prop(panel, '--wrx-primary')).toBe('#00aa00')
    expect(prop(panel, '--wrx-text')).toBe('#000000')
  })

  it('themes a force panel from the force, inheriting the game theme', async () => {
    const hs = await ready()
    render(
      inStore(
        hs.store,
        h(
          'div',
          null,
          h(GameThemeScope, { id: 'game' }),
          h(ForceThemeScope, { forceId: 'blue', id: 'force' }),
        ),
      ),
    )
    act(() => {
      hs.publish('game-setup', { ...game(), theme: { tokens: { surface: '#eeeeee' } } })
      hs.publish(
        nodeName.force('blue'),
        force('blue', { theme: { tokens: { primary: '#0000aa', fontFamily: 'mono' } } }),
      )
    })
    const forcePanel = byId('force')
    expect(prop(forcePanel, '--wrx-primary')).toBe('#0000aa')
    expect(prop(forcePanel, '--wrx-surface')).toBe('#eeeeee')
    expect(prop(forcePanel, '--wrx-font-family')).toBe(fontStack('mono'))
    expect(prop(byId('game'), '--wrx-primary')).toBe(DEFAULT_TOKENS.primary)
  })

  it('themes each pane from its own store', async () => {
    const one = await ready()
    const two = await ready()
    two.publish(nodeName.room('blue-hq'), {
      ...room('blue-hq', [{ kind: 'force', id: 'blue', access: 'write' }]),
      theme: { tokens: { primary: '#654321' } },
    })
    render(
      h(
        'div',
        null,
        inStore(one.store, h(RoomThemeScope, { roomId: 'blue-hq', id: 'pane-1' })),
        inStore(two.store, h(RoomThemeScope, { roomId: 'blue-hq', id: 'pane-2' })),
      ),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(prop(byId('pane-1'), '--wrx-primary')).toBe(DEFAULT_TOKENS.primary)
    expect(prop(byId('pane-2'), '--wrx-primary')).toBe('#654321')
  })
})

describe('AssetImage (§3 rule 12)', () => {
  it('renders an <img> from a data URL', () => {
    const asset = pixelAsset('logo')
    render(h(AssetImageCore, { asset, alt: 'Logo' }))
    const img = screen.getByRole('img', { name: 'Logo' })
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe(`data:image/png;base64,${asset.data}`)
  })

  it('fetches the asset from the store, and renders nothing without one', async () => {
    const hs = harness()
    hs.docs.set(nodeName.asset('logo'), [{ ...pixelAsset('logo') }])
    await hs.store.ready()
    const { container } = render(
      inStore(
        hs.store,
        h(
          'div',
          null,
          h(AssetImage, { assetId: 'logo', alt: 'Game logo' }),
          h(AssetImage, {
            assetId: undefined,
            alt: 'none',
          }),
        ),
      ),
    )
    expect(await screen.findByRole('img', { name: 'Game logo' })).toBeTruthy()
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('svg')).toBeNull()
  })
})
