import { describe, expect, it } from 'vitest'
import { LIMITS } from './common.ts'
import { checkItemSize, jsonByteLength } from './size.ts'

describe('item size (PLY-53, R15)', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(jsonByteLength('é')).toBe(4) // quotes plus two bytes
  })

  it('leaves room for the XML wrapper', () => {
    const limit = LIMITS.pubsubItemBytes - LIMITS.pubsubItemOverheadBytes
    expect(checkItemSize('x'.repeat(limit - 2))).toEqual({
      ok: true,
      bytes: limit,
      limitBytes: limit,
    })
    expect(checkItemSize('x'.repeat(limit - 1)).ok).toBe(false)
  })

  it('uses the server limit when given', () => {
    expect(checkItemSize('x'.repeat(10), 2_011).ok).toBe(false)
    expect(checkItemSize('x'.repeat(10), 2_012).ok).toBe(true)
  })
})
