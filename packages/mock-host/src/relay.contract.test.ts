// The contract suite (NFR-16) through the leader-tab relay: every session lives in a follower
// "tab", so every frame crosses a BroadcastChannel, structured-cloned and validated both ways.
// A frame the wire schemas reject, or a behaviour the relay changes, fails here.
import { CONTRACT_TAGS, defineContractSuite } from '@wrx/contract-suite'
import type { ContractBackend, Login } from '@wrx/contract-suite'
import { MockSession, emptyState } from '@wrx/mock-server'
import type { Session } from '@wrx/transport'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connectMockTransport } from './connect.ts'
import type { MockHost } from './connect.ts'
import { FakeBrowser } from './fixtures.ts'
import type { LogEntry } from './wire.ts'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const domain = 'localhost'
const adminPassword = 'relay-admin-password'
const endpoint = { websocketUrl: 'mock://relay', domain }
const browser = new FakeBrowser()
const logs: LogEntry[] = []
const hosts: MockHost[] = []

function follower(): MockHost {
  const host = hosts[1]
  if (host === undefined) throw new Error('the tabs are not open yet')
  return host
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    hosts.push(
      await connectMockTransport({
        environment: browser.tab().environment,
        seed: emptyState(domain, adminPassword),
        log: (entry) => logs.push(entry),
      }),
    )
  }
})

afterAll(async () => {
  for (const host of hosts) await host.close()
})

function mock(session: Session): MockSession {
  if (!(session instanceof MockSession)) throw new Error('not a MockTransport session')
  return session
}

const backend: ContractBackend = {
  name: 'mock (leader-tab relay)',
  domain,
  connect: (login: Login) =>
    follower().connect({
      endpoint,
      credentials:
        login.kind === 'anonymous'
          ? { kind: 'anonymous' }
          : { kind: 'password', username: login.username, password: login.password },
      ...(login.resource === undefined ? {} : { resource: login.resource }),
    }),
  admin: () =>
    follower().connect({
      endpoint,
      credentials: { kind: 'password', username: 'admin', password: adminPassword },
      resource: `contract-${Math.random().toString(36).slice(2, 8)}`,
    }),
  interrupt: (session, how) => {
    mock(session).interrupt(how)
    return Promise.resolve()
  },
}

describe('relay set-up', () => {
  it('runs the sessions in a follower tab', () => {
    expect(hosts[0]?.isHosting()).toBe(true)
    expect(follower().isHosting()).toBe(false)
    expect(CONTRACT_TAGS.length).toBeGreaterThan(0)
  })
})

defineContractSuite(backend)

describe('relay after the suite', () => {
  it('dropped no frame as invalid', () => {
    expect(logs.filter((l) => l.message.includes('invalid'))).toEqual([])
  })
})
