// @vitest-environment happy-dom
// The Audit section: `AuditSectionCore` over plain props (grouping by severity, selection,
// confirmation of destructive repairs, the vault prompt, progress), and the section in the admin
// app against a mock server: audit a published game, unlock the vault when asked, see injected
// drift, repair it, and see the clean re-audit.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import {
  AdminOps,
  CredentialsBook,
  ObserverVault,
  VAULT_KDF,
  executePlan,
  planConfirmations,
  gameRoomConfig,
  preparePublish,
} from '@wrx/admin-ops'
import type { AuditItem, AuditReport } from '@wrx/admin-ops'
import { defaultRoomTypes, withSlots } from '@wrx/domain'
import type { AdminEditor, PlayerPanel } from '@wrx/hooks'
import { MockServer, MockTransport } from '@wrx/mock-server'
import { sampleDesign } from '@wrx/schemas/fixtures'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApp } from '../AdminApp.tsx'
import { createDraftStore, draftFromDesign, memoryDraftPersistence } from '../draft/index.ts'
import { AuditSectionCore } from './AuditSection.tsx'
import type { AuditSectionCoreProps } from './AuditSection.tsx'
import { IDLE_AUDIT } from './controller.ts'

vi.setConfig({ testTimeout: 30_000 })
afterEach(cleanup)

const PASSPHRASE = 'a long enough vault passphrase'

function auditItem(overrides: Partial<AuditItem> & Pick<AuditItem, 'id' | 'kind'>): AuditItem {
  return {
    target: 'red-hq',
    expected: 'moderated: true',
    found: 'moderated: false',
    severity: 'critical',
    repairable: true,
    destructive: false,
    repair: [{ type: 'ensure-room', roomId: 'red-hq', name: 'Red HQ', create: false }],
    ...overrides,
  }
}

const REPORT: AuditReport = {
  items: [
    auditItem({ id: 'room-config:red-hq', kind: 'room-config' }),
    auditItem({
      id: 'account-unknown:ghost',
      kind: 'account-unknown',
      target: 'ghost',
      roleId: 'ghost',
      severity: 'high',
      destructive: true,
      expected: 'no account that is not a role of the design',
      found: 'an account',
      repair: [{ type: 'delete-role', roleId: 'ghost', rooms: [], nodes: [] }],
    }),
    auditItem({
      id: 'foreign-access:objectives:blue:spy@x',
      kind: 'foreign-access',
      target: 'objectives:blue',
      repairable: false,
      repair: [],
    }),
    auditItem({
      id: 'node-names-public',
      kind: 'node-names-public',
      target: 'pubsub',
      severity: 'info',
      repairable: false,
      repair: [],
      expected: 'node names reveal nothing confidential',
      found: '12 node names, listable by anyone, even without logging in',
    }),
  ],
  vault: 'unlocked',
  voiceChecked: 1,
  publishedVersion: 1,
  online: [],
}

function core(overrides: Partial<AuditSectionCoreProps> = {}) {
  const design = sampleDesign()
  const props: AuditSectionCoreProps = {
    connected: true,
    design,
    snapshot: { ...IDLE_AUDIT, report: REPORT, auditedFrom: design },
    onRun: vi.fn(),
    onUnlockVault: vi.fn(() => Promise.resolve(undefined)),
    onRepair: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  }
  render(createElement(AuditSectionCore, props))
  return { props, user: userEvent.setup() }
}

describe('AuditSectionCore', () => {
  it('groups differences by severity, with expected and found', () => {
    core()
    const report = screen.getByRole('region', { name: 'Audit report' })
    expect(within(report).getByText('3 differences: 2 critical, 1 high.')).toBeTruthy()
    const critical = within(report).getByRole('region', { name: 'Critical (2)' })
    expect(within(critical).getByText('Room settings: red-hq')).toBeTruthy()
    expect(within(critical).getAllByText('moderated: false')).toHaveLength(2)
    expect(within(critical).getByText('Not repairable here')).toBeTruthy()
    const info = within(report).getByRole('region', { name: 'Information (1)' })
    expect(within(info).getByText(/listable by anyone/)).toBeTruthy()
    // Only repairable items can be selected.
    expect(within(report).getAllByRole('checkbox')).toHaveLength(2)
  })

  it('repairs the selected items; a destructive one needs its own tick', async () => {
    const { props, user } = core()
    await user.click(screen.getByRole('checkbox', { name: /Room settings: red-hq/ }))
    await user.click(screen.getByRole('checkbox', { name: /Account with no role: ghost/ }))
    await user.click(screen.getByRole('button', { name: 'Repair selected (2)…' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Repair these differences?' })
    const confirm = within(dialog).getByRole('button', { name: 'Repair' })
    expect(confirm).toHaveProperty('disabled', true)
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: /Delete the account ghost and remove its access/,
      }),
    )
    await user.click(confirm)
    expect(props.onRepair).toHaveBeenCalledWith(
      ['room-config:red-hq', 'account-unknown:ghost'],
      ['account-unknown:ghost'],
    )
  })

  it('asks for the vault when the voice checks need it', async () => {
    const { props, user } = core({
      snapshot: { ...IDLE_AUDIT, report: { ...REPORT, vault: 'locked' } },
    })
    expect(screen.getByText('Unlock the vault to check observer voice.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Unlock the vault' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Unlock the vault' })
    await user.type(within(dialog).getByLabelText('Passphrase'), PASSPHRASE)
    await user.click(within(dialog).getByRole('button', { name: 'Unlock' }))
    expect(props.onUnlockVault).toHaveBeenCalledWith(PASSPHRASE)
  })

  it('shows progress while auditing, and nothing to do when not connected', () => {
    core({
      snapshot: {
        ...IDLE_AUDIT,
        busy: 'auditing',
        progress: { phase: 'voice', done: 0, total: 2, target: 'blue-observer' },
      },
    })
    expect(screen.getByRole('status').textContent).toBe(
      'Checking voice through each read-only role’s login (1 of 2): blue-observer…',
    )
    cleanup()
    core({ connected: false })
    expect(screen.getByText('Not connected to a server.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Run the audit' })).toBeNull()
  })
})

describe('the Audit section in the admin app, on a mock server', () => {
  it('audits a published game, finds injected drift, repairs it and audits clean', async () => {
    const domain = 'wrx.test'
    const endpoint = { websocketUrl: 'mock://audit-ui', domain }
    const transport = new MockTransport(new MockServer({ domain, adminPassword: 'demo-admin' }))
    const session = await transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'admin', password: 'demo-admin' },
    })
    if (!session.ok) throw new Error('admin login')
    const ops = new AdminOps({ session: session.value, login: { transport, endpoint } })
    // Publish the sample design outside the UI, with its own vault, then lock it again, so the
    // audit has to ask for it.
    const created = await ObserverVault.create(session.value.admin, PASSPHRASE, {
      iterations: VAULT_KDF.minIterations,
    })
    if (!created.ok) throw new Error('vault')
    ops.useVault(created.value)
    const book = new CredentialsBook('demo')
    const prepared = await preparePublish(ops, sampleDesign(), { vault: created.value })
    if (!prepared.ok) throw new Error('plan')
    const published = await executePlan(ops, prepared.value.plan, {
      passwordFor: (id) => book.passwordFor(id),
      confirmed: planConfirmations(prepared.value.plan),
    })
    expect(published.ok).toBe(true)
    created.value.lock()
    ops.useVault(undefined)
    // Drift: Red HQ unmoderated, an ordinary admin operation.
    const configured = await session.value.muc.configureRoom(ops.roomJid('red-hq'), {
      ...gameRoomConfig('Red HQ'),
      moderated: false,
    })
    expect(configured.ok).toBe(true)

    const store = createDraftStore({
      persistence: memoryDraftPersistence(),
      initial: () => draftFromDesign(sampleDesign()),
    })
    render(
      createElement(AdminApp, {
        store,
        registry: withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {}),
        initialSection: 'audit',
        publish: { ops, kind: 'mock', vaultIterations: VAULT_KDF.minIterations },
      }),
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Run the audit' }))
    await waitFor(() => {
      expect(screen.getByText('Unlock the vault to check observer voice.')).toBeTruthy()
    })
    await user.click(screen.getByRole('button', { name: 'Unlock the vault' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Unlock the vault' })
    await user.type(within(dialog).getByLabelText('Passphrase'), PASSPHRASE)
    await user.click(within(dialog).getByRole('button', { name: 'Unlock' }))
    await waitFor(
      () => {
        expect(screen.getByText(/Voice checked through 4 role logins/)).toBeTruthy()
      },
      { timeout: 20_000 },
    )
    const report = screen.getByRole('region', { name: 'Audit report' })
    // Unmoderated, Red HQ also gives the White observer (every room, read only) voice.
    expect(within(report).getByText('2 differences: 2 critical.')).toBeTruthy()
    await user.click(within(report).getByRole('button', { name: 'Repair all (2)…' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Repair these differences?' })
    await user.click(within(confirm).getByRole('button', { name: 'Repair' }))
    await waitFor(
      () => {
        expect(
          screen.getByText(
            /Repaired 2 differences\. Audited again: the server matches the design\./,
          ),
        ).toBeTruthy()
      },
      { timeout: 20_000 },
    )
    const config = await session.value.muc.getRoomConfig(ops.roomJid('red-hq'))
    expect(config.ok && config.value.moderated).toBe(true)
  })
})
