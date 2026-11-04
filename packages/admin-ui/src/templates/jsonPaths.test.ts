import { describe, expect, it } from 'vitest'
import { jsonSpans, rangeOf } from './jsonPaths.ts'

const TEXT = `{
  "schema": {
    "type": "object",
    "properties": { "speed": { "type": "string" }, "list": [1, {"a": "x\\"y"}] }
  }
}`

describe('JSON paths in text', () => {
  it('finds members, array entries and the root', () => {
    const spans = jsonSpans(TEXT)!
    const at = (path: (string | number)[]) => {
      const r = rangeOf(spans, path)
      return TEXT.slice(r.from, r.to)
    }
    expect(at(['schema', 'properties', 'speed'])).toBe('"speed"')
    expect(at(['schema', 'properties', 'speed', 'type'])).toBe('"type"')
    // A missing keyword is marked on the nearest member there is.
    expect(at(['schema', 'properties', 'speed', 'maxLength'])).toBe('"speed"')
    expect(at(['schema', 'properties', 'list', 1, 'a'])).toBe('"a"')
    expect(at(['schema', 'properties', 'list', 0])).toBe('1')
    expect(at([])).toBe('{')
    expect(at(['uiSchema', 'x'])).toBe('{')
  })

  it('refuses text that is not JSON', () => {
    expect(jsonSpans('{"a": }')).toBeUndefined()
    expect(jsonSpans('{"a": 1} x')).toBeUndefined()
    expect(jsonSpans('[1, 2,]')).toBeUndefined()
    expect(jsonSpans('"open')).toBeUndefined()
    expect(jsonSpans('-1.5e3')?.size).toBe(1)
  })
})
