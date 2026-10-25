// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_TOKENS, WRX_PROPERTIES, themeProperties } from '@wrx/theme'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Banner } from './banner.tsx'
import { Button } from './button.tsx'
import { Dialog, DialogClose } from './dialog.tsx'
import { PasswordField, TextField } from './fields.tsx'
import { Spinner } from './spinner.tsx'
import { DEFAULT_THEME, ThemeScope, themeStyle } from './theme.tsx'
import { ToastProvider, useToast } from './toast.tsx'

// Testing Library's automatic cleanup needs test globals, which this repo does not enable.
afterEach(cleanup)

describe('Button', () => {
  it('is a non-submitting button unless asked, and busy disables it', () => {
    const onClick = vi.fn()
    render(
      <>
        <Button onClick={onClick}>Save</Button>
        <Button busy>Sending</Button>
      </>,
    )
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.getAttribute('type')).toBe('button')
    fireEvent.click(save)
    expect(onClick).toHaveBeenCalledOnce()
    const sending = screen.getByRole('button', { name: 'Sending' })
    expect(sending).toHaveProperty('disabled', true)
    expect(sending.getAttribute('aria-busy')).toBe('true')
  })
})

describe('TextField and PasswordField', () => {
  it('labels the input and links the hint and error (NFR-14)', () => {
    render(<TextField label="Role id" hint="As given by the admin" error="Required" />)
    const input = screen.getByLabelText('Role id')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = described.map((id) => document.getElementById(id)?.textContent)
    expect(texts).toEqual(['As given by the admin', 'Required'])
    expect(screen.getByRole('alert').textContent).toBe('Required')
  })

  it('shows and hides the password with a toggle button', () => {
    render(<PasswordField label="Password" />)
    const input = screen.getByLabelText('Password')
    expect(input.getAttribute('type')).toBe('password')
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(input.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })
})

describe('Dialog', () => {
  function Harness({ dismissible }: { dismissible?: boolean }) {
    const [open, setOpen] = useState(true)
    return (
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Log out?"
        description="You can log in again at any time."
        dismissible={dismissible}
        actions={
          <DialogClose>
            <Button>Cancel</Button>
          </DialogClose>
        }
      />
    )
  }

  it('is a named, described dialog that its Close action closes', () => {
    render(<Harness />)
    const dialog = screen.getByRole('dialog', { name: 'Log out?' })
    const described = dialog.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(described)?.textContent).toBe(
      'You can log in again at any time.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape unless it is not dismissible', () => {
    render(<Harness dismissible={false} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeNull()
    cleanup()
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ToastProvider', () => {
  function Shower() {
    const toast = useToast()
    return (
      <Button
        onClick={() => {
          toast.show({ title: 'Saved', description: 'The briefing is published.' })
        }}
      >
        Show
      </Button>
    )
  }

  it('shows toasts in a labelled region, and dismisses them', () => {
    render(
      <ToastProvider>
        <Shower />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(screen.getByText('The briefing is published.')).toBeTruthy()
    expect(screen.getByRole('region', { name: /Notifications/ })).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    })
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Shower />)).toThrow('useToast needs a ToastProvider')
    vi.restoreAllMocks()
  })
})

describe('Banner and Spinner', () => {
  it('uses status for information and alert for warnings', () => {
    const onDismiss = vi.fn()
    render(
      <>
        <Banner title="Reconnecting">Trying again.</Banner>
        <Banner tone="danger" title="Logged out" onDismiss={onDismiss} />
      </>,
    )
    expect(screen.getByRole('status').textContent).toContain('Reconnecting')
    expect(screen.getByRole('alert').textContent).toContain('Logged out')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('announces what is loading', () => {
    render(<Spinner label="Connecting" hideLabel />)
    expect(screen.getByRole('status').textContent).toBe('Connecting')
  })
})

describe('ThemeScope', () => {
  it('sets every --wrx-* property on its own root only, through @wrx/theme (PLY-26)', () => {
    render(
      <ThemeScope tokens={{ primary: '#ff0000', fontFamily: 'serif' }} data-testid="scope">
        <span data-testid="child">x</span>
      </ThemeScope>,
    )
    const scope = screen.getByTestId('scope')
    const expected = themeProperties({ ...DEFAULT_TOKENS, primary: '#ff0000', fontFamily: 'serif' })
    for (const name of WRX_PROPERTIES) {
      expect(scope.style.getPropertyValue(name)).toBe(expected[name])
    }
    expect(scope.style.getPropertyValue('--wrx-font-family')).toContain('Plex Serif')
    expect(scope.className).toBe('wrx-theme')
    expect(screen.getByTestId('child').style.getPropertyValue('--wrx-primary')).toBe('')
  })

  it('takes unset tokens from the enclosing scope, and from the default theme at the root', () => {
    render(
      <ThemeScope root tokens={{ text: '#222222' }} data-testid="outer">
        <ThemeScope tokens={{ primary: '#ff0000' }} data-testid="inner">
          <ThemeScope root data-testid="reset" />
        </ThemeScope>
      </ThemeScope>,
    )
    const prop = (id: string, name: string) => screen.getByTestId(id).style.getPropertyValue(name)
    expect(prop('outer', '--wrx-text')).toBe('#222222')
    expect(prop('outer', '--wrx-primary')).toBe(DEFAULT_THEME.primary)
    expect(prop('inner', '--wrx-text')).toBe('#222222')
    expect(prop('inner', '--wrx-primary')).toBe('#ff0000')
    expect(prop('reset', '--wrx-text')).toBe(DEFAULT_THEME.text)
    expect(prop('reset', '--wrx-primary')).toBe(DEFAULT_THEME.primary)
  })

  it('themeStyle: only the set tokens when inheriting, all ten over the default otherwise', () => {
    expect(themeStyle({ text: '#111111' }, { inherit: false })).toEqual(
      themeProperties({ ...DEFAULT_TOKENS, text: '#111111' }),
    )
    expect(themeStyle({ primary: '#ff0000' })).toEqual({ '--wrx-primary': '#ff0000' })
    expect(themeStyle(undefined)).toEqual({})
  })

  it("ui.css's :root defaults are @wrx/theme's default theme", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ui.css'), 'utf8')
    const block = /:where\(:root\) \{([^}]*)\}/.exec(css)?.[1] ?? ''
    const declared: Record<string, string> = {}
    for (const m of block.matchAll(/(--wrx-[a-z-]+):\s*([^;]+);/g)) {
      declared[m[1] ?? ''] = (m[2] ?? '').trim()
    }
    expect(declared).toEqual({ ...themeProperties(DEFAULT_TOKENS) })
  })
})
