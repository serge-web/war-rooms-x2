// @vitest-environment happy-dom
// The multi-client view (happy-dom): presets parsed defensively, panes with their own sessions
// (each a FakeSession of its own), pane count and arrangement, presets saved and restored with
// their logins, and the mock database controls. The admin's preview store is tested here too.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { flush, harness } from '@wrx/domain/fixtures'
import { err, ok } from '@wrx/transport'
import type { ConnectOptions, Transport } from '@wrx/transport'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewAsRole } from '../preview/preview-store.ts'
import { MockControlsCore } from './mock-controls.tsx'
import { MultiClientView } from './multi-client.tsx'
import {
  memoryPresetStorage,
  parsePresets,
  serialisePresets,
  webPresetStorage,
  withPreset,
} from './presets.ts'
import type { MultiPreset } from './presets.ts'

afterEach(cleanup)

const PRESET: MultiPreset = {
  name: 'Two forces',
  count: 2,
  arrangement: 'row',
  panes: [
    { kind: 'player', roleId: 'blue-co' },
    { kind: 'player', roleId: 'red-co' },
  ],
}

describe('presets (PLY-19)', () => {
  it('round-trips, and replaces a preset of the same name', () => {
    const list = withPreset(withPreset([], PRESET), {
      ...PRESET,
      count: 3,
      panes: [...PRESET.panes, { kind: 'admin' }],
    })
    expect(list).toHaveLength(1)
    expect(parsePresets(serialisePresets(list))).toEqual(list)
  })

  it('drops anything malformed rather than trusting storage', () => {
    expect(parsePresets('not json')).toEqual([])
    expect(parsePresets(JSON.stringify({ format: 2, presets: [PRESET] }))).toEqual([])
    const stored = JSON.stringify({
      format: 1,
      presets: [
        PRESET,
        { ...PRESET, name: 'Wrong count', count: 3 },
        { ...PRESET, name: 'Bad role', panes: [{ kind: 'player', roleId: 'Bad Id!' }, {}] },
        { ...PRESET, name: '' },
        { ...PRESET, name: 'Five', count: 5 },
      ],
    })
    expect(parsePresets(stored).map((p) => p.name)).toEqual(['Two forces'])
  })

  it('never stores a password, and copes with blocked storage', () => {
    const items = new Map<string, string>()
    const storage = webPresetStorage(
      () => ({
        getItem: (k) => items.get(k) ?? null,
        setItem: (k, v) => {
          items.set(k, v)
        },
      }),
      'presets',
    )
    expect(storage.save([PRESET])).toBe(true)
    expect(items.get('presets')).not.toMatch(/password|demo-/)
    expect(storage.load()).toEqual([PRESET])
    const blocked = webPresetStorage(() => {
      throw new Error('SecurityError')
    }, 'presets')
    expect(blocked.load()).toEqual([])
    expect(blocked.save([PRESET])).toBe(false)
  })
})

/** A transport whose every login is a fresh FakeSession of that role, serving the sample game. */
function fakeTransport() {
  const logins: ConnectOptions[] = []
  const transport: Transport = {
    kind: 'mock',
    connect: (options) => {
      logins.push(options)
      if (options.credentials.kind !== 'password') return Promise.resolve(err('not-authorized'))
      if (options.credentials.password !== `demo-${options.credentials.username}`) {
        return Promise.resolve(err('not-authorized'))
      }
      return Promise.resolve(ok(harness({ roleId: options.credentials.username }).session))
    },
  }
  return { transport, logins }
}

const DEMO = ['blue-co', 'red-co', 'umpire-1'].map((roleId) => ({
  roleId,
  label: roleId,
  password: `demo-${roleId}`,
}))

async function mountView(presets = memoryPresetStorage()) {
  const { transport, logins } = fakeTransport()
  render(
    <StrictMode>
      <MultiClientView
        connection={{ transport, endpoint: { websocketUrl: '', domain: 'wrx.test' } }}
        backend={{ kind: 'mock' }}
        demoLogins={DEMO}
        workspace={<p>Workspace</p>}
        presets={presets}
        initialCount={3}
      />
    </StrictMode>,
  )
  await act(() => flush())
  return { logins, presets }
}

const pane = (n: number) => screen.getByRole('region', { name: `Pane ${n}` })
const panes = () => screen.getAllByRole('region', { name: /^Pane \d$/ })

async function quick(n: number, roleId: string) {
  fireEvent.click(within(pane(n)).getByRole('button', { name: `Log in as ${roleId}` }))
  await act(() => flush(10))
}

describe('the multi-client view (PLY-16–18)', () => {
  it('logs each pane in on its own session, with its own header', async () => {
    const { logins } = await mountView()
    expect(panes()).toHaveLength(3)
    await quick(1, 'blue-co')
    await quick(2, 'red-co')
    expect(within(pane(1)).getByLabelText('Logged in as blue-co, BLUE')).toBeTruthy()
    expect(within(pane(2)).getByLabelText('Logged in as red-co, RED')).toBeTruthy()
    expect(within(pane(3)).getByText('Not logged in')).toBeTruthy()
    for (const n of [1, 2, 3]) expect(within(pane(n)).getByLabelText('Backend: MOCK')).toBeTruthy()
    // One resource per pane (D22).
    const resources = new Set(logins.map((l) => l.resource))
    expect(resources.size).toBe(logins.length)
  })

  it('changes the pane count, keeping the panes that stay', async () => {
    await mountView()
    await quick(1, 'blue-co')
    fireEvent.click(screen.getByRole('radio', { name: '4' }))
    expect(panes()).toHaveLength(4)
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('radio', { name: '2' }))
    await act(() => flush())
    expect(panes()).toHaveLength(2)
    expect(within(pane(1)).getByLabelText('Logged in as blue-co, BLUE')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Side by side' })).toHaveProperty('checked', true)
  })

  it('saves a preset with the panes’ logins and restores it, logging back in (PLY-19)', async () => {
    const { presets, logins } = await mountView()
    fireEvent.click(screen.getByRole('radio', { name: '2' }))
    await quick(1, 'red-co')
    await quick(2, 'umpire-1')
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Umpire demo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    expect(presets.load()).toEqual([
      {
        name: 'Umpire demo',
        count: 2,
        arrangement: 'row',
        panes: [
          { kind: 'player', roleId: 'red-co' },
          { kind: 'player', roleId: 'umpire-1' },
        ],
      },
    ])

    fireEvent.click(screen.getByRole('radio', { name: '3' }))
    fireEvent.click(within(pane(1)).getByRole('button', { name: 'Log out' }))
    await act(() => flush())
    const before = logins.length
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await act(() => flush(10))
    expect(panes()).toHaveLength(2)
    expect(within(pane(1)).getByLabelText('Logged in as red-co, RED')).toBeTruthy()
    expect(within(pane(2)).getByLabelText('Logged in as umpire-1, UMPIRE')).toBeTruthy()
    expect(logins.slice(before).map((l) => l.credentials)).toContainEqual({
      kind: 'password',
      username: 'red-co',
      password: 'demo-red-co',
    })
  })
})

describe('the mock database controls (PLY-21)', () => {
  it('asks before resetting, then reports', async () => {
    const onReset = vi.fn(() => Promise.resolve(undefined))
    render(
      <MockControlsCore
        onReset={onReset}
        onExport={() => Promise.resolve({ ok: true, json: '{}' })}
        onImport={() => Promise.resolve(undefined)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset to seed…' }))
    expect(onReset).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Reset the mock to its seed?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await act(() => flush())
    expect(onReset).toHaveBeenCalledOnce()
    expect(screen.getByRole('status').textContent).toContain('back at its seed')
  })

  it('saves the export as a dated file, and reports failures', async () => {
    const saveFile = vi.fn()
    const onExport = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: '{"format":1}' })
      .mockResolvedValueOnce({ ok: false, error: 'the host did not answer' })
    render(
      <MockControlsCore
        onReset={() => Promise.resolve(undefined)}
        onExport={onExport}
        onImport={() => Promise.resolve(undefined)}
        saveFile={saveFile}
        now={() => new Date('2026-10-25T09:30:00Z')}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await act(() => flush())
    expect(saveFile).toHaveBeenCalledWith(
      'wrx-mock-database-2026-10-25T09-30-00.json',
      '{"format":1}',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await act(() => flush())
    expect(screen.getByRole('status').textContent).toBe('Not exported: the host did not answer')
  })

  it('imports a chosen file only after confirming', async () => {
    const onImport = vi.fn(() => Promise.resolve('not a mock database'))
    render(
      <MockControlsCore
        onReset={() => Promise.resolve(undefined)}
        onExport={() => Promise.resolve({ ok: true, json: '{}' })}
        onImport={onImport}
      />,
    )
    const input = screen.getByLabelText('Mock database file to import')
    const file = new File(['{"x":1}'], 'db.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file] } })
    await act(() => flush())
    const dialog = screen.getByRole('dialog', { name: 'Import this database?' })
    expect(onImport).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))
    await act(() => flush())
    expect(onImport).toHaveBeenCalledWith('{"x":1}')
    expect(screen.getByRole('status').textContent).toBe('Not imported: not a mock database')
  })
})

describe('the admin’s preview as a role (ADM-30, ADM-31)', () => {
  it('describes the role’s rooms and force, and sends through the admin session', async () => {
    const h = harness({ roleId: 'admin' })
    await h.store.ready()
    await flush()
    expect(h.store.me().data.rooms).toHaveLength(3)
    const preview = previewAsRole(h.store, 'red-co')
    expect(preview.identity).toMatchObject({ roleId: 'red-co', isAdmin: false })
    const me = preview.me()
    expect(me.data.role?.id).toBe('red-co')
    expect(me.data.force?.id).toBe('red')
    expect(me.data.rooms.map((r) => r.room.id)).toEqual(['red-hq', 'negotiation'])
    // A stable snapshot until something changes (useSyncExternalStore needs it).
    expect(preview.me()).toBe(me)
    // Everything else is the admin's: its documents, and its session for anything sent.
    expect(preview.objectives('red').data?.markdown).toBe('Delay Blue.')
    expect(preview.session).toBe(h.store.session)
    expect(await preview.postAnnouncement('From the admin')).toEqual(ok(undefined))
    const call = h.session.calls.find((c) => c.op === 'publish')
    expect(call?.args[0]).toBe('announcements')
  })

  it('shows an umpire every room', async () => {
    const h = harness({ roleId: 'admin' })
    await h.store.ready()
    await flush()
    const preview = previewAsRole(h.store, 'umpire-1')
    expect(preview.me().data.isUmpire).toBe(true)
    expect(preview.me().data.rooms.map((r) => r.room.id)).toEqual([
      'blue-hq',
      'red-hq',
      'negotiation',
    ])
  })
})
