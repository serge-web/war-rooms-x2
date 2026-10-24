/**
 * Where the store reports invalid network data and refused operations (NFR-5). Injected, so
 * each pane can label its own output and tests can assert on it.
 */
export interface Logger {
  debug(message: string, details?: Readonly<Record<string, unknown>>): void
  warn(message: string, details?: Readonly<Record<string, unknown>>): void
}

/** Logs to the console: warnings always, debug output never. */
export function consoleLogger(prefix = 'wrx'): Logger {
  return {
    debug: () => undefined,
    warn: (message, details) => {
      console.warn(`[${prefix}] ${message}`, details ?? {})
    },
  }
}
