// S15-6: the fetched order after a server restart. The items live in SQLite (default_db: sql), so
// whatever the order is based on must survive a restart for readers to rely on it.
import { describe, expect, it } from 'vitest'
import { Transcript } from '../../../s14/src/pubsub.ts'
import type { ConfigName } from '../config.ts'
import { saveStanzas, type Ctx } from '../context.ts'
import { restart } from '../docker.ts'
import { classify, itemViews, reads, sequence, SEQUENCE_B } from './s15-timestamps.ts'

export function s15Restart(ctx: Ctx, cfg: ConfigName): void {
  describe('S15-6 order after a restart', () => {
    it('S15-6 the same reads before and after a server restart', async () => {
      const t = new Transcript()
      const seq = await sequence(ctx, t, ctx.name('restart'), 1_100)
      await seq.stepFive()
      const before = await reads(ctx.ps(await ctx.login('reader')), seq.node)
      const ms = await restart(cfg)
      t.note(`server restarted (${Math.round(ms)} ms)`)
      // Fresh sessions: the earlier ones were cut by the restart.
      const reader = ctx.ps(await ctx.login('reader'), t, 'reader after restart')
      const after = await reads(reader, seq.node)
      saveStanzas('s15-6-restart', t)
      const ids = (r: typeof before) => r.full.map((v) => v.id)
      ctx.observe('S15-6', 'order before and after a restart', {
        restartMs: Math.round(ms),
        before: { full: ids(before), max1: before.max1, max2: before.max2 },
        after: { full: ids(after), max1: after.max1, max2: after.max2 },
        afterMatches: classify(ids(after), SEQUENCE_B),
        timeLikeAfter: after.envelope.timeLike,
      })
      const admin = ctx.ps(await ctx.adminLogin())
      await admin.deleteNode(seq.node)
      expect(ids(after)).toEqual(ids(before))
      expect(after.max1).toEqual(before.max1)
      expect(itemViews(after.replies.full.xml).every((v) => v.delay === undefined)).toBe(true)
    })
  })
}
