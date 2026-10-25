// @vitest-environment happy-dom
// The Publish section in the admin app, against a mock server in the test: plan, the vault,
// confirmation, progress, the result, a second publish that plans nothing, warnings that need
// ticking, the credentials sheet and password reset, reset with typed confirmation, and design
// import / export. Server effects are checked through a role's own login.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AdminOps, VAULT_KDF, memoryMarkerStore } from '@wrx/admin-ops'
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import type { AdminEditor, PlayerPanel } from '@wrx/hooks'
import { DEMO_VAULT_PASSPHRASE, MockServer, MockTransport, demoState } from '@wrx/mock-server'
import { sampleDesign } from '@wrx/schemas/fixtures'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApp } from '../AdminApp.tsx'
import {
  createDraftStore,
  deleteRole,
  draftFromDesign,
  memoryDraftPersistence,
  updateRoom,
} from '../draft/index.ts'
import type { DraftStore } from '../draft/index.ts'
import type { PublishConnection } from './controller.ts'
import { PublishSectionCore } from './PublishSection.tsx'
import type { PublishSectionCoreProps } from './PublishSection.tsx'
import { validateDraft } from '../draft/index.ts'

vi.setConfig({ testTimeout: 30_000 })
afterEach(cleanup)

const domain = 'wrx.test'
const endpoint = { websocketUrl: 'mock://publish-ui', domain }
const PASSPHRASE = 'a long enough vault passphrase'

async function connected(): Promise<{ connection: PublishConnection; transport: MockTransport }> {
  const transport = new MockTransport(new MockServer({ domain, adminPassword: 'demo-admin' }))
  const session = await transport.connect({
    endpoint,
    credentials: { kind: 'password', username: 'admin', password: 'demo-admin' },
  })
  if (!session.ok) throw new Error('admin login')
  return {
    transport,
    connection: {
      ops: new AdminOps({ session: session.value, login: { transport, endpoint } }),
      kind: 'mock',
      marker: memoryMarkerStore(),
      vaultIterations: VAULT_KDF.minIterations,
    },
  }
}

async function setup() {
  const { connection, transport } = await connected()
  const store = createDraftStore({
    persistence: memoryDraftPersistence(),
    initial: () => draftFromDesign(sampleDesign()),
  })
  const download = vi.fn<(name: string, text: string) => void>()
  const print = vi.fn<() => void>()
  render(
    createElement(AdminApp, {
      store,
      registry: withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {}),
      initialSection: 'publish',
      publish: connection,
      download,
      print,
    }),
  )
  return { user: userEvent.setup(), store, connection, transport, download, print }
}

const planRegion = () => screen.getByRole('region', { name: /plan$/ })

/** The disclosure button of a group in the plan, e.g. "Access". */
const groupButton = (name: string) =>
  within(within(planRegion()).getByRole('region', { name })).getAllByRole('button')[0]!

const stepItems = () =>
  within(planRegion())
    .queryAllByRole('listitem')
    .filter((li) => li.dataset.step !== undefined)

async function planAndWait(
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp = /plan/i,
) {
  await user.click(screen.getByRole('button', { name: label }))
  await waitFor(() => {
    expect(screen.getByRole('region', { name: /plan$/ })).toBeTruthy()
  })
}

async function publishAll(user: ReturnType<typeof userEvent.setup>, ticks: RegExp[] = []) {
  await user.click(within(planRegion()).getByRole('button', { name: /^Publish \d+ changes?…$/ }))
  const dialog = screen.getByRole('alertdialog', { name: 'Publish these changes?' })
  const confirm = within(dialog).getByRole('button', { name: 'Publish' })
  for (const tick of ticks) {
    expect(confirm).toHaveProperty('disabled', true)
    await user.click(within(dialog).getByRole('checkbox', { name: tick }))
  }
  expect(confirm).toHaveProperty('disabled', false)
  await user.click(confirm)
  await waitFor(
    () => {
      expect(screen.getByText(/Checked again:/)).toBeTruthy()
    },
    { timeout: 20_000 },
  )
}

async function firstPublish(ctx: Awaited<ReturnType<typeof setup>>) {
  const { user } = ctx
  await planAndWait(user, 'Check the server and plan')
  // The observer needs the vault, which does not exist yet.
  expect(within(planRegion()).getByText(/A vault is needed/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Create the vault' }))
  const dialog = screen.getByRole('alertdialog', { name: /Create the observer-password vault/ })
  await user.type(within(dialog).getByLabelText('Passphrase'), PASSPHRASE)
  await user.type(within(dialog).getByLabelText('Passphrase again'), PASSPHRASE)
  await user.click(within(dialog).getByRole('button', { name: 'Create' }))
  await waitFor(() => {
    expect(screen.getByText(/Vault unlocked/)).toBeTruthy()
  })
  await waitFor(() => {
    expect(within(planRegion()).queryByText(/A vault is needed/)).toBeNull()
  })
  await publishAll(user)
}

function storeRole(store: DraftStore, id: string) {
  return store.getSnapshot().draft.design.roles.find((r) => r.id === id)
}

describe('the Publish section (ADM-10, ADM-11)', () => {
  it('plans by group, creates the vault, publishes with progress, then plans nothing', async () => {
    const { user } = await setup()
    await planAndWait(user, 'Check the server and plan')
    const plan = planRegion()
    for (const group of ['Accounts', 'Rooms', 'Nodes', 'Access', 'Documents', 'Game setup']) {
      expect(within(plan).getByRole('region', { name: group })).toBeTruthy()
      // Collapsed by default, with a count and a status.
      expect(groupButton(group).getAttribute('aria-expanded')).toBe('false')
    }
    expect(within(plan).queryByRole('region', { name: 'Removals' })).toBeNull()
    expect(stepItems()).toEqual([])
    expect(groupButton('Access').textContent).toBe('▸Access19 stepsTo do')
    expect(groupButton('Nodes').textContent).toContain('Create nodes: 17 nodes')
    // Repeated access steps read as one line each kind, expandable to every step.
    await user.click(groupButton('Access'))
    expect(groupButton('Access').getAttribute('aria-expanded')).toBe('true')
    const access = within(plan).getByRole('region', { name: 'Access' })
    const nodeGrants = within(access).getByRole('button', {
      name: /^Give node access: 15 nodes × roles \(54 grants\)/,
    })
    expect(nodeGrants.getAttribute('aria-expanded')).toBe('false')
    expect(stepItems().map((li) => li.dataset.step)).toEqual(['read-only-grant:blue-observer'])
    await user.click(nodeGrants)
    expect(stepItems()).toHaveLength(16)
    expect(access.textContent).toContain('Blue CO: read')
    await user.click(groupButton('Access'))
    expect(stepItems()).toEqual([])
    await user.click(within(plan).getByRole('button', { name: 'Show every step' }))
    expect(stepItems()).toHaveLength(57)
    await user.click(within(plan).getByRole('button', { name: 'Collapse every group' }))
    expect(stepItems()).toEqual([])
    expect(screen.getByText(/the game becomes design version 1/)).toBeTruthy()
    expect(screen.getByText(/No rooms yet; checked after publishing/)).toBeTruthy()
    // Applying is blocked until the vault exists.
    expect(within(plan).getByRole('button', { name: /^Publish \d+ changes…$/ })).toHaveProperty(
      'disabled',
      true,
    )

    cleanup()
    const fresh = await setup()
    await firstPublish(fresh)
    const groups = within(planRegion()).getAllByRole('region')
    expect(groups.map((g) => g.dataset.state)).toEqual(groups.map(() => 'done'))
    expect(groupButton('Access').textContent).toContain('Done')
    expect(within(planRegion()).getByText(/^All 57 steps done\.$/)).toBeTruthy()
    await fresh.user.click(within(planRegion()).getByRole('button', { name: 'Show every step' }))
    const steps = stepItems()
    expect(steps).toHaveLength(57)
    expect(steps.every((li) => li.dataset.state === 'done')).toBe(true)
    expect(screen.getByText(/Publish complete: \d+ steps applied, design version 1/)).toBeTruthy()
    expect(screen.getByText('Checked again: nothing is left to publish.')).toBeTruthy()
    // After the publish the room checks run and pass (NFR-4).
    expect(screen.getByText(/All 3 rooms are members-only/)).toBeTruthy()
    expect(screen.getByText(/The archive of .* answers/)).toBeTruthy()
    // The draft records the publish: login ids are fixed (ADM-5).
    expect(fresh.store.getSnapshot().draft.meta.publishedRoleIds).toContain('blue-co')

    // A second publish of the same draft plans nothing (ADM-10).
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await planAndWait(fresh.user, 'Check the server and plan')
    expect(screen.getByText('Nothing to publish: the server matches the draft.')).toBeTruthy()
  })

  it('shows the credentials sheet with labelled demo passwords that log in; resets one (ADM-26)', async () => {
    const ctx = await setup()
    await firstPublish(ctx)
    const { user, transport, print } = ctx
    await user.click(screen.getByRole('button', { name: 'Show the credentials sheet' }))
    const sheet = screen.getByRole('table', { name: 'Role credentials' })
    expect(within(sheet).getAllByRole('row')).toHaveLength(5)
    expect(screen.getByText(/DEMO PASSWORDS: known, not secret/)).toBeTruthy()
    const row = within(sheet).getByRole('row', { name: /Blue Observer/ })
    expect(row.textContent).toContain('blue-observer')
    expect(row.textContent).toContain('demo-blue-observer')
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)

    // The demo password logs in.
    const login = await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'blue-observer', password: 'demo-blue-observer' },
    })
    expect(login.ok).toBe(true)
    if (login.ok) await login.value.disconnect()

    // A reset sets a new password on the server and in the vault (the role is read-only).
    await user.click(
      within(row).getByRole('button', { name: 'Reset the password of Blue Observer' }),
    )
    await waitFor(() => {
      expect(row.textContent).toContain('demo-blue-observer')
    })
    const again = await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'blue-observer', password: 'demo-blue-observer' },
    })
    expect(again.ok).toBe(true)
    if (again.ok) await again.value.disconnect()
  })

  it('a change: lists affected online roles, warns, and needs each destructive warning ticked', async () => {
    const ctx = await setup()
    await firstPublish(ctx)
    const { user, store, transport } = ctx
    await user.click(screen.getByRole('button', { name: 'Close' }))
    // Red CO is online.
    const red = await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'red-co', password: 'demo-red-co' },
    })
    if (!red.ok) throw new Error('red login')
    const sent = await red.value.muc.join(`negotiation@conference.${domain}`, 'red-co')
    expect(sent.ok).toBe(true)
    await red.value.muc.send(`negotiation@conference.${domain}`, JSON.stringify({ text: 'hi' }))

    let draft = store.getSnapshot().draft
    draft = deleteRole(draft, 'red-co')
    draft = {
      ...draft,
      design: { ...draft.design, rooms: draft.design.rooms.filter((r) => r.id !== 'negotiation') },
    }
    draft = updateRoom(draft, 'blue-hq', { name: 'Blue headquarters' })
    store.commit(draft)
    await planAndWait(user, 'Check the server and plan')
    const plan = planRegion()
    expect(within(plan).getByRole('region', { name: 'Removals' })).toBeTruthy()
    expect(within(plan).getByLabelText('Online roles affected').textContent).toContain('Red CO')
    expect(plan.textContent).toContain(
      'Its message history stays attributed to its old login, red-co',
    )
    expect(plan.textContent).toContain(
      'Blue–Red negotiation is destroyed with its history: 1 message deleted for good',
    )
    expect(screen.getByText(/the game becomes design version 2/)).toBeTruthy()
    await publishAll(user, [/Delete Red CO/, /Destroy Blue–Red negotiation and its 1 message/])
    expect(storeRole(store, 'red-co')).toBeUndefined()
    expect(store.getSnapshot().draft.design.game.designVersion).toBe(2)
    await red.value.disconnect()
  })

  it('a failure stops the publish, says what did not run, and re-planning completes it', async () => {
    const ctx = await setup()
    const { user, connection } = ctx
    // The admin cannot create one room: the server refuses it once.
    const muc = connection.ops.session.muc
    const original = muc.createRoom.bind(muc)
    let refused = false
    muc.createRoom = (room, config) => {
      if (!refused && room.startsWith('red-hq@')) {
        refused = true
        return Promise.resolve({ ok: false, error: { condition: 'internal-server-error' } })
      }
      return original(room, config)
    }
    await planAndWait(user, 'Check the server and plan')
    await user.click(screen.getByRole('button', { name: 'Create the vault' }))
    const dialog = screen.getByRole('alertdialog', { name: /Create the observer-password vault/ })
    await user.type(within(dialog).getByLabelText('Passphrase'), PASSPHRASE)
    await user.type(within(dialog).getByLabelText('Passphrase again'), PASSPHRASE)
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => {
      expect(screen.getByText(/Vault unlocked/)).toBeTruthy()
    })
    await user.click(within(planRegion()).getByRole('button', { name: /^Publish \d+ changes…$/ }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publish' }),
    )
    await waitFor(() => {
      expect(screen.getByText('Publish stopped at a failure.')).toBeTruthy()
    })
    // The group holding the failure opens by itself and says so; the others stay closed.
    expect(groupButton('Rooms').getAttribute('aria-expanded')).toBe('true')
    expect(groupButton('Rooms').textContent).toContain('Failed: 1 of 3 done')
    expect(groupButton('Accounts').getAttribute('aria-expanded')).toBe('false')
    expect(groupButton('Accounts').textContent).toContain('Done')
    expect(groupButton('Nodes').textContent).toContain('Not run')
    expect(
      within(planRegion()).getByText(/^Stopped at a failure: 5 of 57 steps done\.$/),
    ).toBeTruthy()
    const failed = stepItems().filter((li) => li.dataset.state === 'failed')
    expect(failed.map((li) => li.dataset.step)).toEqual(['room:red-hq'])
    expect(screen.getByText(/steps? not run\. Nothing after the failure was applied/)).toBeTruthy()
    expect(
      within(planRegion())
        .getAllByRole('listitem')
        .some((li) => li.dataset.state === 'not-run'),
    ).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Plan the rest again' }))
    await waitFor(() => {
      expect(groupButton('Rooms').textContent).toContain('Create rooms: 2 rooms')
    })
    await user.click(groupButton('Rooms'))
    expect(within(planRegion()).queryByText('Create room Blue HQ')).toBeNull()
    expect(within(planRegion()).getByText('Create room Red HQ')).toBeTruthy()
    // Accounts the first run created exist: they are neither created again nor reset (F3).
    expect(screen.getAllByText(/already exists, so it is not created/).length).toBeGreaterThan(0)
    expect(within(planRegion()).queryByRole('region', { name: 'Accounts' })).toBeNull()
    await publishAll(user)
    expect(screen.getByText('Checked again: nothing is left to publish.')).toBeTruthy()
  })

  it('resets the game only after the game name is typed (ADM-15)', async () => {
    const ctx = await setup()
    await firstPublish(ctx)
    const { user, transport, store } = ctx
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Plan a reset' }))
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Reset plan' })).toBeTruthy()
    })
    await user.click(screen.getByRole('button', { name: 'Reset the game…' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Reset the game?' })
    const confirm = within(dialog).getByRole('button', { name: 'Reset the game' })
    for (const box of within(dialog).getAllByRole('checkbox')) await user.click(box)
    expect(confirm).toHaveProperty('disabled', true)
    await user.type(within(dialog).getByLabelText(/to confirm/), 'Exercise Northern')
    expect(confirm).toHaveProperty('disabled', true)
    await user.type(within(dialog).getByLabelText(/to confirm/), ' Gate')
    expect(confirm).toHaveProperty('disabled', false)
    await user.click(confirm)
    await waitFor(() => {
      expect(screen.getByText(/Reset complete/)).toBeTruthy()
    })
    const login = await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'blue-co', password: 'demo-blue-co' },
    })
    expect(login.ok).toBe(false)
    // The next publish is a new design version.
    expect(store.getSnapshot().draft.design.game.designVersion).toBe(2)
  })
})

describe('on the mock’s demo seed, which starts published with its vault', () => {
  async function demoSetup(kind: 'mock' | 'xmpp') {
    const state = demoState()
    const transport = new MockTransport(new MockServer({ seed: state }))
    const demoEndpoint = { websocketUrl: 'mock://demo', domain: state.domain }
    const session = await transport.connect({
      endpoint: demoEndpoint,
      credentials: { kind: 'password', username: 'admin', password: 'demo-admin' },
    })
    if (!session.ok) throw new Error('admin login')
    // A draft saved before the seed was published here: no role recorded as published.
    const store = createDraftStore({
      persistence: memoryDraftPersistence(),
      initial: () => draftFromDesign(sampleDesign()),
    })
    render(
      createElement(AdminApp, {
        store,
        registry: withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {}),
        initialSection: 'publish',
        publish: {
          ops: new AdminOps({
            session: session.value,
            login: { transport, endpoint: demoEndpoint },
          }),
          kind,
          marker: memoryMarkerStore(),
          ...(kind === 'mock' ? { demoVaultPassphrase: DEMO_VAULT_PASSPHRASE } : {}),
        },
      }),
    )
    return { user: userEvent.setup(), store }
  }

  it('plans nothing, records the server’s roles as published with demo passwords, and unlocks with the demo passphrase', async () => {
    const { user, store } = await demoSetup('mock')
    expect(screen.getAllByText(DEMO_VAULT_PASSPHRASE).length).toBeGreaterThan(0)
    expect(screen.getByText('No role has been published yet.')).toBeTruthy()
    await planAndWait(user, 'Check the server and plan')
    expect(screen.getByText('Nothing to publish: the server matches the draft.')).toBeTruthy()
    expect([...store.getSnapshot().draft.meta.publishedRoleIds].sort()).toEqual(
      sampleDesign()
        .roles.map((r) => r.id)
        .sort(),
    )
    await user.click(screen.getByRole('button', { name: 'Show the credentials sheet' }))
    const sheet = screen.getByRole('table', { name: 'Role credentials' })
    const row = within(sheet).getByRole('row', { name: /Blue Observer/ })
    expect(row.textContent).toContain('demo-blue-observer')
    expect(row.textContent).toContain('demo')

    await user.click(screen.getByRole('button', { name: 'Unlock the vault' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Unlock the vault' })
    expect(within(dialog).getByText(/DEMO vault/).textContent).toContain(DEMO_VAULT_PASSPHRASE)
    await user.type(within(dialog).getByLabelText('Passphrase'), DEMO_VAULT_PASSPHRASE)
    await user.click(within(dialog).getByRole('button', { name: 'Unlock' }))
    await waitFor(
      () => {
        expect(screen.getByText(/Vault unlocked\./)).toBeTruthy()
      },
      { timeout: 10_000 },
    )
  })

  it('on a real server, shows no demo passphrase and issues no demo passwords', async () => {
    const { user } = await demoSetup('xmpp')
    expect(screen.queryByText(/DEMO vault/)).toBeNull()
    await planAndWait(user, 'Check the server and plan')
    await user.click(screen.getByRole('button', { name: 'Show the credentials sheet' }))
    const sheet = screen.getByRole('table', { name: 'Role credentials' })
    expect(within(sheet).getByRole('row', { name: /Blue Observer/ }).textContent).toContain(
      'Not known here',
    )
    await user.click(screen.getByRole('button', { name: 'Unlock the vault' }))
    expect(screen.queryByText(/DEMO vault/)).toBeNull()
  })
})

describe('design export and import (ADM-16)', () => {
  it('exports the draft without passwords', async () => {
    const { user, download } = await setup()
    await user.click(screen.getByRole('button', { name: 'Export the design' }))
    const [name, text] = download.mock.calls[0] ?? []
    expect(name).toMatch(/^exercise-northern-gate-design-\d{4}-\d{2}-\d{2}\.json$/)
    expect(text).not.toContain('password')
    const exported: unknown = JSON.parse(text ?? '{}')
    expect(exported).toMatchObject({ format: 'wrx1-design' })
    expect(exported).toHaveProperty('roles')
  })

  it('refuses a file with a password, and imports a valid one after confirmation', async () => {
    const { user, store } = await setup()
    const input = screen.getByLabelText('Import a design…')
    const withPassword = sampleDesign()
    const bad = { ...withPassword, roles: withPassword.roles.map((r) => ({ ...r, password: 'x' })) }
    await user.upload(
      input,
      new File([JSON.stringify(bad)], 'bad.json', { type: 'application/json' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Replace the draft' }))
    expect(screen.getByText('bad.json was not imported.')).toBeTruthy()
    expect(screen.getAllByText(/designs never carry passwords/).length).toBeGreaterThan(0)

    const good = { ...sampleDesign(), game: { ...sampleDesign().game, name: 'Imported game' } }
    await user.upload(
      input,
      new File([JSON.stringify(good)], 'good.json', { type: 'application/json' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Replace the draft' }))
    expect(screen.getByText('Imported good.json.')).toBeTruthy()
    expect(store.getSnapshot().draft.design.game.name).toBe('Imported game')

    const broken = {
      ...sampleDesign(),
      roles: [{ ...sampleDesign().roles[0]!, forceId: 'nowhere' }],
    }
    await user.upload(input, new File([JSON.stringify(broken)], 'broken.json'))
    await user.click(await screen.findByRole('button', { name: 'Replace the draft' }))
    expect(screen.getByText('broken.json was not imported.')).toBeTruthy()
    expect(screen.getByText(/unknown force "nowhere"/)).toBeTruthy()
    expect(store.getSnapshot().draft.design.game.name).toBe('Imported game')
  })
})

describe('PublishSectionCore', () => {
  const draft = draftFromDesign(sampleDesign())
  const base: PublishSectionCoreProps = {
    connection: undefined,
    draft,
    validation: validateDraft(draft.design),
    snapshot: {
      busy: undefined,
      plan: undefined,
      checks: [],
      progress: new Map(),
      result: undefined,
      remaining: undefined,
      error: undefined,
      vault: 'unknown',
      credentials: [],
      online: [],
      plannedFrom: undefined,
    },
    onPlan: vi.fn(),
    onPlanReset: vi.fn(),
    onApply: vi.fn(),
    onDismiss: vi.fn(),
    onCreateVault: () => Promise.resolve(undefined),
    onUnlockVault: () => Promise.resolve(undefined),
    onLockVault: vi.fn(),
    onResetPassword: () => Promise.resolve(undefined),
    onExport: vi.fn(),
    onImport: () => [],
  }

  it('without a server, offers only import and export', () => {
    render(createElement(PublishSectionCore, base))
    expect(screen.getByText('Not connected to a server.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /plan/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export the design' })).toBeTruthy()
  })

  it('blocks planning while the draft has errors', () => {
    const broken = draftFromDesign({
      ...sampleDesign(),
      game: { ...sampleDesign().game, name: '' },
    })
    render(
      createElement(PublishSectionCore, {
        ...base,
        connection: { kind: 'xmpp' },
        draft: broken,
        validation: validateDraft(broken.design),
      }),
    )
    expect(screen.getByText('The draft has errors.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check the server and plan' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.queryByText('Mock server.')).toBeNull()
  })
})
