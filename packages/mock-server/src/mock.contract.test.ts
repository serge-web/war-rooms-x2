// The contract suite against the mock (NFR-16, §11 step 4): the same checks that run against
// ejabberd, unchanged, in the root test run. The mock has no raw stanza channel, so the probes
// tagged `raw` are not declared. A divergence from ejabberd fails the build.
import { CONTRACT_TAGS, defineContractSuite } from '@wrx/contract-suite'
import type { ContractBackend, Login } from '@wrx/contract-suite'
import type { Session } from '@wrx/transport'
import { describe, expect, it, vi } from 'vitest'
import rootConfig from '../../../vitest.config.ts'
import { MockServer } from './server.ts'
import { MockSession } from './session.ts'
import { MockTransport } from './transport.ts'

// The suite watches for silence (1.5 s at a time) and paces itself on real time.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const domain = 'localhost'
const adminPassword = 'mock-admin-password'
const server = new MockServer({ domain, adminPassword })
const transport = new MockTransport(server)
const endpoint = { websocketUrl: 'mock://contract', domain }

function mock(session: Session): MockSession {
  if (!(session instanceof MockSession)) throw new Error('not a MockTransport session')
  return session
}

const backend: ContractBackend = {
  name: 'mock',
  domain,
  connect: (login: Login) =>
    transport.connect({
      endpoint,
      credentials:
        login.kind === 'anonymous'
          ? { kind: 'anonymous' }
          : { kind: 'password', username: login.username, password: login.password },
      ...(login.resource === undefined ? {} : { resource: login.resource }),
    }),
  admin: () =>
    transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'admin', password: adminPassword },
      resource: `contract-${Math.random().toString(36).slice(2, 8)}`,
    }),
  interrupt: (session, how) => {
    mock(session).interrupt(how)
    return Promise.resolve()
  },
}

defineContractSuite(backend)

// The root config cannot import the suite (the root tsconfig does not allow .ts imports), so it
// repeats the tag names; this keeps them in step.
describe('root vitest config', () => {
  it('declares every contract tag', () => {
    expect(rootConfig.test?.tags?.map((t) => t.name)).toEqual(CONTRACT_TAGS.map((t) => t.name))
  })
})
