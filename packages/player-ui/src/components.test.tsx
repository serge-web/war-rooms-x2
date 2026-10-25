// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { flush, harness, room } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import { nodeName } from '@wrx/schemas'
import type { GameSetup } from '@wrx/schemas'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendBadge, BackendChoiceCore } from './backend.tsx'
import { LoginFormCore } from './login-form.tsx'
import { Shell, ShellCore } from './shell.tsx'
import { WelcomePage, WelcomePageCore } from './welcome.tsx'

afterEach(cleanup)

const GAME: GameSetup = {
  schemaVersion: 1,
  name: 'Exercise Northern Gate',
  description: 'A two-sided exercise.',
  briefing: 'The exercise starts at 09:00.',
  designVersion: 1,
  theme: { tokens: { primary: '#123456' } },
  roomTypeDefaults: {},
}

describe('BackendBadge and BackendChoiceCore (PLY-1, PLY-20)', () => {
  it('labels the backend', () => {
    render(<BackendBadge backend={{ kind: 'xmpp', address: 'wrx.example' }} />)
    expect(screen.getByLabelText('Backend: wrx.example').textContent).toBe('wrx.example')
  })

  it('offers a choice only when there is more than one backend', () => {
    const onSelect = vi.fn()
    const mock = { id: 'mock', backend: { kind: 'mock' as const }, description: 'Offline' }
    const { rerender } = render(
      <BackendChoiceCore options={[mock]} selected="mock" onSelect={onSelect} />,
    )
    expect(screen.queryByRole('radio')).toBeNull()
    rerender(
      <BackendChoiceCore
        options={[
          { id: 'server', backend: { kind: 'xmpp', address: 'wrx.example' }, description: 'Live' },
          mock,
        ]}
        selected="server"
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Mock/ }))
    expect(onSelect).toHaveBeenCalledWith('mock')
  })
})

describe('LoginFormCore', () => {
  it('submits role id and password; demo logins fill them in (NFR-6)', () => {
    const onSubmit = vi.fn()
    render(
      <LoginFormCore
        onSubmit={onSubmit}
        demoLogins={[{ roleId: 'blue-co', label: 'Blue CO (Blue)', password: 'demo-blue-co' }]}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'Demo password' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use the demo login for Blue CO (Blue)' }))
    expect(screen.getByLabelText<HTMLInputElement>('Role id').value).toBe('blue-co')
    fireEvent.submit(screen.getByRole('button', { name: 'Log in' }))
    expect(onSubmit).toHaveBeenCalledWith('blue-co', 'demo-blue-co')
  })

  it('does not submit empty fields, and shows errors and the busy state', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<LoginFormCore onSubmit={onSubmit} />)
    fireEvent.submit(screen.getByRole('button', { name: 'Log in' }))
    expect(onSubmit).not.toHaveBeenCalled()
    rerender(<LoginFormCore onSubmit={onSubmit} busy error="Wrong role id or password." />)
    expect(screen.getByRole('alert').textContent).toBe('Wrong role id or password.')
    expect(screen.getByRole('button', { name: 'Logging in…' })).toHaveProperty('disabled', true)
  })
})

describe('WelcomePageCore (PLY-46, PLY-47)', () => {
  it('shows logo, name, description, then the briefing box, then the login form', () => {
    render(
      <WelcomePageCore
        status="ready"
        game={GAME}
        logoSrc="data:image/png;base64,AA=="
        header={<header>bar</header>}
      >
        <form aria-label="login" />
      </WelcomePageCore>,
    )
    const logo = screen.getByRole('img', { name: 'Exercise Northern Gate logo' })
    const name = screen.getByRole('heading', { name: 'Exercise Northern Gate' })
    const briefing = screen.getByRole('region', { name: 'Briefing' })
    const form = screen.getByRole('form', { name: 'login' })
    const order = [logo, name, screen.getByText('A two-sided exercise.'), briefing, form]
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
    // The fixed-height scrolling box, focusable for keyboard scrolling (PLY-47).
    expect(briefing.classList.contains('wrx-markdown--scroll')).toBe(true)
    expect(briefing.getAttribute('tabindex')).toBe('0')
    // Styled by the game theme (PLY-46).
    const scope = name.closest('.wrx-theme')
    expect(scope instanceof HTMLElement && scope.style.getPropertyValue('--wrx-primary')).toBe(
      '#123456',
    )
  })

  it('falls back with no game, and when the server cannot be reached (PLY-27, PLY-32)', () => {
    const { rerender } = render(
      <WelcomePageCore status="none" game={undefined} header={null}>
        <form aria-label="login" />
      </WelcomePageCore>,
    )
    expect(screen.getByRole('status').textContent).toContain('No game has been published yet')
    expect(screen.getByRole('form', { name: 'login' })).toBeTruthy()
    rerender(
      <WelcomePageCore status="unavailable" game={undefined} header={null}>
        <form aria-label="login" />
      </WelcomePageCore>,
    )
    expect(screen.getByRole('status').textContent).toContain('could not be loaded')
  })

  it('reads the game anonymously from a store, keeping the form when the store arrives', async () => {
    const h = harness({ fake: { anonymous: true, jid: 'anon@wrx.test/x' } })
    const { rerender } = render(
      <WelcomePage store={undefined} pending header={null}>
        <input aria-label="kept" />
      </WelcomePage>,
    )
    const input = screen.getByLabelText('kept')
    rerender(
      <WelcomePage store={h.store} pending={false} header={null}>
        <input aria-label="kept" />
      </WelcomePage>,
    )
    await act(() => flush())
    expect(screen.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeTruthy()
    expect(screen.getByLabelText('kept')).toBe(input)
  })
})

describe('ShellCore', () => {
  const base = {
    gameName: 'Exercise Northern Gate',
    role: { name: 'Blue CO', forceName: 'Blue', forceColour: '#1d4ed8' },
    backend: <BackendBadge backend={{ kind: 'mock' }} />,
    workspace: <p>workspace slot</p>,
    column: <p>column slot</p>,
  }

  it('shows the header, the slots and logout (PLY-1, PLY-3, PLY-36)', () => {
    const onLogout = vi.fn()
    render(<ShellCore {...base} status={{ state: 'ready' }} game="ready" onLogout={onLogout} />)
    expect(screen.getByLabelText('Logged in as Blue CO, Blue')).toBeTruthy()
    expect(screen.getByLabelText('Backend: MOCK')).toBeTruthy()
    expect(screen.getByRole('main', { name: 'Workspace' }).textContent).toBe('workspace slot')
    expect(screen.getByRole('complementary', { name: 'Out-of-game column' }).textContent).toBe(
      'column slot',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('shows a reconnecting indicator (PLY-2)', () => {
    render(
      <ShellCore
        {...base}
        status={{ state: 'reconnecting', attempt: 3 }}
        game="ready"
        onLogout={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Reconnecting')
    expect(screen.getByRole('status').textContent).toContain('attempt 3')
  })

  it('shows the no-game state instead of the workspace (PLY-32)', () => {
    render(<ShellCore {...base} status={{ state: 'ready' }} game="none" onLogout={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'No game yet' })).toBeTruthy()
    expect(screen.queryByText('workspace slot')).toBeNull()
  })
})

describe('Shell over a store', () => {
  it("shows the role's rooms in the workspace, and an empty state when it has none (PLY-4, PLY-32)", async () => {
    const h = harness()
    render(
      <StrictMode>
        <SessionStoreProvider store={h.store}>
          <Shell backend={null} onLogout={vi.fn()} />
        </SessionStoreProvider>
      </StrictMode>,
    )
    await act(() => h.store.ready())
    await act(() => flush())
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual([
      'blue-hq',
      'negotiation',
      'Game info',
      'Online',
    ])
    expect(screen.getByLabelText('Logged in as blue-co, BLUE')).toBeTruthy()

    act(() => {
      h.publish(
        nodeName.room('blue-hq'),
        room('blue-hq', [{ kind: 'force', id: 'red', access: 'write' }]),
      )
      h.publish(
        nodeName.room('negotiation'),
        room('negotiation', [{ kind: 'role', id: 'red-co', access: 'write' }]),
      )
    })
    await act(() => flush())
    expect(screen.getByText(/Your role has no rooms yet/)).toBeTruthy()
  })
})
