// Narrowing helpers for JSON from the GitHub API and from files (NFR-19: no unchecked casts).

export type Json = Readonly<Record<string, unknown>>

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined
}

export function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`Expected a string for ${what}`)
  return value
}

export function optStr(value: unknown, what: string): string | null {
  return value === null || value === undefined ? null : str(value, what)
}

export function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected a number for ${what}`)
  }
  return value
}

export function arr(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected an array for ${what}`)
  return value as readonly unknown[]
}
