// Reconnect back-off (PLY-2): exponential with full jitter, capped, so many panes reconnecting
// after a server restart spread out instead of arriving together.

export interface BackoffOptions {
  /** First delay, in ms. */
  readonly initialMs: number
  /** Largest delay, in ms. */
  readonly maxMs: number
  /** Attempts before the transport gives up and ends the session as `unreachable`. */
  readonly maxAttempts: number
}

export const DEFAULT_BACKOFF: BackoffOptions = Object.freeze({
  initialMs: 500,
  maxMs: 30_000,
  maxAttempts: 12,
})

/**
 * Delay before reconnect attempt `attempt` (1-based): a random point in
 * [base/2, base], where base = initialMs × 2^(attempt−1), capped at maxMs.
 * `random` is injectable for tests and returns a number in [0, 1).
 */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: () => number = Math.random,
): number {
  const base = Math.min(options.maxMs, options.initialMs * 2 ** Math.max(0, attempt - 1))
  return Math.round(base / 2 + (base / 2) * random())
}
