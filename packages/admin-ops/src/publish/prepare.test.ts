// The publish-time server checks (NFR-4): what `checkServer` reports for a server view.
import { sampleDesignWithWhiteCell } from '@wrx/schemas/fixtures'
import { describe, expect, it } from 'vitest'
import { rig } from '../fixtures.ts'
import { emptyView, publishedView } from './fixtures.ts'
import { checkServer } from './prepare.ts'

const published = publishedView(sampleDesignWithWhiteCell())

describe('checkServer (NFR-4)', () => {
  it('skips the room checks on a server with no rooms', async () => {
    const { ops } = await rig()
    const checks = await checkServer(ops, emptyView())
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['admin', 'pass'],
      ['room-defaults', 'skipped'],
      ['mam', 'skipped'],
    ])
  })

  it('passes a published server, side channels included', async () => {
    const { ops } = await rig()
    const checks = await checkServer(ops, published)
    expect(checks.find((c) => c.id === 'room-defaults')).toMatchObject({ status: 'pass' })
    expect(checks.find((c) => c.id === 'room-defaults')?.detail).toMatch(/no private messages/)
    expect(checks.find((c) => c.id === 'mam')).toMatchObject({ status: 'pass' })
  })

  it('names a room whose side channels are open, and which ones (review F6)', async () => {
    const { ops } = await rig()
    const view = {
      ...published,
      rooms: published.rooms.map((r) =>
        r.roomId === 'negotiation'
          ? { ...r, config: { ...r.config, subscriptions: true, visitorNickChange: true } }
          : r,
      ),
    }
    const check = (await checkServer(ops, view)).find((c) => c.id === 'room-defaults')
    expect(check?.status).toBe('warn')
    expect(check?.detail).toContain('negotiation (visitorNickChange, subscriptions)')
  })
})
