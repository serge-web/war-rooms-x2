// THE PROTOCOL SEAM (WP 6.2). The runner answers WP 6.1's bridge protocol
// (`@wrx/schemas/bridge`, version 1: the read operations): its operation names, request and
// result schemas and reply envelope come from there, and nothing else in the runner defines
// them. This module adds only what the protocol leaves to the runner:
//
// - which role may call which operation (PD4: the admin and the White Force run scripts);
// - `writeDraft`, S17's draft write, kept here until WP 6.4 puts it in the protocol (a later
//   version); its reply uses the protocol's envelope and error codes.
//
// The wire form is the protocol's: an operation name and a JSON string in, `{ok: true, value}`
// or `{ok: false, code, error}` out, so Python never holds a proxy of a page object.
import { BRIDGE_OPS } from '@wrx/schemas/bridge'
import type { BridgeOp } from '@wrx/schemas/bridge'

export {
  BRIDGE_OPS,
  BRIDGE_PROTOCOL_VERSION,
  bridgeError,
  bridgeOk,
  parseBridgeCall,
} from '@wrx/schemas/bridge'
export type { BridgeErrorCode, BridgeOp, BridgeRequest, BridgeResult } from '@wrx/schemas/bridge'

/** The roles that may run scripts in the browser (PD4): the admin and the White Force. */
export const SCRIPT_ROLES = Object.freeze(['admin', 'white-force'] as const)
export type ScriptRole = (typeof SCRIPT_ROLES)[number]

/** The runner's own operations, until WP 6.4 adds them to the protocol. */
export const RUNNER_OPS = Object.freeze(['writeDraft'] as const)
export type RunnerOp = (typeof RUNNER_OPS)[number]

export type SdkOperation = BridgeOp | RunnerOp

/** Every operation the bridge answers. */
export const SDK_OPERATIONS: readonly SdkOperation[] = Object.freeze([...BRIDGE_OPS, ...RUNNER_OPS])

/**
 * Which role may call which operation (PD2, PD4, PD7). Both roles read, each as itself (the
 * bridge scopes every read to the session's own access); only the admin fills the draft.
 */
export const OPERATION_ROLES: Readonly<Record<SdkOperation, readonly ScriptRole[]>> = Object.freeze(
  {
    readContext: SCRIPT_ROLES,
    readGameSetup: SCRIPT_ROLES,
    readTurn: SCRIPT_ROLES,
    readForces: SCRIPT_ROLES,
    readRoles: SCRIPT_ROLES,
    readRooms: SCRIPT_ROLES,
    readRoomMessages: SCRIPT_ROLES,
    readWorldState: SCRIPT_ROLES,
    readObjectives: SCRIPT_ROLES,
    writeDraft: ['admin'],
  },
)

export function isBridgeOp(op: string): op is BridgeOp {
  return (BRIDGE_OPS as readonly string[]).includes(op)
}

export function isRunnerOp(op: string): op is RunnerOp {
  return (RUNNER_OPS as readonly string[]).includes(op)
}

/** A `writeDraft` payload's most characters: a 500 KB world state with room for JSON. */
export const DRAFT_PAYLOAD_CHARS = 1_000_000

/** The reply to `writeDraft`, in the protocol's envelope. */
export function draftOk(assets: number): string {
  return JSON.stringify({ ok: true, value: { assets } })
}
