import type { TransportError } from '@wrx/transport'

/**
 * Thrown inside an operation to resolve it with this error: a reply of the wrong shape
 * (`invalid-response`), or a refusal the transport itself decides. `Core.run` turns it into the
 * operation's result, so it never escapes as a rejection.
 */
export class Refusal extends Error {
  constructor(readonly error: TransportError) {
    super(`${error.condition}${error.text === undefined ? '' : `: ${error.text}`}`)
    this.name = 'Refusal'
  }
}

export function invalidResponse(text: string): Refusal {
  return new Refusal({ condition: 'invalid-response', text })
}

/** Rejects with a Refusal (`timeout`) after `ms`, unless `promise` settles first. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Refusal({ condition: 'timeout', text: `no reply to ${what} after ${ms} ms` }))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (reason: unknown) => {
        clearTimeout(timer)
        // A StanzaJS rejection is the error stanza, not an Error; pass it on as it is.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(reason)
      },
    )
  })
}
