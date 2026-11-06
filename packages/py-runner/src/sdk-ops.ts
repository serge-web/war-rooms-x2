// THE PROTOCOL SEAM (WP 6.2). The SDK's operations as the bridge offers them: their names, the
// shape of each request, and which role may call which (PD4, PY-4). This is S17's operation
// shape (spike/s17-pyodide/src/protocol.ts), kept in this one module so that WP 6.1's shared
// protocol can replace it: when that lands, this file becomes a re-export of it, and nothing
// else in the runner names an operation or a request shape.
//
// The wire form is S17's: an operation name and a JSON string in, `{ok, value}` or
// `{ok: false, error}` out (`CallResult`), so Python never holds a proxy of a page object.
import { z } from 'zod'

/** The roles that may run scripts in the browser (PD4): the admin and the White Force. */
export const SCRIPT_ROLES = Object.freeze(['admin', 'white-force'] as const)
export type ScriptRole = (typeof SCRIPT_ROLES)[number]

/**
 * The operations offered (Annex C PY-2, the slice S17 proved). White Force proposals
 * (`postProposal`) wait for the umpire room and its message type (PD8, PY-8: WP 6.4).
 */
export const SDK_OPERATIONS = Object.freeze([
  'readWorldState',
  'readRoomMessages',
  'writeDraft',
] as const)
export type SdkOperation = (typeof SDK_OPERATIONS)[number]

/** Which role may call which operation (PD4, PD7): only the admin fills the draft. */
export const OPERATION_ROLES: Readonly<Record<SdkOperation, readonly ScriptRole[]>> = Object.freeze(
  {
    readWorldState: ['admin', 'white-force'],
    readRoomMessages: ['admin', 'white-force'],
    writeDraft: ['admin'],
  },
)

/** Each operation's request, parsed from the JSON the script sent. */
export const REQUESTS = Object.freeze({
  readWorldState: z.null(),
  readRoomMessages: z.object({ roomId: z.string().min(1).max(100) }).strict(),
  // The world state is checked by the bridge against the world-state schema and the 500 KB
  // cap (PLY-53), as a publish would be.
  writeDraft: z.unknown(),
} satisfies Record<SdkOperation, z.ZodType>)

export function isSdkOperation(op: string): op is SdkOperation {
  return (SDK_OPERATIONS as readonly string[]).includes(op)
}

/** What a call returns to the script, as JSON. */
export type CallResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }
