// The admin-ops integration scenario against a fresh mock server (@wrx/mock-server), in the root
// test run. The same scenario runs against ejabberd with `pnpm test:admin-ops:ejabberd`.
import { MockServer, MockTransport } from '@wrx/mock-server'
import { vi } from 'vitest'
import { defineAdminOpsIntegration } from '../integration/scenario.ts'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 })

const domain = 'localhost'
const adminPassword = 'mock-admin-password'
const server = new MockServer({ domain, adminPassword })

defineAdminOpsIntegration({
  name: 'mock',
  transport: new MockTransport(server),
  endpoint: { websocketUrl: 'mock://admin-ops', domain },
  adminPassword,
})
