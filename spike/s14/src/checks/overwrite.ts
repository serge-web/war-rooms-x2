// S14-8: who may overwrite an asset item. Two publishers on one leaf; the second overwrites the
// first's item. XEP-0060 §7.1 leaves this to the service. Run on a plain node (the layout every
// config can use) and, when the server has collections, on a leaf inside a collection.
import { describe, expect, it } from 'vitest'
import type { S14Ctx } from '../context.ts'
import { saveStanzas } from '../context.ts'
import { assetPayload, itemIds, Transcript, type IqReply } from '../pubsub.ts'

const brief = (r: IqReply) => (r.ok ? 'ok' : `${r.condition ?? '?'} (${r.errorType ?? '?'})${r.text === undefined ? '' : `: ${r.text}`}`)

export function overwrite(ctx: S14Ctx, opts: { readonly expectCollections: boolean }): void {
  describe('S14-8 overwrite by another publisher', () => {
    const shapes = opts.expectCollections ? (['plain', 'in-collection'] as const) : (['plain'] as const)
    for (const shape of shapes) {
      it(`S14-8 ${shape} leaf`, async () => {
        const t = new Transcript()
        const admin = ctx.ps(undefined, t, 'admin')
        const leaf = ctx.node(`ow-${shape}`)
        const c = ctx.node('ow-c')
        if (shape === 'in-collection') {
          await admin.create(c, { 'pubsub#node_type': 'collection', 'pubsub#access_model': 'whitelist' })
          await admin.create(leaf, { 'pubsub#collection': c, 'pubsub#access_model': 'whitelist', 'pubsub#publish_model': 'publishers' })
        } else {
          await admin.create(leaf, { 'pubsub#access_model': 'whitelist', 'pubsub#publish_model': 'publishers' })
        }
        await admin.setAffiliations(leaf, { [ctx.jid('blue')]: 'publisher', [ctx.jid('blue2')]: 'publisher' })
        const blue = ctx.ps(await ctx.login('blue'), t, 'blue')
        const blue2 = ctx.ps(await ctx.login('blue2'), t, 'blue2')
        t.note('blue publishes asset-1; blue2 then publishes the same item id')
        const first = await blue.publish(leaf, 'asset-1', assetPayload('asset-1', " by='blue'"))
        const second = await blue2.publish(leaf, 'asset-1', assetPayload('asset-1', " by='blue2'"))
        const retract = await blue2.iq('set', `<pubsub xmlns='http://jabber.org/protocol/pubsub'><retract node='${leaf}'><item id='asset-1'/></retract></pubsub>`)
        t.note('the owner (admin) overwrites blue’s item')
        const owner = await admin.publish(leaf, 'asset-1', assetPayload('asset-1', " by='admin'"))
        t.note('blue publishes again over the owner’s item')
        const back = await blue.publish(leaf, 'asset-1', assetPayload('asset-1', " by='blue-again'"))
        const items = await admin.items(leaf)
        const by = /by='([^']+)'/.exec(items.xml)?.[1] ?? /by="([^"]+)"/.exec(items.xml)?.[1]
        ctx.observe('S14-8', `overwrite, ${shape} leaf`, {
          firstPublishByBlue: brief(first),
          overwriteByBlue2: brief(second),
          retractByBlue2: brief(retract),
          overwriteByOwner: brief(owner),
          blueOverwritesOwnersItem: brief(back),
          finalItem: { ids: itemIds(items.xml), publishedBy: by },
        })
        saveStanzas(`s14-8-overwrite-${shape}`, t)
        await admin.deleteNode(leaf)
        if (shape === 'in-collection') await admin.deleteNode(c)
        expect(first.ok).toBe(true)
        // Recorded ejabberd 26.09 behaviour (as the contract suite's S02 records for flat nodes).
        expect(second).toMatchObject({ ok: false, condition: 'forbidden', errorType: 'auth' })
        expect(retract).toMatchObject({ ok: false, condition: 'forbidden' })
        expect(owner.ok).toBe(true)
      })
    }
  })
}
