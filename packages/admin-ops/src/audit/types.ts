// The audit's report (WP 2.10, ADM-41, R14): one item per difference between the live server and
// the design, with what was expected, what was found, how much it matters, and the AdminOps
// actions that repair it. Internal: the report describes access-control weaknesses (DOC-2).
import type { StepAction } from '../publish/plan.ts'

/**
 * - `critical`: access or voice leaks now (a revoked reader still subscribed, an observer with
 *   voice, an unmoderated room, an open node that should be whitelisted);
 * - `high`: a hole that is not yet a leak, or a check that could not be made;
 * - `medium`: someone lacks access the design gives, or a document is out of date;
 * - `low`: cosmetic, or harmless leftovers;
 * - `info`: nothing to repair (ADM-42's listable node names, unchecked writers).
 */
export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export const AUDIT_SEVERITIES: readonly AuditSeverity[] = Object.freeze([
  'critical',
  'high',
  'medium',
  'low',
  'info',
])

export type AuditKind =
  /** A design room is not on the server. */
  | 'room-missing'
  /** A room's configuration differs from NFR-3 or the design's name. */
  | 'room-config'
  /** A room on the server is not in the design (D11: every room on the service is the game's). */
  | 'room-extra'
  /** A role's room affiliation differs from its effective access (§3 rule 4). */
  | 'room-access'
  /** A role's stored MUC role differs: a read-only role with voice, or a writer left a visitor. */
  | 'voice'
  /** A read-only role's voice could not be checked (vault locked or missing, no password, login refused). */
  | 'voice-unchecked'
  /** Writers whose voice was not checked, because the vault has no password for them. */
  | 'writers-unchecked'
  | 'node-missing'
  /** Access model, publish model or item limit differ (NFR-3, §3 rule 15). */
  | 'node-config'
  /** A WRX1 node on the service that the design does not have. */
  | 'node-extra'
  /** A role's node affiliation differs from its access. */
  | 'node-access'
  /** A subscription of a role with no read access, per full JID (R-A, ADM-36). */
  | 'subscription'
  /** An affiliation or subscription of a JID that is no role account; nothing here can remove it. */
  | 'foreign-access'
  /** A design role with no account. */
  | 'account-missing'
  /** A registered account that is no role of the design. */
  | 'account-unknown'
  /** Leftover access or a vault entry of a role that is neither in the design nor registered. */
  | 'stray-access'
  /** A published document differs from the design, or is missing. */
  | 'document'
  /** The server's design version is not this design's. */
  | 'design-version'
  /** ADM-42, R17: anyone, even anonymous, can list node names. */
  | 'node-names-public'

export interface AuditItem {
  /** Stable across audits of the same drift, e.g. `voice:blue-observer:blue-hq`. */
  readonly id: string
  readonly kind: AuditKind
  /** The room id, node name, role id or full JID the difference is about. */
  readonly target: string
  /** The role it concerns, when it concerns one. */
  readonly roleId?: string
  /** One line each, for the report. */
  readonly expected: string
  readonly found: string
  readonly severity: AuditSeverity
  /** Whether `repair` fixes it; when false, `note` says what to do instead. */
  readonly repairable: boolean
  /**
   * The repair deletes an account, a room and its history, a node, or resets a password: the
   * admin confirms each such item before it runs (ADM-14, ADM-40, ADM-26).
   */
  readonly destructive: boolean
  /** The AdminOps actions that repair it, in order: the planner's own step actions (WP 2.3). */
  readonly repair: readonly StepAction[]
  readonly note?: string
}

/** Whether the voice checks could use the vault. */
export type AuditVaultState =
  /** No read-only role is a member anywhere, so no voice check needed it. */
  | 'not-needed'
  /** Read-only roles need checking and no vault is stored. */
  | 'missing'
  /** A vault is stored but not unlocked here: unlock it and audit again. */
  | 'locked'
  | 'unlocked'

export interface AuditReport {
  /** Most severe first, then by kind and target. */
  readonly items: readonly AuditItem[]
  readonly vault: AuditVaultState
  /** Role and room pairs whose stored role was read through the role's login. */
  readonly voiceChecked: number
  /** The design version published on the server, if any. */
  readonly publishedVersion: number | undefined
  /** Role ids online at the audit (repairs that change their access affect them, ADM-17). */
  readonly online: readonly string[]
}

/** Items that need the admin to act on: everything but `info`. */
export function findings(report: AuditReport): readonly AuditItem[] {
  return report.items.filter((i) => i.severity !== 'info')
}

export function isClean(report: AuditReport): boolean {
  return findings(report).length === 0
}
