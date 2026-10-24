import { LIMITS } from './common.ts'

export interface SizeCheck {
  readonly ok: boolean
  readonly bytes: number
  readonly limitBytes: number
}

/** UTF-8 size of a payload once serialised as JSON. */
export function jsonByteLength(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length
}

/**
 * Whether a payload fits in one PubSub item, leaving room for the XML around it (PLY-53, R15).
 * `itemLimitBytes` is the server's limit; ejabberd's default is used when it isn't known.
 */
export function checkItemSize(
  payload: unknown,
  itemLimitBytes: number = LIMITS.pubsubItemBytes,
): SizeCheck {
  const bytes = jsonByteLength(payload)
  const limitBytes = itemLimitBytes - LIMITS.pubsubItemOverheadBytes
  return { ok: bytes <= limitBytes, bytes, limitBytes }
}
