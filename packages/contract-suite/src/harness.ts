// Helpers shared by the checks. Nothing here knows which backend is under test.
import type { Result } from '@wrx/schemas'
import type { TransportError, Unsubscribe } from '@wrx/transport'
import { beforeAll, beforeEach } from 'vitest'

/** The value of an ok result; a failed setup step throws, so the test fails with the reason. */
export function must<T>(result: Result<T, TransportError>, what: string): T {
  if (result.ok) return result.value
  const { condition, text } = result.error
  throw new Error(`${what}: ${condition}${text === undefined ? '' : ` (${text})`}`)
}

/** The error of a failed result, or undefined when it succeeded. */
export function errorOf<T>(result: Result<T, TransportError>): TransportError | undefined {
  return result.ok ? undefined : result.error
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls until `condition` holds, or rejects after `ms`. */
export async function until(condition: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await sleep(20)
  }
}

/** Records every event a subscription delivers, until stopped. */
export interface Recorder<E> {
  readonly events: readonly E[]
  /** Resolves with the first recorded event (past or future) that matches, or rejects after `ms`. */
  next(match: (event: E) => boolean, ms?: number): Promise<E>
  stop(): void
}

export function record<E>(subscribe: (listener: (event: E) => void) => Unsubscribe): Recorder<E> {
  const events: E[] = []
  const unsubscribe = subscribe((event) => events.push(event))
  return {
    events,
    async next(match, ms = 8_000) {
      let found: E | undefined
      await until(
        () => {
          found = events.find(match)
          return found !== undefined
        },
        ms,
        'an event',
      )
      if (found === undefined) throw new Error('unreachable')
      return found
    },
    stop: unsubscribe,
  }
}

/**
 * A beforeAll whose failure fails every test of the block instead of skipping them (NFR-16):
 * the error is kept and rethrown from beforeEach.
 */
export function setupOrFail(setup: () => Promise<void>, timeoutMs: number): void {
  let failure: Error | undefined
  beforeAll(async () => {
    try {
      await setup()
    } catch (error) {
      failure = error instanceof Error ? error : new Error(JSON.stringify(error))
    }
  }, timeoutMs)
  beforeEach(() => {
    if (failure !== undefined) throw failure
  })
}

/** A unique lower-case token, safe in a JID localpart, room or node name. */
export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** JSON text for an item or message body. */
export function json(value: unknown): string {
  return JSON.stringify(value)
}
