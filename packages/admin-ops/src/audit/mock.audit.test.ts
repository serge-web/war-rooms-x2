// The audit scenario (integration/audit-scenario.ts) end to end against a fresh mock server, in
// the root test run. The same scenario runs against ejabberd with `pnpm test:audit:ejabberd`.
import { MockServer, MockTransport } from '@wrx/mock-server'
import { vi } from 'vitest'
import { defineAuditIntegration } from '../../integration/audit-scenario.ts'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 })

const domain = 'localhost'
const adminPassword = 'mock-admin-password'
const server = new MockServer({ domain, adminPassword })

defineAuditIntegration({
  name: 'mock',
  transport: new MockTransport(server),
  endpoint: { websocketUrl: 'mock://audit', domain },
  adminPassword,
})
