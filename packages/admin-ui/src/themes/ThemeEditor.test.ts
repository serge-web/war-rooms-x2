// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import type { AdminEditor, PlayerPanel } from '@wrx/hooks'
import { sampleDesign } from '@wrx/schemas/fixtures'
import { base64ToBytes } from '@wrx/theme'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminApp } from '../AdminApp.tsx'
import { createDraftStore, draftFromDesign, memoryDraftPersistence } from '../draft/index.ts'
import type { Draft } from '../draft/index.ts'
import { ThemeEditor } from './ThemeEditor.tsx'
import { themeOf } from './themeDraft.ts'

// Testing Library's automatic cleanup needs test globals, which this repo does not enable.
afterEach(cleanup)

const PNG = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
)

function setup(draft: Draft = draftFromDesign(sampleDesign())) {
  const store = createDraftStore({ persistence: memoryDraftPersistence(), initial: () => draft })
  render(
    createElement(AdminApp, {
      store,
      registry: withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {}),
      initialSection: 'themes',
      themes: ThemeEditor,
    }),
  )
  return {
    user: userEvent.setup(),
    design: () => store.getSnapshot().draft.design,
  }
}

const preview = (name: RegExp) => {
  const figure = screen.getByRole('figure', { name })
  const scope = figure.querySelector<HTMLElement>('[data-wrx-theme]')
  if (scope === null) throw new Error('no theme scope')
  return scope
}

const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name)

describe('theme editor (ADM-18, ADM-19)', () => {
  it('edits the game theme and updates the preview live', async () => {
    const { user, design } = setup()
    expect(screen.getByText('The game theme is public.')).toBeTruthy()
    const hex = screen.getByLabelText('Surface')
    await user.clear(hex)
    await user.type(hex, '#fef3c7')
    expect(design().game.theme.tokens.surface).toBe('#fef3c7')
    for (const pane of [/^Welcome page/, /^Room panel/, /^Force panel/]) {
      expect(prop(preview(pane), '--wrx-surface')).toBe('#fef3c7')
    }
  })

  it('edits a force theme, shown in the force panel only, and inherits the rest', async () => {
    const { user, design } = setup()
    await user.selectOptions(screen.getByLabelText('Theme for'), 'force:blue')
    expect(screen.queryByText('The game theme is public.')).toBeNull()
    const hex = screen.getByLabelText('Primary')
    await user.clear(hex)
    await user.type(hex, '#7c3aed')
    const blue = design().forces.find((f) => f.id === 'blue')
    expect(blue?.theme?.tokens).toEqual({ primary: '#7c3aed' })
    expect(prop(preview(/^Force panel: Blue/), '--wrx-primary')).toBe('#7c3aed')
    expect(prop(preview(/^Welcome page/), '--wrx-primary')).toBe(design().game.theme.tokens.primary)
    await user.click(screen.getByRole('button', { name: 'Inherit for Primary' }))
    expect(design().forces.find((f) => f.id === 'blue')?.theme).toBeUndefined()
  })

  it('chooses a bundled font', async () => {
    const { user, design } = setup()
    await user.selectOptions(screen.getByLabelText('Font'), 'serif')
    expect(design().game.theme.tokens.fontFamily).toBe('serif')
    expect(prop(preview(/^Welcome page/), '--wrx-font-family')).toContain('Plex Serif')
  })
})

describe('contrast warnings (ADM-20)', () => {
  it('warns about failing pairs but still saves the change', async () => {
    const { user, design } = setup()
    const status = () =>
      within(screen.getByRole('region', { name: /Contrast/ })).getByRole('status')
    expect(status().textContent).toContain('Every checked colour pair passes.')
    const hex = screen.getByLabelText('Text')
    await user.clear(hex)
    await user.type(hex, '#cccccc')
    expect(design().game.theme.tokens.text).toBe('#cccccc')
    expect(status().textContent).toMatch(/2 colour pairs may be hard to read/)
    expect(status().textContent).toContain('Text on panels: #cccccc on #ffffff')
    expect(status().textContent).toContain('still saved')
  })
})

describe('images (§3 rule 12)', () => {
  it('uploads a PNG logo into the assets and references it by id', async () => {
    const { user, design } = setup()
    const file = new File([PNG], 'logo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Logo'), file)
    await waitFor(() => {
      expect(design().game.theme.logoAssetId).toBe('game-logo-2')
    })
    const asset = design().assets.find((a) => a.id === 'game-logo-2')
    expect(asset).toMatchObject({ mimeType: 'image/png', size: PNG.length })
    // The seed's old logo is no longer used, so it is removed.
    expect(design().assets.some((a) => a.id === 'game-logo')).toBe(false)
    const img = within(preview(/^Welcome page/)).getByRole('img')
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  })

  it('refuses a file that is not PNG, WebP or SVG', async () => {
    const { user, design } = setup()
    const before = design().assets
    const file = new File(['GIF89a'], 'x.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Icon'), file)
    expect(await screen.findByText('The icon was not uploaded.')).toBeTruthy()
    expect(design().assets).toBe(before)
  })

  it('refuses SVG where it cannot be sanitised (fails closed)', async () => {
    const { user, design } = setup()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    await user.upload(
      screen.getByLabelText('Icon'),
      new File([svg], 'x.svg', { type: 'image/svg+xml' }),
    )
    // happy-dom cannot run DOMPurify properly; the sanitiser refuses rather than pass the SVG
    // through. The real sanitising is tested in Chromium (e2e/themes.spec.ts, @wrx/theme e2e).
    expect(await screen.findByText('The icon was not uploaded.')).toBeTruthy()
    expect(design().game.theme.iconAssetId).toBeUndefined()
    expect(design().assets.some((a) => a.mimeType === 'image/svg+xml')).toBe(false)
  })
})

describe('copy and reset (ADM-21)', () => {
  it('copies a theme from another force and resets it to inherit', async () => {
    const { user, design } = setup()
    await user.selectOptions(screen.getByLabelText('Theme for'), 'force:red')
    expect(screen.getByText('No other force or room has its own theme to copy.')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Theme for'), 'force:blue')
    const hex = screen.getByLabelText('Secondary')
    await user.clear(hex)
    await user.type(hex, '#0f766e')

    await user.selectOptions(screen.getByLabelText('Theme for'), 'force:red')
    await user.selectOptions(screen.getByLabelText('Copy theme from'), 'force:blue')
    await user.click(screen.getByRole('button', { name: 'Copy theme' }))
    const red = { kind: 'force', id: 'red' } as const
    expect(themeOf(design(), red)?.tokens.secondary).toBe('#0f766e')
    expect(prop(preview(/^Force panel: Red/), '--wrx-secondary')).toBe('#0f766e')

    await user.click(screen.getByRole('button', { name: 'Reset to inherit' }))
    expect(themeOf(design(), red)).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Reset to inherit' }).hasAttribute('disabled')).toBe(
      true,
    )
  })
})
