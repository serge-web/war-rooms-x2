// The publish scenario (integration/publish-scenario.ts) end to end against a fresh mock server,
// in the root test run. The same scenario runs against ejabberd with
// `pnpm test:publish:ejabberd`.
import { MockServer, MockTransport } from '@wrx/mock-server'
import { vi } from 'vitest'
import { definePublishIntegration } from '../../integration/publish-scenario.ts'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 })

const domain = 'localhost'
const adminPassword = 'mock-admin-password'
const server = new MockServer({ domain, adminPassword })

definePublishIntegration({
  name: 'mock',
  transport: new MockTransport(server),
  endpoint: { websocketUrl: 'mock://publish', domain },
  adminPassword,
})
