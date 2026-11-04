// @vitest-environment happy-dom
// The admin's world-state editor (ADM-44–46, R25, R26; WP 5.6), over a store: the editor only in
// the admin's own view, edits into a draft in browser storage, the change summary, a publish on
// its own and with a phase change, discarding, the form's checks, and the storage itself.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { serialiseWorldDraft, worldDraftKey } from '@wrx/domain'
import { DOMAIN, MUC, flush, harness, message, room, sampleDocuments } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import type { SessionStore } from '@wrx/domain'
import { SessionStoreProvider } from '@wrx/hooks'
import { nodeName } from '@wrx/schemas'
import { WORLD_ASSET, sampleDesign, sampleWorldState, tid } from '@wrx/schemas/fixtures'
import type { WorldState } from '@wrx/schemas'
import { err, ok } from '@wrx/transport'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TurnPanel } from '../column/turn-panel.tsx'
import { readAssetForm } from './asset-form.tsx'
import { describeChange } from './change-summary.tsx'
import { heldWorldDraft, memoryWorldDraftStorage, webWorldDraftStorage } from './draft-storage.ts'
import type { WorldDraftStorage } from './draft-storage.ts'
import { MapPanel } from './map-panel.tsx'
import { WorldDraftProvider, readPublishedWorldState, sizeRefusal } from './world-draft.tsx'

afterEach(cleanup)

const MAP_JID = `${tid('map')}@${MUC}`
const KEY = worldDraftKey(DOMAIN, tid('map'))
const at = (turn: number, phase: 'planning' | 'adjudication') =>
  ({ schemaVersion: 1, turn, phase }) as const

function worldMessage(state: WorldState) {
  return message('map', {
    nick: 'admin',
    from: `admin@${DOMAIN}/admin-1`,
    body: JSON.stringify({ type: 'world-state', schemaVersion: 1, content: state }),
  })
}

async function mount(
  roleId: string,
  children: ReactNode,
  storage: WorldDraftStorage = memoryWorldDraftStorage(),
  turn = at(1, 'planning'),
  published: readonly WorldState[] = [sampleWorldState()],
  options: { readonly noise?: number; readonly worldStatePageLimit?: number } = {},
): Promise<{ h: Harness; storage: WorldDraftStorage }> {
  const docs = sampleDocuments()
  const map = room(
    'map',
    [
      { kind: 'force', id: 'blue', access: 'write' },
      { kind: 'force', id: 'red', access: 'write' },
      { kind: 'force', id: 'white', access: 'write' },
    ],
    { roomType: 'map', order: 3 },
  )
  docs.set(nodeName.room(map.id), [map])
  docs.set('game-state', [turn])
  const h = harness({
    roleId,
    docs,
    ...(options.worldStatePageLimit === undefined
      ? {}
      : { worldStatePageLimit: options.worldStatePageLimit }),
  })
  // Messages after the admin's that are not world states from the admin (a modified client's).
  const noise = Array.from({ length: options.noise ?? 0 }, () =>
    message('map', { body: JSON.stringify({ type: 'chat', schemaVersion: 1, content: 'x' }) }),
  )
  h.archive.set(MAP_JID, [...published.map(worldMessage), ...noise])
  render(
    <StrictMode>
      <WorldDraftProvider storage={storage}>
        <SessionStoreProvider store={h.store}>{children}</SessionStoreProvider>
      </WorldDraftProvider>
    </StrictMode>,
  )
  await act(() => h.store.ready())
  await act(() => flush(30))
  return { h, storage }
}

const mapPanel = (
  <MapPanel
    roomId={tid('map')}
    room={{
      schemaVersion: 1,
      id: tid('map'),
      name: 'Map',
      roomType: 'map',
      participants: [],
      config: {},
      order: 3,
    }}
    config={{}}
    access="write"
  />
)

const editor = () => screen.queryByRole('group', { name: 'World-state editor' })
const sends = (h: Harness) => h.session.calls.filter((c) => c.op === 'send')

async function editHealth(title: string, health: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Table' }))
  fireEvent.click(screen.getByRole('button', { name: title }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit…' }))
  const form = screen.getByRole('form', { name: `Edit ${title}` })
  fireEvent.change(within(form).getByLabelText('Health (%)'), { target: { value: health } })
  fireEvent.click(within(form).getByRole('button', { name: 'Save to the draft' }))
  await act(() => flush())
}

describe('the world-state editor (ADM-44, ADM-45)', () => {
  it('is offered to the admin only', async () => {
    await mount('blue-co', mapPanel)
    expect(screen.getByText('World state for turn 1: 6 assets')).toBeTruthy()
    expect(editor()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit…' })).toBeNull()
  })

  it('keeps edits in a draft in browser storage, says so, and discards it', async () => {
    const { storage } = await mount('admin', mapPanel)
    expect(editor()).toBeTruthy()
    expect(screen.getByText(/kept as a draft in this browser until you publish/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Publish world state…' })).toHaveProperty(
      'disabled',
      true,
    )
    await editHealth('Tank Company', '40')
    expect(storage.snapshot(KEY).text).toContain('"health":40')
    const banner = screen.getByText(/^Unpublished edits/).closest('.wrx-banner')
    expect(banner?.textContent).toContain('Unpublished edits: 1 asset changed')
    expect(banner?.textContent).toContain('held only in this browser')
    expect(screen.getByText('Your draft for turn 1: 6 assets, not published')).toBeTruthy()
    expect(screen.queryByText(/may belong to an earlier game/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft…' }))
    const confirm = screen.getByRole('region', { name: 'Discard the draft?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard draft' }))
    expect(storage.snapshot(KEY).text).toBeUndefined()
    expect(screen.getByText('World state for turn 1: 6 assets')).toBeTruthy()
  })

  it('adds, edits and deletes assets, with the form’s checks', async () => {
    const { storage } = await mount('admin', mapPanel)
    fireEvent.click(screen.getByRole('button', { name: 'Add asset…' }))
    const form = screen.getByRole('form', { name: 'Add an asset' })
    fireEvent.change(within(form).getByLabelText('Symbol code (SIDC)'), {
      target: { value: 'nonsense' },
    })
    fireEvent.change(within(form).getByLabelText('Fuel (%)'), { target: { value: '150' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add to the draft' }))
    expect(within(form).getByText('Enter a title.')).toBeTruthy()
    expect(within(form).getByText(/Enter a MIL-STD-2525\/APP-6 code/)).toBeTruthy()
    expect(within(form).getByText('Enter a value from 0 to 100.')).toBeTruthy()
    expect(within(form).getByText('No symbol: the code is not valid.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Bridging Troop' } })
    fireEvent.change(within(form).getByLabelText('Category'), { target: { value: 'engineers' } })
    fireEvent.change(within(form).getByLabelText('Symbol code (SIDC)'), {
      target: { value: 'sfgpuce----k---' },
    })
    fireEvent.change(within(form).getByLabelText('Fuel (%)'), { target: { value: '80' } })
    expect(await within(form).findByRole('img', { name: /Symbol preview/ })).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Add to the draft' }))
    await act(() => flush())
    expect(screen.getByText('Your draft for turn 1: 7 assets, not published')).toBeTruthy()
    expect(storage.snapshot(KEY).text).toContain('SFGPUCE----K---')

    // Delete one of the published assets, after a confirmation.
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Artillery Battery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }))
    const confirm = screen.getByRole('region', { name: 'Delete Artillery Battery?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete from the draft' }))
    await act(() => flush())
    expect(screen.queryByRole('button', { name: 'Artillery Battery' })).toBeNull()
    expect(screen.getByText(/Unpublished edits: 2 assets changed/)).toBeTruthy()
  })

  it('publishes on its own after the change summary, as one full state, then clears the draft', async () => {
    const { h, storage } = await mount('admin', mapPanel, undefined, at(2, 'planning'))
    await editHealth('Tank Company', '40')
    fireEvent.click(screen.getByRole('button', { name: 'Publish world state…' }))
    const confirm = screen.getByRole('region', { name: 'Publish world state?' })
    const summary = within(confirm).getByRole('group', { name: 'World-state changes' })
    expect(summary.textContent).toContain('1 asset: 0 added, 0 removed, 1 changed')
    expect(summary.textContent).toContain('Tank Company: health 100% → 40%')
    expect(summary.textContent).toContain('as one message of')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Publish world state' }))
    await act(() => flush())
    const [sent] = sends(h)
    expect(sent?.args[0]).toBe(MAP_JID)
    const body = JSON.parse(String(sent?.args[1])) as { content: WorldState }
    // The turn is the current one; every asset is in it (D25).
    expect(body.content.turn).toBe(2)
    expect(Object.keys(body.content.assets)).toHaveLength(6)
    expect(body.content.assets[WORLD_ASSET.redArmour]?.health).toBe(40)
    expect(storage.snapshot(KEY).text).toBeUndefined()
    // Until the room echoes it, the map keeps showing what was published, not the old state.
    expect(screen.queryByText(/Unpublished edits/)).toBeNull()
    act(() => {
      h.session.emitMessage(worldMessage(body.content))
    })
    await act(() => flush())
    expect(screen.getByText('World state for turn 2: 6 assets')).toBeTruthy()
  })

  it('publishes with the phase change from the turn panel, with the summary first', async () => {
    const { h, storage } = await mount(
      'admin',
      <>
        <TurnPanel />
        {mapPanel}
      </>,
      undefined,
      at(1, 'adjudication'),
    )
    await editHealth('Tank Company', '40')
    fireEvent.click(screen.getByRole('button', { name: 'Start turn 2…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Start turn 2?' })
    await waitFor(() => {
      expect(dialog.textContent).toContain('Tank Company: health 100% → 40%')
    })
    expect(dialog.textContent).toContain('published with this change, for turn 2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start turn 2' }))
    await act(() => flush())
    const writes = h.session.calls.filter((c) => c.op === 'send' || c.op === 'publish')
    expect(writes.map((c) => c.op)).toEqual(['send', 'publish'])
    expect((JSON.parse(String(writes[0]?.args[1])) as { content: WorldState }).content.turn).toBe(2)
    expect(storage.snapshot(KEY).text).toBeUndefined()
  })

  it('says the world state went out when only the phase change fails, and retries the phase alone (L3, WP 5.9)', async () => {
    const { h, storage } = await mount(
      'admin',
      <>
        <TurnPanel />
        {mapPanel}
      </>,
      undefined,
      at(1, 'adjudication'),
    )
    await editHealth('Tank Company', '40')
    h.session.stub('pubsub', 'publish', () => Promise.resolve(err('remote-server-timeout')))
    fireEvent.click(screen.getByRole('button', { name: 'Start turn 2…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Start turn 2?' })
    await waitFor(() => {
      expect(dialog.textContent).toContain('Tank Company: health 100% → 40%')
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start turn 2' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe(
      'The world state for turn 2 was published and players see it, but the phase did not move: the server did not answer. Try again. Confirm again to move the phase; the world state is not sent again.',
    )
    expect(alert.textContent).not.toMatch(/not published/)
    // The draft was published: it is cleared, and the map shows no unpublished edits.
    expect(storage.snapshot(KEY).text).toBeUndefined()
    expect(screen.queryByText(/Unpublished edits/)).toBeNull()
    // The confirmation stays, and now says only the phase is left.
    expect(screen.getByRole('dialog', { name: 'Start turn 2?' })).toBe(dialog)
    expect(dialog.textContent).toContain('confirming now moves only the phase')
    expect(dialog.textContent).not.toContain('Tank Company: health 100% → 40%')
    h.session.stub('pubsub', 'publish', () => Promise.resolve(ok(undefined)))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start turn 2' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    const writes = h.session.calls.filter((c) => c.op === 'send' || c.op === 'publish')
    expect(writes.map((c) => c.op)).toEqual(['send', 'publish', 'publish'])
  })

  it('says a phase change with no edits publishes no world state', async () => {
    const storage = memoryWorldDraftStorage()
    // A draft equal to the published state: nothing to publish.
    storage.save(
      KEY,
      JSON.stringify({
        format: 'wrx1-world-draft',
        schemaVersion: 1,
        state: sampleWorldState(),
        savedAt: '2026-11-04T10:00:00Z',
      }),
    )
    const { h } = await mount('admin', <TurnPanel />, storage)
    fireEvent.click(screen.getByRole('button', { name: 'Start adjudication…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Start adjudication?' })
    await waitFor(() => {
      expect(dialog.textContent).toContain('no world state is published with this change')
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start adjudication' }))
    await act(() => flush())
    expect(sends(h)).toEqual([])
  })

  it('warns when the state a draft began from is gone from the room, as after a reset (WP 5.7 review)', async () => {
    const storage = memoryWorldDraftStorage()
    storage.save(
      KEY,
      serialiseWorldDraft({
        state: sampleWorldState(),
        baseStanzaId: 'a-state-from-the-game-before',
        savedAt: '2026-11-01T10:00:00.000Z',
      }),
    )
    await mount('admin', mapPanel, storage, at(1, 'planning'), [])
    expect(screen.getByText(/^Unpublished edits: 6 assets changed/)).toBeTruthy()
    expect(screen.getByText('This draft may belong to an earlier game')).toBeTruthy()
  })

  it('never offers an empty map to edit when the published state is behind many other messages; looks further on request (WP 5.7 review)', async () => {
    await mount('admin', mapPanel, memoryWorldDraftStorage(), at(1, 'planning'), undefined, {
      noise: 40,
      worldStatePageLimit: 2,
    })
    expect(
      screen.getByText(/latest world state was not among this room’s recent messages/),
    ).toBeTruthy()
    expect(editor()).toBeNull()
    expect(screen.queryByText(/has not published a world state yet/)).toBeNull()
    for (let i = 0; i < 4 && screen.queryByText('World state for turn 1: 6 assets') === null; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Look further back' }))
      await act(() => flush(30))
    }
    expect(screen.getByText('World state for turn 1: 6 assets')).toBeTruthy()
    expect(editor()).toBeTruthy()
  })

  it('reports a draft the browser would not keep', async () => {
    await mount('admin', mapPanel, memoryWorldDraftStorage({ failWith: 'QuotaExceededError' }))
    await editHealth('Tank Company', '40')
    expect(screen.getByText(/This browser did not keep your last edit/)).toBeTruthy()
    // It is still shown, until reload.
    expect(screen.getByText(/Unpublished edits: 1 asset changed/)).toBeTruthy()
  })
})

describe('the editor’s parts', () => {
  it('reads the form into an asset, or an error per field', () => {
    const asset = sampleWorldState().assets[WORLD_ASSET.blueArmour]
    if (asset === undefined) throw new Error('fixture')
    const values = {
      title: ' A Squadron ',
      forceId: asset.forceId,
      category: 'armour',
      sidc: 'sfgpuca----k---',
      lat: '52',
      lon: '5.9',
      state: 'operational',
      health: '80',
      fuel: '',
    }
    expect(readAssetForm(asset.id, values)).toEqual({
      ok: false,
      errors: { fuel: 'Enter a number.' },
    })
    const read = readAssetForm(asset.id, { ...values, fuel: '50' })
    expect(read).toMatchObject({
      ok: true,
      asset: { title: 'A Squadron', sidc: 'SFGPUCA----K---' },
    })
    expect(readAssetForm(asset.id, { ...values, fuel: '5', lat: '95' })).toEqual({
      ok: false,
      errors: { lat: 'Enter a latitude from −90 to 90.' },
    })
  })

  it('words a change, position once', () => {
    const before = sampleWorldState().assets[WORLD_ASSET.blueArmour]
    if (before === undefined) throw new Error('fixture')
    const after = { ...before, lat: 52, lon: 6, fuel: 10 }
    expect(
      describeChange({ before, after, fields: ['lat', 'lon', 'fuel'] }, sampleDesign().forces),
    ).toBe(`position 51.9700° N, 5.8500° E → 52.0000° N, 6.0000° E; fuel 100% → 10%`)
  })

  it('reads the published state for export, says when there is none, and when it could not be read in time (WP 5.7 review)', async () => {
    const found = await mount('admin', null)
    expect(await readPublishedWorldState(found.h.store, tid('map'))).toEqual({
      status: 'found',
      state: sampleWorldState(),
    })
    cleanup()
    const none = await mount('admin', null, memoryWorldDraftStorage(), at(1, 'planning'), [])
    expect(await readPublishedWorldState(none.h.store, tid('map'))).toEqual({ status: 'none' })
    cleanup()
    // A search that never ends: after the timeout it is unavailable, with why, not none.
    let released = false
    const silent = {
      acquireWorldState: () => () => {
        released = true
      },
      worldState: () => ({ status: 'loading', data: undefined }),
      subscribe: () => () => undefined,
    } as unknown as SessionStore
    expect(await readPublishedWorldState(silent, tid('map'), 50)).toEqual({
      status: 'unavailable',
      reason: 'the map room did not answer within 0 seconds',
    })
    expect(released).toBe(true)
  })

  it('refuses a state over 500 KB, with its size', () => {
    const base = sampleWorldState().assets[WORLD_ASSET.blueArmour]
    if (base === undefined) throw new Error('fixture')
    const assets = Object.fromEntries(
      Array.from({ length: 2_000 }, (_, i) => {
        const id = `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
        return [id, { ...base, id }]
      }),
    )
    expect(sizeRefusal({ turn: 1, assets })).toMatch(/the map room takes at most 500,000/)
    expect(sizeRefusal(sampleWorldState())).toBeUndefined()
  })

  it('tells every reader of a key, and other tabs, when a draft changes', () => {
    const backing = new Map<string, string>()
    const local = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        backing.set(k, v)
      },
      removeItem: (k: string) => {
        backing.delete(k)
      },
    }
    const storage = webWorldDraftStorage(
      () => local,
      (k) => `ns:${k}`,
    )
    const seen: (string | undefined)[] = []
    const stop = storage.subscribe('k', () => {
      seen.push(storage.snapshot('k').text)
    })
    expect(storage.save('k', 'one')).toBeUndefined()
    expect(backing.get('ns:k')).toBe('one')
    const first = storage.snapshot('k')
    expect(storage.snapshot('k')).toBe(first)
    // Another tab writes: the storage event names the full key.
    backing.set('ns:k', 'two')
    window.dispatchEvent(new StorageEvent('storage', { key: 'ns:k' }))
    // A publish clears only the text that was published.
    storage.published('k', 'one', sampleWorldState(), 's-1')
    expect(backing.get('ns:k')).toBe('two')
    storage.published('k', 'two', sampleWorldState(), 's-1')
    expect(backing.has('ns:k')).toBe(false)
    expect(storage.snapshot('k').published?.replacing).toBe('s-1')
    stop()
    expect(seen).toEqual(['one', 'two', 'two', undefined])
  })

  it('describes a held draft for the reset’s offer (WP 5.9, M3)', () => {
    const storage = memoryWorldDraftStorage()
    expect(heldWorldDraft(storage, 'k')).toBeUndefined()
    storage.save(
      'k',
      serialiseWorldDraft({
        state: sampleWorldState(),
        baseStanzaId: undefined,
        savedAt: '2026-11-04T10:00:00.000Z',
      }),
    )
    expect(heldWorldDraft(storage, 'k')).toEqual({
      assets: 6,
      savedAt: '2026-11-04T10:00:00.000Z',
    })
    storage.save('k', 'not a draft')
    expect(heldWorldDraft(storage, 'k')).toEqual({ assets: undefined, savedAt: undefined })
  })
})
