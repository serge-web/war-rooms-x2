// S16-0: the spike's configs are the reference config with only the stated change, and the
// compose file pins the same image digest as the contract-suite stack.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCKER_DIR, IMAGE, REPO_ROOT } from '../../src/config.ts'

const reference = readFileSync(join(REPO_ROOT, 'deploy/ejabberd/ejabberd.yml'), 'utf8')
const read = (name: string) => readFileSync(join(DOCKER_DIR, name), 'utf8')
/** The config without its spike header (the leading comment lines up to the first `#` alone). */
const body = (text: string) => text.slice(text.indexOf('#\n') + 2)

describe('S16-0 configs', () => {
  it('ref is the reference config, unchanged', () => {
    expect(body(read('ejabberd-ref.yml'))).toBe(reference)
  })

  it('tight changes only the player shaper', () => {
    const expected = reference
      .replace(/^ {4}rate: 50000$/m, '    rate: 20000 # S16 tight (reference: 50000)')
      .replace(/^ {4}burst_size: 300000$/m, '    burst_size: 20000 # S16 tight (reference: 300000)')
    expect(expected).not.toBe(reference)
    expect(body(read('ejabberd-tight.yml'))).toBe(expected)
  })

  it('http adds only a shaper to the ejabberd_http listener', () => {
    const expected = reference.replace(
      /^ {4}module: ejabberd_http$/m,
      '    module: ejabberd_http\n    shaper: c2s_shaper # S16 http probe (reference: no shaper on this listener)',
    )
    expect(expected).not.toBe(reference)
    expect(body(read('ejabberd-http.yml'))).toBe(expected)
  })

  it('the compose file pins the contract-suite image digest', () => {
    expect(read('compose.yaml')).toContain(`image: ${IMAGE}`)
    expect(readFileSync(join(REPO_ROOT, 'deploy/ejabberd/compose.yaml'), 'utf8')).toContain(`image: ${IMAGE}`)
  })
})
