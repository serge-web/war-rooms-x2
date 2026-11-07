// THE PROTOCOL SEAM (WP 6.2, 6.4). The runner answers the bridge protocol (`@wrx/schemas/bridge`,
// version 2: the read operations of version 1, and act and adjudicate): its operation names,
// request and result schemas, events and reply envelope come from there, and nothing else in the
// runner defines them. This module adds only what the protocol leaves to the runner: which role
// may call which operation (PD2, PD4, PD6, PD7).
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
export type {
  BridgeErrorCode,
  BridgeEvent,
  BridgeOp,
  BridgeRequest,
  BridgeResult,
} from '@wrx/schemas/bridge'

/** The roles that may run scripts in the browser (PD4): the admin and the White Force. */
export const SCRIPT_ROLES = Object.freeze(['admin', 'white-force'] as const)
export type ScriptRole = (typeof SCRIPT_ROLES)[number]

export type SdkOperation = BridgeOp

/** Every operation the bridge answers: the protocol's. */
export const SDK_OPERATIONS: readonly SdkOperation[] = BRIDGE_OPS

/**
 * Which role may call which operation (PD2, PD4, PD6, PD7). Both roles read, send messages and
 * subscribe, each as itself (the bridge scopes every call to the session's own access); only the
 * admin reads and fills the draft; only the White Force posts proposals.
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
    sendMessage: SCRIPT_ROLES,
    sendTemplate: SCRIPT_ROLES,
    readDraft: ['admin'],
    writeDraft: ['admin'],
    postProposal: ['white-force'],
    subscribeMessages: SCRIPT_ROLES,
    subscribePhase: SCRIPT_ROLES,
  },
)

export function isBridgeOp(op: string): op is BridgeOp {
  return (BRIDGE_OPS as readonly string[]).includes(op)
}
