// NFR-22 guard for S13: no stack under test serves the REST API or the web admin, so nothing in
// these tests can have used them. (mod_adhoc_api on the option 3 variant is XMPP ad-hoc, not HTTP.)

import { describe, expect, it } from 'vitest'
import { servers, type Target } from '../src/config.js'

const httpBase = (t: Target) => servers[t].websocketUrl.replace(/^ws/, 'http').replace(/\/ws$/, '')

describe('NFR-22: no REST /api and no web admin on the S13 stacks', () => {
  for (const t of ['reference', 'wscap', 'adhocapi'] as const) {
    it(`${t}: /api and /admin are not served`, async () => {
      const api = await fetch(`${httpBase(t)}/api/status`, { method: 'POST', body: '{}' })
      const admin = await fetch(`${httpBase(t)}/admin/`)
      expect({ api: api.status, admin: admin.status }).toEqual({ api: 404, admin: 404 })
    })
  }
})
