// Where a path lies in JSON text (WP 4.3): the raw editor marks each profile issue in place, so
// it needs the text range of `schema.properties.speed.maxLength`. A small scanner over text that
// `JSON.parse` has accepted; it records the range of every value and member name.

export interface JsonSpan {
  /** The value's first and one-past-last character. */
  readonly from: number
  readonly to: number
  /** For an object member: its name's range, quotes included. */
  readonly keyFrom?: number
  readonly keyTo?: number
}

export type JsonPath = readonly (string | number)[]

/** Every value's span in `text`, by its path joined with NUL. Undefined if the text is not JSON. */
export function jsonSpans(text: string): Map<string, JsonSpan> | undefined {
  const spans = new Map<string, JsonSpan>()
  let i = 0
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text.charAt(i))) i++
  }
  const fail = (): never => {
    throw new SyntaxError(`unexpected character at ${i}`)
  }
  const string = (): string => {
    const start = i
    i++
    while (i < text.length && text.charAt(i) !== '"') i += text.charAt(i) === '\\' ? 2 : 1
    if (i >= text.length) fail()
    i++
    return JSON.parse(text.slice(start, i)) as string
  }
  const value = (path: (string | number)[], key?: { from: number; to: number }) => {
    ws()
    const from = i
    const c = text.charAt(i)
    if (c === '{') {
      i++
      ws()
      if (text.charAt(i) === '}') i++
      else {
        for (;;) {
          ws()
          if (text.charAt(i) !== '"') fail()
          const keyFrom = i
          const name = string()
          const keyTo = i
          ws()
          if (text.charAt(i) !== ':') fail()
          i++
          value([...path, name], { from: keyFrom, to: keyTo })
          ws()
          if (text.charAt(i) === ',') {
            i++
            continue
          }
          if (text.charAt(i) === '}') {
            i++
            break
          }
          fail()
        }
      }
    } else if (c === '[') {
      i++
      ws()
      if (text.charAt(i) === ']') i++
      else {
        for (let n = 0; ; n++) {
          value([...path, n])
          ws()
          if (text.charAt(i) === ',') {
            i++
            continue
          }
          if (text.charAt(i) === ']') {
            i++
            break
          }
          fail()
        }
      }
    } else if (c === '"') {
      string()
    } else {
      const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i))
      if (match === null) fail()
      i += match?.[0].length ?? 0
    }
    spans.set(
      path.map(String).join('\u0000'),
      key === undefined ? { from, to: i } : { from, to: i, keyFrom: key.from, keyTo: key.to },
    )
  }
  try {
    value([])
    ws()
    if (i !== text.length) fail()
  } catch {
    return undefined
  }
  return spans
}

/**
 * The range to mark for an issue at `path`: the member's name if the path is in the text, else
 * the name of the nearest enclosing member that is (a missing keyword is marked on its field),
 * else the whole value.
 */
export function rangeOf(
  spans: ReadonlyMap<string, JsonSpan>,
  path: JsonPath,
): { from: number; to: number } {
  for (let n = path.length; n >= 0; n--) {
    const span = spans.get(path.slice(0, n).map(String).join('\u0000'))
    if (span === undefined) continue
    if (span.keyFrom !== undefined && span.keyTo !== undefined) {
      return { from: span.keyFrom, to: span.keyTo }
    }
    // An array entry or the root: the value itself, or its first character if it spans lines.
    return { from: span.from, to: n === 0 ? span.from + 1 : span.to }
  }
  return { from: 0, to: 0 }
}
