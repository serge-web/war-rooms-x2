// S16-4: does ejabberd 26.09 accept a `shaper` option on the ejabberd_http listener, the one that
// carries the WebSocket? Starts the `http` config on a fresh volume, records the outcome and the
// log lines that matter, then stops it.
import { afterAll, describe, expect, it } from 'vitest'
import { observe } from '../../src/record.ts'
import { keyLines, start, stop } from '../../src/docker.ts'

describe('S16-4 shaper on the HTTP listener', () => {
  afterAll(async () => {
    await stop('http')
  }, 120_000)

  it('S16-4 start-up of the http config', async () => {
    const r = await start('http')
    const lines = keyLines(r.log)
    observe('S16-4', 'http config start-up', {
      starts: r.healthy,
      ...(r.exitCode === undefined ? {} : { exitCode: r.exitCode }),
      log: lines.slice(0, 12),
    })
    // Recorded ejabberd 26.09 behaviour: the option is refused and ejabberd does not start.
    expect(r.healthy).toBe(false)
    expect(lines.join('\n')).toMatch(/Unknown option: shaper/)
  }, 300_000)
})
