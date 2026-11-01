// S14-9, last part: V0's database started under V1, then under V0 again. Needs the V0 stack up
// (scripts/up.sh v0). Leaves V0 running on its own config.
import { describe, expect, it } from 'vitest'
import { must, uniq } from '../../../../packages/contract-suite/src/harness.ts'
import { makeBackend, raw } from '../../src/backend.ts'
import { CONFIGS } from '../../src/config.ts'
import { observe } from '../../src/context.ts'
import { keyLines, startOn } from '../../src/docker.ts'
import { assetPayload, itemIds, Pubsub } from '../../src/pubsub.ts'

const v0 = makeBackend({ websocketUrl: `wss://localhost:${CONFIGS.v0.port}/ws`, domain: 'localhost' })

async function adminPs(): Promise<{ ps: Pubsub; close: () => Promise<void> }> {
  const s = must(await v0.admin(), 'admin login on the V0 database')
  return { ps: new Pubsub(raw, s, s.services.pubsub), close: () => s.disconnect() }
}

describe('S14-9 the V0 database under V1', () => {
  it('V1 on V0’s volume, then V0 again: does the server start, and do existing nodes survive?', async () => {
    const node = uniq('s14-migrate')
    const a = await adminPs()
    expect((await a.ps.create(node, { 'pubsub#access_model': 'whitelist' })).ok).toBe(true)
    expect((await a.ps.setAffiliations(node, { 'someone@localhost': 'member' })).ok).toBe(true)
    expect((await a.ps.publish(node, 'kept', assetPayload('kept'))).ok).toBe(true)
    await a.close()

    const underV1 = await startOn('v1', 'v0')
    const back = await startOn('v0', 'v0')
    const b = await adminPs()
    const items = await b.ps.items(node)
    const affs = await b.ps.iq('get', `<pubsub xmlns='http://jabber.org/protocol/pubsub#owner'><affiliations node='${node}'/></pubsub>`)
    await b.ps.deleteNode(node)
    await b.close()
    const result = {
      v1OnV0Database: { healthy: underV1.healthy, logLines: keyLines(underV1.log).slice(-6) },
      v0Again: { healthy: back.healthy },
      nodeSurvives: items.ok,
      itemSurvives: itemIds(items.xml).includes('kept'),
      affiliationSurvives: affs.xml.includes('someone@localhost'),
    }
    observe('S14-9', 'V0 database under V1, then V0 again', result)
    // Recorded: V1 does not start on V0's data either; V0 then starts with its data intact.
    expect(result).toMatchObject({
      v1OnV0Database: { healthy: false },
      v0Again: { healthy: true },
      nodeSurvives: true,
      itemSurvives: true,
      affiliationSurvives: true,
    })
  })
})
