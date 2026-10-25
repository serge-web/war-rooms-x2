// Results and progress for admin operations (ARC-14). Every operation resolves to a Result with a
// typed error and never rejects for a server refusal; a rejected promise is a bug.
import type { Result } from '@wrx/schemas'
import type { TransportError } from '@wrx/transport'

export type AdminOpsErrorCode =
  /** The server refused a request; `cause` holds its error. */
  | 'refused'
  /** An argument is not a valid id, or names something the tooling must never touch (`admin`). */
  | 'invalid'
  /** The account already exists (XEP-0133 add-user `conflict`). */
  | 'exists'
  /** A vault exists but is not unlocked in this AdminOps, so it cannot be kept in step (ADM-37). */
  | 'vault-locked'
  /** The vault holds no password for the role, so its voice cannot be revoked (ADM-37). */
  | 'no-password'
  /** No vault is stored yet. */
  | 'vault-not-found'
  /** A vault is already stored; unlock it instead of creating one. */
  | 'vault-exists'
  /** The passphrase did not decrypt the vault (or the ciphertext was altered). */
  | 'wrong-passphrase'
  /** The passphrase is too short to protect the vault. */
  | 'weak-passphrase'
  /** The stored vault is not a vault this version can read. */
  | 'vault-corrupt'
  /** Someone else changed the stored vault since it was unlocked here; unlock it again. */
  | 'vault-conflict'
  /** Logging in as the role with its vault password failed. */
  | 'login-failed'
  /** The operation ran, but reading back shows the server is not in the intended state. */
  | 'verify-failed'
  /** A room's message count changed after it was confirmed, so the room was not destroyed. */
  | 'count-changed'

export interface AdminOpsError {
  readonly code: AdminOpsErrorCode
  /** Developer-facing explanation. Never parsed for meaning. */
  readonly message: string
  /** The operation and step that failed, e.g. `setNodeAccess` / `remove subscriptions`. */
  readonly op?: string
  readonly step?: string
  /** The room, node or role it was acting on. */
  readonly target?: string
  /** The transport error behind this one, when there is one. */
  readonly cause?: TransportError
  /**
   * Set when the tooling undid a partial change to fail closed, e.g. took a role's membership
   * away again because its voice could not be revoked.
   */
  readonly rolledBack?: boolean
  /** For `count-changed`: the room's message count now. */
  readonly messageCount?: number
}

export type OpsResult<T> = Result<T, AdminOpsError>
export type OpsOutcome<T> = Promise<OpsResult<T>>

export function opsOk<T>(value: T): OpsResult<T> {
  return { ok: true, value }
}

export function opsErr(
  code: AdminOpsErrorCode,
  message: string,
  extra: Omit<AdminOpsError, 'code' | 'message'> = {},
): { readonly ok: false; readonly error: AdminOpsError } {
  return { ok: false, error: { code, message, ...extra } }
}

/** One step of an operation, for 2.3's progress view (ADM-11). */
export interface ProgressEvent {
  /** The public operation, e.g. `moveRole`. */
  readonly op: string
  /** The step within it, e.g. `grant membership`. */
  readonly step: string
  /** Room id, node name or role id. */
  readonly target: string
  readonly state: 'started' | 'done' | 'failed'
  readonly error?: AdminOpsError
  /** For room destruction: the number of archived messages (R-F, ADM-40). */
  readonly messageCount?: number
}

export type ProgressListener = (event: ProgressEvent) => void
